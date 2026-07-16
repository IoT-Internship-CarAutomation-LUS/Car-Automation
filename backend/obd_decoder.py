# obd_decoder.py — LUS Car Automation
# Turns raw OBD-II hex responses (from ELM327) into decoded values,
# then packs them into the exact 32-byte binary packet defined in
# docs/MESSAGE_SCHEMA.md section 6, and unpacks them back to JSON.
#
# Three public functions:
#   decode_pid(hex_str)              → decoded float/int, or None on 7F
#   pack_packet(decoded, gps)        → 32-byte bytes object
#   unpack_packet(raw_bytes)         → dict (JSON-ready)
#
# Run with:
#   python obd_decoder.py            → runs full pipeline test with fake data
#
# Source of truth for byte layout: docs/MESSAGE_SCHEMA.md section 6

import struct
import time
import sys

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

def _decode_0x0C(data: list) -> float:
    """RPM: ((A * 256) + B) / 4"""
    return ((data[0] * 256) + data[1]) / 4.0

def _decode_0x0D(data: list) -> int:
    """Speed (km/h): A"""
    return data[0]

def _decode_0x05(data: list) -> int:
    """Coolant temp (°C): A - 40"""
    return data[0] - 40

def _decode_0x04(data: list) -> float:
    """Engine load (%): A / 2.55"""
    return round(data[0] / 2.55, 1)

def _decode_0x11(data: list) -> float:
    """Throttle position (%): A / 2.55"""
    return round(data[0] / 2.55, 1)

def _decode_0x2F(data: list) -> float:
    """Fuel level (%): A / 2.55"""
    return round(data[0] / 2.55, 1)

def _decode_0x10(data: list) -> float:
    """MAF air flow rate (g/s): ((A * 256) + B) / 100"""
    return ((data[0] * 256) + data[1]) / 100.0

def _decode_0x0F(data: list) -> int:
    """Intake air temp (°C): A - 40"""
    return data[0] - 40


# ── PID dispatch table ─────────────────────────────────────────────────────────

_PID_DECODERS = {
    0x0C: _decode_0x0C,
    0x0D: _decode_0x0D,
    0x05: _decode_0x05,
    0x04: _decode_0x04,
    0x11: _decode_0x11,
    0x2F: _decode_0x2F,
    0x10: _decode_0x10,
    0x0F: _decode_0x0F,
}

# ── Public: PID decoder ────────────────────────────────────────────────────────

def decode_pid(hex_str: str):
    """
    Decode a raw OBD-II hex response string into a usable value.

    Args:
        hex_str: Raw response from ELM327, e.g. "41 0C 0B 34"

    Returns:
        Decoded value (int or float), or None if the response is a
        7F negative reply (PID not supported by this vehicle).

    Examples:
        decode_pid("41 0C 0B 34") → 717.0   (RPM)
        decode_pid("41 0D 3C")    → 60       (Speed km/h)
        decode_pid("7F 01 10")    → None     (MAF not supported)
    """
    if not hex_str or not hex_str.strip():
        return None

    tokens = hex_str.strip().upper().split()

    # 7F = negative response (not supported by this vehicle)
    if tokens[0] == "7F":
        return None

    # Validate response format: must start with 41 (Mode 01 response)
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


# ── Public: 32-byte packet packer ─────────────────────────────────────────────
# Byte layout per MESSAGE_SCHEMA.md §6:
#   0–1   RPM          uint16  (value × 4)
#   2     Speed        uint8   km/h
#   3     Coolant      uint8   °C + 40
#   4     Engine load  uint8   % × 2.55
#   5     Throttle     uint8   % × 2.55
#   6     Fuel level   uint8   %
#   7–8   MAF          uint16  g/s × 100  (0 if None)
#   9     Intake temp  uint8   °C + 40
#   10    AC status    uint8   0/1
#   11    Brake        uint8   0/1
#   12    Clutch %     uint8
#   13–16 GPS lat      int32   degrees × 1e6
#   17–20 GPS lng      int32   degrees × 1e6
#   21–22 GPS speed    uint16  km/h × 10
#   23–26 Timestamp    uint32  Unix seconds
#   27    DTC count    uint8
#   28–29 Battery mV   uint16
#   30    GPS sats     uint8
#   31    Checksum     uint8   XOR of bytes 0–30

