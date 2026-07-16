# obd_decoder.py -- LUS Car Automation
# Schema v2.0.0
#
# Turns raw OBD-II hex responses into decoded values, packs them into the
# 32-byte binary packet, and unpacks them back to JSON.
#
# Public functions:
#   decode_pid(hex_str)                     -> value, or None if unavailable
#   pack_packet(decoded, gps, extras)       -> 32 bytes
#   unpack_packet(raw_bytes)                -> dict (JSON-ready, None = unavailable)
#
# WHAT CHANGED FROM v1 (read this before editing):
#   1. Missing values are now written as SENTINELS, never as 0. In v1 an
#      unsupported PID was packed as 0, so the Fronx (which does not report
#      fuel) showed an empty tank with a CRITICAL alert. Now it packs 0xFF
#      and unpacks back to None.
#   2. Percent fields are stored as value*2, NOT value*2.55. With *2.55,
#      100% == 255 == the 0xFF sentinel, so wide-open throttle would have
#      read as "unavailable". *2 caps valid at 200 and keeps 201-255 free.
#      Resolution is 0.5%, finer than anything the dashboards display.
#   3. Battery and DTC are now real reads (ATRV, PID 0x01), not constants.
#   4. Checksum is CRC-8-CCITT, not XOR. XOR misses common bit-flip patterns.
#   5. AC/brake/clutch are bit-packed into byte 24 with VALIDITY bits, so
#      "not found yet" is distinguishable from "off".
#
# Source of truth for the layout: docs/MESSAGE_SCHEMA.md section 6.

import struct
import time
import sys

<<<<<<< HEAD
try:
    from config import GEAR_RATIO_THRESHOLDS
except ImportError:
    # Fallback default ratio thresholds if config.py not accessible directly
    GEAR_RATIO_THRESHOLDS = [
        {"gear": 1, "min_ratio": 115.0, "max_ratio": 180.0},
        {"gear": 2, "min_ratio": 65.0,  "max_ratio": 114.9},
        {"gear": 3, "min_ratio": 45.0,  "max_ratio": 64.9},
        {"gear": 4, "min_ratio": 32.0,  "max_ratio": 44.9},
        {"gear": 5, "min_ratio": 24.0,  "max_ratio": 31.9},
        {"gear": 6, "min_ratio": 15.0,  "max_ratio": 23.9},
    ]


def calculate_gear(rpm: float, speed_kmh: float, *args, **kwargs) -> int:
    """
    Estimate / assume transmission gear (0–6) using ONLY the ratio of RPM to Speed (km/h).
    Does NOT rely on clutch position since real OBD-II hardware does not report clutch_pct.
    If stopped or idling while coasting, returns 0 (Neutral).
    Otherwise matches against GEAR_RATIO_THRESHOLDS defined in config.py.
    """
    if speed_kmh < 3 or rpm < 400:
        return 0

    # If coasting at speed with engine idling (< 1000 RPM while moving > 15 km/h), assume Neutral
    if rpm < 1000 and speed_kmh > 15:
        return 0

    ratio = float(rpm) / float(speed_kmh)

    # Check exact threshold bands
    for band in GEAR_RATIO_THRESHOLDS:
        if band["min_ratio"] <= ratio <= band["max_ratio"]:
            return band["gear"]

    # Handle boundary conditions beyond 1st or 6th gear
    if ratio > 180.0:
        return 0  # Revving in neutral at near standstill
    elif ratio < 15.0:
        return 6  # High overdrive / highway cruise

    # Find closest gear band by midpoint
    closest_gear = 0
    min_diff = float("inf")
    for band in GEAR_RATIO_THRESHOLDS:
        midpoint = (band["min_ratio"] + band["max_ratio"]) / 2.0
        diff = abs(ratio - midpoint)
        if diff < min_diff:
            min_diff = diff
            closest_gear = band["gear"]

    return closest_gear


# ── PID decode formulas ────────────────────────────────────────────────────────
# All formulas taken directly from the OBD-II standard (SAE J1979).
# Reference: MESSAGE_SCHEMA.md §6 and the Vehicle Data Acquisition Standard.
=======
SCHEMA_VERSION = "2.0.0"
>>>>>>> refs/remotes/origin/main

# -- Sentinels: what "unavailable" looks like on the wire ----------------------
U8_NA  = 0xFF
U16_NA = 0xFFFF
I32_NA = 0x7FFFFFFF

# -- Byte layout (32 bytes) ---------------------------------------------------
#   0-3    timestamp     uint32  Unix seconds
#   4-5    RPM           uint16  value * 4          (0xFFFF = NA)
#   6      speed         uint8   km/h               (0xFF = NA)
#   7-10   GPS lat       int32   deg * 1e6          (0x7FFFFFFF = NA)
#   11-14  GPS lng       int32   deg * 1e6          (0x7FFFFFFF = NA)
#   15     sats + fix    uint8   bits0-5 sats, bit6 fix
#   16-17  MAF           uint16  g/s * 100          (0xFFFF = NA)
#   18     gear          uint8   0=N 1-6 0x0E=R     (0xFF = unknown)
#   19     throttle      uint8   % * 2              (0xFF = NA)
#   20     coolant       uint8   degC + 40          (0xFF = NA)
#   21     fuel level    uint8   % * 2              (0xFF = NA)
#   22     battery       uint8   volts * 10         (0xFF = NA)
#   23     MIL + DTC     uint8   bit7 MIL, bits0-6 count (0xFF = NA)
#   24     AC/brake/clutch  uint8  bit-packed, see below
#   25     engine load   uint8   % * 2              (0xFF = NA)
#   26     intake temp   uint8   degC + 40          (0xFF = NA)
#   27     ambient temp  uint8   degC + 40          (0xFF = NA)
#   28     MAP           uint8   kPa                (0xFF = NA)
#   29     device health uint8   bit7 power, bit6 gps, bit5 can
#   30     sequence      uint8   N mod 256
#   31     CRC-8         uint8   CRC-8-CCITT over bytes 0-30
#
# Byte 24 bits:
#   0 brake state   1 brake valid
#   2 clutch state  3 clutch valid
#   4 ac state      5 ac valid
#   6-7 reserved
#
# A "valid" bit of 0 means we have not found that signal on the CAN bus yet.
# It means UNKNOWN, not "off". Do not show a confident state without it.

_STRUCT = ">I H B i i B H B B B B B B B B B B B B B"

# -- PID decode formulas (from the car's replies) ------------------------------
# These follow SAE J1979. They decode the CAR's response and are unrelated
# to how we store the value in our own packet.

def _d_0x0C(d): return ((d[0] * 256) + d[1]) / 4.0        # RPM
def _d_0x0D(d): return d[0]                                # speed km/h
def _d_0x05(d): return d[0] - 40                           # coolant C
def _d_0x04(d): return round(d[0] * 100 / 255, 1)          # engine load %
def _d_0x11(d): return round(d[0] * 100 / 255, 1)          # throttle %
def _d_0x2F(d): return round(d[0] * 100 / 255, 1)          # fuel level %
def _d_0x10(d): return ((d[0] * 256) + d[1]) / 100.0       # MAF g/s
def _d_0x0F(d): return d[0] - 40                           # intake C
def _d_0x46(d): return d[0] - 40                           # ambient C
def _d_0x0B(d): return d[0]                                # MAP kPa

def _d_0x01(d):
    """
    PID 0x01: monitor status. Byte A bit 7 = MIL lamp on.
    Bits 0-6 of A = number of confirmed emissions DTCs.
    Returns (mil_on: bool, dtc_count: int).
    """
    a = d[0]
    return (bool(a & 0x80), a & 0x7F)

_PID_DECODERS = {
    0x0C: _d_0x0C, 0x0D: _d_0x0D, 0x05: _d_0x05, 0x04: _d_0x04,
    0x11: _d_0x11, 0x2F: _d_0x2F, 0x10: _d_0x10, 0x0F: _d_0x0F,
    0x46: _d_0x46, 0x0B: _d_0x0B, 0x01: _d_0x01,
}

TARGET_PIDS = [0x0C, 0x0D, 0x05, 0x04, 0x11, 0x2F, 0x10, 0x0F, 0x46, 0x0B, 0x01]