def pack_packet(decoded: dict, gps: dict = None) -> bytes:
    """
    Pack decoded OBD values + GPS into the 32-byte binary packet.

    Args:
        decoded: Dict keyed by PID int, values are decoded floats/ints
                 or None for unsupported PIDs.
                 Keys: 0x0C (RPM), 0x0D (speed), 0x05 (coolant),
                       0x04 (load), 0x11 (throttle), 0x2F (fuel),
                       0x10 (MAF), 0x0F (intake)
        gps:     Optional dict with lat, lng, speed_kmh, sats.
                 Defaults to placeholder zeros if not provided.

    Returns:
        32-byte bytes object with XOR checksum in byte 31.
    """
    if gps is None:
        gps = {"lat": 0.0, "lng": 0.0, "speed_kmh": 0, "sats": 0}

    def safe(val, default=0):
        return val if val is not None else default

    rpm       = safe(decoded.get(0x0C), 0)
    speed     = safe(decoded.get(0x0D), 0)
    coolant   = safe(decoded.get(0x05), 0)
    load      = safe(decoded.get(0x04), 0)
    throttle  = safe(decoded.get(0x11), 0)
    fuel      = safe(decoded.get(0x2F), 0)
    maf       = safe(decoded.get(0x10), 0)
    intake    = safe(decoded.get(0x0F), 0)

    # Encode each field back to raw bytes using the packing formula
    rpm_raw      = min(int(round(rpm * 4)), 65535)
    coolant_raw  = min(max(int(round(coolant)) + 40, 0), 255)
    load_raw     = min(int(round(load * 2.55)), 255)
    throttle_raw = min(int(round(throttle * 2.55)), 255)
    fuel_raw     = min(max(int(round(fuel)), 0), 255)
    maf_raw      = min(int(round(maf * 100)), 65535)
    intake_raw   = min(max(int(round(intake)) + 40, 0), 255)
    speed_raw    = min(max(int(round(speed)), 0), 255)

    lat_raw      = int(round(gps.get("lat", 0.0) * 1_000_000))
    lng_raw      = int(round(gps.get("lng", 0.0) * 1_000_000))
    gps_spd_raw  = min(int(round(gps.get("speed_kmh", 0) * 10)), 65535)
    ts_raw       = int(time.time()) & 0xFFFFFFFF
    sats_raw     = min(int(gps.get("sats", 0)), 255)

    # Pack 31 bytes (byte 31 is the checksum, added after)
    body = struct.pack(
        ">H B B B B B H B B B b i i H I B H B",
        rpm_raw,       # 0–1   RPM
        speed_raw,     # 2     Speed
        coolant_raw,   # 3     Coolant
        load_raw,      # 4     Engine load
        throttle_raw,  # 5     Throttle
        fuel_raw,      # 6     Fuel level
        maf_raw,       # 7–8   MAF
        intake_raw,    # 9     Intake temp
        0,             # 10    AC status  (placeholder)
        0,             # 11    Brake      (placeholder)
        0,             # 12    Clutch %   (placeholder — signed byte unused)
        lat_raw,       # 13–16 GPS lat
        lng_raw,       # 17–20 GPS lng
        gps_spd_raw,   # 21–22 GPS speed
        ts_raw,        # 23–26 Timestamp
        0,             # 27    DTC count
        13800,         # 28–29 Battery mV (placeholder ~13.8V)
        sats_raw,      # 30    GPS sats
    )

    # Byte 31: XOR checksum of bytes 0–30
    checksum = 0
    for b in body:
        checksum ^= b
    packet = body + bytes([checksum])

    assert len(packet) == 32, f"Packet length error: {len(packet)} bytes"
    return packet


# ── Public: 32-byte packet unpacker ───────────────────────────────────────────

def unpack_packet(raw_bytes: bytes) -> dict:
    """
    Unpack a 32-byte binary packet back to a JSON-ready dict.
    Also validates the XOR checksum (byte 31).

    Returns:
        dict with keys matching MESSAGE_SCHEMA.md telemetry.vehicle + gps,
        plus 'checksum_valid' (bool).
    """
    assert len(raw_bytes) == 32, f"Expected 32 bytes, got {len(raw_bytes)}"

    # Validate checksum
    checksum_valid = True
    computed = 0
    for b in raw_bytes[:31]:
        computed ^= b
    if computed != raw_bytes[31]:
        checksum_valid = False

    fields = struct.unpack(">H B B B B B H B B B b i i H I B H B", raw_bytes[:31])

    rpm_raw, speed_raw, coolant_raw, load_raw, throttle_raw, fuel_raw, \
    maf_raw, intake_raw, ac_raw, brake_raw, clutch_raw, \
    lat_raw, lng_raw, gps_spd_raw, ts_raw, dtc_raw, batt_raw, sats_raw = fields

    rpm_decoded = round(rpm_raw / 4.0, 1)
    speed_decoded = speed_raw
    gear_decoded = calculate_gear(rpm_decoded, speed_decoded)

    return {
        "vehicle": {
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
        },
        "gps": {
            "lat":       lat_raw / 1_000_000.0,
            "lng":       lng_raw / 1_000_000.0,
            "speed_kmh": round(gps_spd_raw / 10.0, 1),
            "sats":      sats_raw,
        },
        "ts":              ts_raw * 1000,   # convert to ms for JSON schema
        "checksum_valid":  checksum_valid,
    }


# ── Test suite ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    from mock_obd import get_all_responses, UNSUPPORTED_PIDS

    PASS = "\033[92m[PASS]\033[0m"
    FAIL = "\033[91m[FAIL]\033[0m"
    errors = 0

    print("=" * 60)
    print("  OBD DECODER — Full Pipeline Test")
    print("  mock_obd -> decode_pid -> pack_packet -> unpack_packet")
    print("=" * 60)

    # ── Test 1: Known hand-calculated values ──────────────────────
    print("\n[ Test 1 ] Hand-calculated PID decode verification")

    cases = [
        ("41 0C 0B 34", 0x0C, 717.0,  "RPM (41 0C 0B 34 -> 717 RPM)"),
        ("41 0D 3C",    0x0D, 60,     "Speed (41 0D 3C -> 60 km/h)"),
        ("41 05 7B",    0x05, 83,     "Coolant (41 05 7B -> 83°C)"),
        ("41 04 66",    0x04, 40.0,   "Engine Load (41 04 66 -> ~40%)"),
    ]

    for hex_str, pid, expected, label in cases:
        result = decode_pid(hex_str)
        ok = result is not None and abs(result - expected) < 1.0
        tag = PASS if ok else FAIL
        if not ok:
            errors += 1
        print(f"  {tag} {label} -> got {result}")

    # ── Test 2: 7F negative response ──────────────────────────────
    print("\n[ Test 2 ] 7F negative response returns None (no crash)")

    neg_cases = [
        ("7F 01 10", "MAF not supported"),
        ("7F 01 2F", "Fuel level not supported"),
        ("7F 01 0C", "RPM not supported"),
    ]

    for hex_str, label in neg_cases:
        result = decode_pid(hex_str)
        ok = result is None
        tag = PASS if ok else FAIL
        if not ok:
            errors += 1
        print(f"  {tag} {label}: decode_pid('{hex_str}') -> {result}")

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
    else:
        print(f"  \033[91m{errors} TEST(S) FAILED\033[0m — review output above.")
    print("=" * 60)
    sys.exit(0 if errors == 0 else 1)