def decode_pid(hex_str: str):
    """
    Decode a raw ELM327 reply into a value.

    Returns the decoded value, or None if the reply is a negative response,
    malformed, empty, or for a PID we do not handle.

      decode_pid("41 0C 0B 34") -> 717.0
      decode_pid("7F 01 2F")    -> None
    """
    if not hex_str or not hex_str.strip():
        return None

    tokens = hex_str.strip().upper().split()
    if tokens[0] == "7F":
        return None
    if len(tokens) < 2 or tokens[0] != "41":
        return None

    try:
        pid = int(tokens[1], 16)
        data = [int(b, 16) for b in tokens[2:]]
    except ValueError:
        return None

    decoder = _PID_DECODERS.get(pid)
    if decoder is None:
        return None

    try:
        return decoder(data)
    except (IndexError, ZeroDivisionError):
        return None


def decode_atrv(resp: str):
    """
    Decode the ELM327 ATRV reply (battery voltage at the OBD connector).
    Works with no ECU present. Replies look like "12.6V".
    Returns volts as float, or None.
    """
    if not resp:
        return None
    s = resp.strip().upper().replace("V", "").strip()
    try:
        v = float(s)
    except ValueError:
        return None
    return v if 0.0 <= v <= 25.4 else None


# -- CRC-8-CCITT (poly 0x07, init 0x00) ---------------------------------------

def crc8(data: bytes) -> int:
    crc = 0x00
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = ((crc << 1) ^ 0x07) & 0xFF if (crc & 0x80) else (crc << 1) & 0xFF
    return crc


# -- Encoding helpers: value -> raw byte, or sentinel --------------------------

def _u8(val, lo=0, hi=254):
    """Plain uint8. None -> 0xFF."""
    if val is None:
        return U8_NA
    return min(max(int(round(val)), lo), hi)

def _pct(val):
    """Percent stored as value*2 (0-200). None -> 0xFF."""
    if val is None:
        return U8_NA
    return min(max(int(round(val * 2)), 0), 200)

def _temp(val):
    """Temperature stored as degC + 40. None -> 0xFF."""
    if val is None:
        return U8_NA
    return min(max(int(round(val)) + 40, 0), 254)

def _u16(val, scale=1):
    """uint16 with a scale factor. None -> 0xFFFF."""
    if val is None:
        return U16_NA
    return min(max(int(round(val * scale)), 0), 65534)

def _coord(val):
    """int32 degrees*1e6. None -> 0x7FFFFFFF."""
    if val is None:
        return I32_NA
    return int(round(val * 1_000_000))


def pack_packet(decoded: dict, gps: dict = None, extras: dict = None) -> bytes:
    """
    Pack decoded values into the 32-byte packet.

    Args:
      decoded: {pid_int: value_or_None}. Keys per TARGET_PIDS.
               0x01 may be a (mil_on, dtc_count) tuple or None.
      gps:     {lat, lng, sats, fix} or None. lat/lng None -> sentinel.
      extras:  optional dict:
                 battery_v : float from ATRV, or None
                 gear      : int 0-6 / 0x0E reverse, or None -> unknown
                 seq       : int sequence counter
                 can       : {"brake": bool|None, "clutch": bool|None,
                              "ac": bool|None}   None = not found yet
                 health    : {"power_ok": bool, "gps_ok": bool, "can_ok": bool}

    Returns 32 bytes, CRC-8 in byte 31.
    """
    gps = gps or {}
    extras = extras or {}

    # -- GPS -------------------------------------------------------------
    lat_raw = _coord(gps.get("lat"))
    lng_raw = _coord(gps.get("lng"))
    sats = min(int(gps.get("sats") or 0), 63)
    fix = bool(gps.get("fix"))
    sats_fix = (sats & 0x3F) | (0x40 if fix else 0x00)

    # -- MIL / DTC (PID 0x01) --------------------------------------------
    mil_dtc = decoded.get(0x01)
    if mil_dtc is None:
        mil_dtc_raw = U8_NA
    else:
        mil_on, dtc_count = mil_dtc
        mil_dtc_raw = (0x80 if mil_on else 0x00) | (min(dtc_count, 127) & 0x7F)

    # -- Byte 24: AC / brake / clutch with validity bits ------------------
    can = extras.get("can") or {}
    flags = 0
    for state_bit, valid_bit, key in ((0, 1, "brake"), (2, 3, "clutch"), (4, 5, "ac")):
        v = can.get(key)
        if v is not None:                      # we found this signal
            flags |= (1 << valid_bit)
            if v:
                flags |= (1 << state_bit)

    # -- Byte 29: device health ------------------------------------------
    h = extras.get("health") or {}
    health = 0
    if h.get("power_ok"): health |= 0x80
    if h.get("gps_ok"):   health |= 0x40
    if h.get("can_ok"):   health |= 0x20

    body = struct.pack(
        _STRUCT,
        int(time.time()) & 0xFFFFFFFF,          # 0-3   timestamp
        _u16(decoded.get(0x0C), 4),             # 4-5   RPM
        _u8(decoded.get(0x0D)),                 # 6     speed
        lat_raw,                                # 7-10  lat
        lng_raw,                                # 11-14 lng
        sats_fix,                               # 15    sats+fix
        _u16(decoded.get(0x10), 100),           # 16-17 MAF
        _u8(extras.get("gear"), 0, 254),        # 18    gear
        _pct(decoded.get(0x11)),                # 19    throttle
        _temp(decoded.get(0x05)),               # 20    coolant
        _pct(decoded.get(0x2F)),                # 21    fuel
        _u8(extras.get("battery_v") * 10        # 22    battery
            if extras.get("battery_v") is not None else None),
        mil_dtc_raw,                            # 23    MIL+DTC
        flags,                                  # 24    AC/brake/clutch
        _pct(decoded.get(0x04)),                # 25    engine load
        _temp(decoded.get(0x0F)),               # 26    intake
        _temp(decoded.get(0x46)),               # 27    ambient
        _u8(decoded.get(0x0B)),                 # 28    MAP
        health,                                 # 29    device health
        int(extras.get("seq", 0)) & 0xFF,       # 30    sequence
    )

    assert len(body) == 31, f"body is {len(body)} bytes, expected 31"
    packet = body + bytes([crc8(body)])
    assert len(packet) == 32
    return packet


# -- Decoding helpers: raw byte -> value, or None ------------------------------

def _r_u8(raw):    return None if raw == U8_NA else raw
def _r_pct(raw):   return None if raw == U8_NA else round(raw / 2.0, 1)
def _r_temp(raw):  return None if raw == U8_NA else raw - 40
def _r_u16(raw, s): return None if raw == U16_NA else round(raw / s, 2)
def _r_coord(raw): return None if raw == I32_NA else raw / 1_000_000.0


def unpack_packet(raw_bytes: bytes) -> dict:
    """
    Unpack 32 bytes back to a JSON-ready dict.
    Sentinels become None. Validates the CRC-8.
    """
    if len(raw_bytes) != 32:
        raise ValueError(f"Expected 32 bytes, got {len(raw_bytes)}")

    crc_valid = crc8(raw_bytes[:31]) == raw_bytes[31]
    f = struct.unpack(_STRUCT, raw_bytes[:31])

    (ts, rpm_r, spd_r, lat_r, lng_r, satsfix, maf_r, gear_r, thr_r,
     cool_r, fuel_r, batt_r, mildtc_r, flags, load_r, intake_r,
     amb_r, map_r, health, seq) = f

    # MIL / DTC
    if mildtc_r == U8_NA:
        mil_on, dtc_count = None, None
    else:
        mil_on = bool(mildtc_r & 0x80)
        dtc_count = mildtc_r & 0x7F

    # Byte 24: state only meaningful if the matching valid bit is set
    def _flag(state_bit, valid_bit):
        return bool(flags & (1 << state_bit)) if (flags & (1 << valid_bit)) else None

    rpm_decoded = round(rpm_raw / 4.0, 1)
    speed_decoded = speed_raw
    gear_decoded = calculate_gear(rpm_decoded, speed_decoded)

    return {
        "schema_version": SCHEMA_VERSION,
        "ts": ts * 1000,
        "vehicle": {
<<<<<<< HEAD
            "rpm":               rpm_decoded,
            "speed_kmh":         speed_decoded,
            "gear":              gear_decoded,
            "coolant_c":         coolant_raw - 40,
            "engine_load_pct":   round(load_raw / 2.55, 1),
            "throttle_pct":      round(throttle_raw / 2.55, 1),
            "fuel_level_pct":    fuel_raw,
            "maf_gps":           round(maf_raw / 100.0, 2),
            "intake_temp_c":     intake_raw - 40,
            "ac_on":             bool(ac_raw),
            "brake":             bool(brake_raw),
            "clutch_pct":        clutch_raw,
            "dtc_count":         dtc_raw,
            "battery_mv":        batt_raw,
=======
            "rpm":              _r_u16(rpm_r, 4),
            "speed_kmh":        _r_u8(spd_r),
            "gear":             None if gear_r == U8_NA else gear_r,
            "throttle_pct":     _r_pct(thr_r),
            "coolant_c":        _r_temp(cool_r),
            "fuel_level_pct":   _r_pct(fuel_r),
            "maf_gps":          _r_u16(maf_r, 100),
            "engine_load_pct":  _r_pct(load_r),
            "intake_temp_c":    _r_temp(intake_r),
            "ambient_temp_c":   _r_temp(amb_r),
            "map_kpa":          _r_u8(map_r),
            "battery_v":        None if batt_r == U8_NA else round(batt_r / 10.0, 1),
            "mil_on":           mil_on,
            "dtc_count":        dtc_count,
            "brake":            _flag(0, 1),
            "clutch":           _flag(2, 3),
            "ac_on":            _flag(4, 5),
>>>>>>> refs/remotes/origin/main
        },
        "gps": {
            "lat":  _r_coord(lat_r),
            "lng":  _r_coord(lng_r),
            "sats": satsfix & 0x3F,
            "fix":  bool(satsfix & 0x40),
        },
        "device": {
            "power_ok": bool(health & 0x80),
            "gps_ok":   bool(health & 0x40),
            "can_ok":   bool(health & 0x20),
            "seq":      seq,
        },
        "crc_valid": crc_valid,
    }


# -- Self test -----------------------------------------------------------------

if __name__ == "__main__":
    P = "\033[92mPASS\033[0m"
    F = "\033[91mFAIL\033[0m"
    errs = 0

    def check(cond, label, got=""):
        global errs
        if not cond:
            errs += 1
        print(f"  [{P if cond else F}] {label} {got}")

    print("=" * 62)
    print("  OBD DECODER v2.0.0 -- self test")
    print("=" * 62)

    print("\n[1] PID decode against hand-calculated values")
    check(decode_pid("41 0C 0B 34") == 717.0, "RPM 41 0C 0B 34 -> 717")
    check(decode_pid("41 0D 3C") == 60, "speed 41 0D 3C -> 60")
    check(decode_pid("41 05 7B") == 83, "coolant 41 05 7B -> 83C")
    check(decode_pid("41 0F 6A") == 66, "intake 41 0F 6A -> 66C")
    check(decode_pid("41 10 02 0C") == 5.24, "MAF 41 10 02 0C -> 5.24")
    check(decode_pid("41 01 83") == (True, 3), "MIL+DTC 41 01 83 -> (True,3)")
    check(decode_atrv("12.6V") == 12.6, "ATRV 12.6V -> 12.6")

    print("\n[2] Unavailable replies return None")
    for s in ("7F 01 2F", "NO DATA", "", "?", "41"):
        check(decode_pid(s) is None, f"decode_pid({s!r}) -> None")

    print("\n[3] THE v1 BUG: unsupported fuel must NOT become 0")
    fronx = {0x0C: 2092.5, 0x0D: 0, 0x05: 90, 0x04: 23.9, 0x11: 18.0,
             0x2F: None, 0x10: 5.24, 0x0F: 66, 0x46: None, 0x0B: None,
             0x01: None}
    pkt = pack_packet(fronx, {"lat": None, "lng": None, "sats": 0, "fix": False})
    out = unpack_packet(pkt)
    check(out["vehicle"]["fuel_level_pct"] is None, "fuel None -> None (was 0 in v1)")
    check(out["vehicle"]["battery_v"] is None, "battery None -> None (was 13800)")
    check(out["vehicle"]["ac_on"] is None, "ac not found -> None (was False)")
    check(out["vehicle"]["brake"] is None, "brake not found -> None")
    check(out["gps"]["lat"] is None, "lat None -> None (was 0.0 = Null Island)")
    check(out["gps"]["fix"] is False, "fix false")

    print("\n[4] Sentinel collision: 100% must survive, not read as NA")
    full = {0x11: 100.0, 0x04: 100.0, 0x2F: 100.0}
    o = unpack_packet(pack_packet(full))
    check(o["vehicle"]["throttle_pct"] == 100.0, "throttle 100% -> 100.0", f"got {o['vehicle']['throttle_pct']}")
    check(o["vehicle"]["engine_load_pct"] == 100.0, "load 100% -> 100.0")
    check(o["vehicle"]["fuel_level_pct"] == 100.0, "fuel 100% -> 100.0")

    print("\n[5] Round trip with everything present")
    full_set = {0x0C: 2500.0, 0x0D: 62, 0x05: 89, 0x04: 41.0, 0x11: 28.0,
                0x2F: 73.0, 0x10: 12.6, 0x0F: 34, 0x46: 31, 0x0B: 98,
                0x01: (False, 0)}
    gps = {"lat": 12.920364, "lng": 80.131663, "sats": 7, "fix": True}
    extras = {"battery_v": 13.8, "gear": 4, "seq": 42,
              "can": {"brake": False, "clutch": True, "ac": True},
              "health": {"power_ok": True, "gps_ok": True, "can_ok": True}}
    pkt = pack_packet(full_set, gps, extras)
    o = unpack_packet(pkt)
    v = o["vehicle"]
    check(len(pkt) == 32, "packet is 32 bytes", f"got {len(pkt)}")
    check(o["crc_valid"], "CRC valid")
    check(v["rpm"] == 2500.0, "rpm round trip")
    check(v["speed_kmh"] == 62, "speed round trip")
    check(v["coolant_c"] == 89, "coolant round trip")
    check(abs(v["throttle_pct"] - 28.0) < 0.5, "throttle round trip")
    check(abs(v["maf_gps"] - 12.6) < 0.01, "maf round trip")
    check(v["battery_v"] == 13.8, "battery round trip", f"got {v['battery_v']}")
    check(v["gear"] == 4, "gear round trip")
    check(v["ambient_temp_c"] == 31, "ambient round trip")
    check(v["map_kpa"] == 98, "MAP round trip")
    check(v["mil_on"] is False and v["dtc_count"] == 0, "MIL/DTC round trip")
    check(v["brake"] is False, "brake found + off -> False (not None)")
    check(v["clutch"] is True, "clutch found + on -> True")
    check(v["ac_on"] is True, "ac found + on -> True")
    check(abs(o["gps"]["lat"] - 12.920364) < 1e-6, "lat round trip")
    check(o["gps"]["sats"] == 7 and o["gps"]["fix"], "sats+fix round trip")
    check(o["device"]["seq"] == 42, "seq round trip")

    print("\n[6] CRC catches corruption (XOR in v1 missed some of these)")
    bad = bytearray(pkt); bad[4] ^= 0x01
    check(unpack_packet(bytes(bad))["crc_valid"] is False, "single bit flip caught")
    bad = bytearray(pkt); bad[6], bad[7] = bad[7], bad[6]
    check(unpack_packet(bytes(bad))["crc_valid"] is False, "byte swap caught")

<<<<<<< HEAD
    # ── Test 3: Full pipeline with mock_obd ───────────────────────
    print(f"\n[ Test 3 ] Full pipeline — mock_obd -> decode -> pack -> unpack")
    print(f"  Unsupported PIDs: {[hex(p) for p in UNSUPPORTED_PIDS] or 'none'}")

    GPS_PLACEHOLDER = {"lat": 12.920364, "lng": 80.131663, "speed_kmh": 60, "sats": 7}

    for tick in range(1, 4):
        print(f"\n  --- Tick {tick} ---")
        raw_responses = get_all_responses()

        # Decode all PIDs
        decoded = {pid: decode_pid(resp) for pid, resp in raw_responses.items()}

        # Print decoded values
        PID_NAMES = {0x0C:"RPM", 0x0D:"Speed", 0x05:"Coolant", 0x04:"Load",
                     0x11:"Throttle", 0x2F:"Fuel", 0x10:"MAF", 0x0F:"Intake"}
        for pid, val in decoded.items():
            raw = raw_responses[pid]
            name = PID_NAMES.get(pid, hex(pid))
            null_note = " <- null (7F)" if val is None else ""
            print(f"    [{hex(pid)}] {name:<12} raw: {raw:<20} decoded: {val}{null_note}")

        # Pack into 32-byte packet
        packet = pack_packet(decoded, GPS_PLACEHOLDER)
        ok_len = len(packet) == 32
        tag = PASS if ok_len else FAIL
        if not ok_len:
            errors += 1
        print(f"  {tag} Packet packed: {len(packet)} bytes")

        # Unpack and verify checksum
        unpacked = unpack_packet(packet)
        ok_checksum = unpacked["checksum_valid"]
        tag = PASS if ok_checksum else FAIL
        if not ok_checksum:
            errors += 1
        print(f"  {tag} Checksum valid: {ok_checksum}")

        # Verify round-trip RPM (if not unsupported)
        if decoded.get(0x0C) is not None:
            original_rpm = decoded[0x0C]
            roundtrip_rpm = unpacked["vehicle"]["rpm"]
            ok_rt = abs(original_rpm - roundtrip_rpm) < 1.0
            tag = PASS if ok_rt else FAIL
            if not ok_rt:
                errors += 1
            print(f"  {tag} RPM round-trip: original={original_rpm} -> unpacked={roundtrip_rpm}")

        # Verify estimated gear is populated in unpacked vehicle dict
        unpacked_gear = unpacked["vehicle"]["gear"]
        print(f"  {PASS} Estimated Gear inside unpacked packet: {unpacked_gear} (RPM={unpacked['vehicle']['rpm']}, Speed={unpacked['vehicle']['speed_kmh']}km/h)")

    # ── Test 4: Gear Estimation Algorithm Verification ────────────
    print("\n[ Test 4 ] Gear estimation algorithm verification (RPM & Speed ratios)")
    gear_cases = [
        (800.0,  0.0,  0, "Stopped / Neutral (0 km/h)"),
        (800.0,  40.0, 0, "Coasting at speed (idle RPM < 1000)"),
        (2800.0, 20.0, 1, "1st Gear (~140 ratio)"),
        (2600.0, 32.0, 2, "2nd Gear (~81 ratio)"),
        (2500.0, 48.0, 3, "3rd Gear (~52 ratio)"),
        (2500.0, 68.0, 4, "4th Gear (~37 ratio)"),
        (2400.0, 88.0, 5, "5th Gear (~27 ratio)"),
        (2200.0, 110.0,6, "6th Gear (~20 ratio)"),
    ]
    for rpm_in, spd_in, exp_g, label in gear_cases:
        calc_g = calculate_gear(rpm_in, spd_in)
        ok_g = (calc_g == exp_g)
        tag = PASS if ok_g else FAIL
        if not ok_g:
            errors += 1
        print(f"  {tag} {label}: RPM={rpm_in}, Speed={spd_in} -> got Gear {calc_g} (expected {exp_g})")

    # ── Summary ───────────────────────────────────────────────────
    print("\n" + "=" * 60)
    if errors == 0:
        print("  \033[92mALL TESTS PASSED\033[0m — pipeline ready for hardware integration.")
=======
    print("\n" + "=" * 62)
    if errs == 0:
        print("  \033[92mALL TESTS PASSED\033[0m -- v2 packet is sound.")
>>>>>>> refs/remotes/origin/main
    else:
        print(f"  \033[91m{errs} TEST(S) FAILED\033[0m")
    print("=" * 62)
    sys.exit(0 if errs == 0 else 1)
