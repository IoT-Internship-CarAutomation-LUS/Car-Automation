# tpms_codec.py -- LUS Car Automation
# Schema v2.1.0
#
# Packs and unpacks the 16-byte TPMS (tyre pressure / temperature) packet,
# the companion to the 32-byte vehicle packet in obd_decoder.py.
#
# The TPMS sensors were designed for but never bought, so on the real car
# this packet is never produced. The fleet demo simulator uses this codec so
# that simulated tyre data crosses the same kind of binary link, with the
# same sentinel and CRC rules, as the engine data.
#
# Byte layout (16 bytes, big-endian):
#   0      packet type   uint8   0x54 ('T')  -- tells it apart from the 32-byte packet
#   1      layout ver    uint8   0x01
#   2      sequence      uint8   N mod 256 (the demo uses the paired 32-byte packet's seq)
#   3-4    FL pressure   uint16  kPa * 10           (0xFFFF = NA)
#   5      FL temp       uint8   degC + 40          (0xFF = NA)
#   6-7    FR pressure   uint16  kPa * 10           (0xFFFF = NA)
#   8      FR temp       uint8   degC + 40          (0xFF = NA)
#   9-10   RL pressure   uint16  kPa * 10           (0xFFFF = NA)
#   11     RL temp       uint8   degC + 40          (0xFF = NA)
#   12-13  RR pressure   uint16  kPa * 10           (0xFFFF = NA)
#   14     RR temp       uint8   degC + 40          (0xFF = NA)
#   15     CRC-8         uint8   CRC-8-CCITT (poly 0x07, init 0x00) over bytes 0-14
#
# Same sentinel rule as the 32-byte packet: a 0 on the wire is a real zero,
# only 0xFF / 0xFFFF mean "unavailable", and they unpack to None.
#
# Public functions:
#   pack_tpms(tyres, seq)   -> 16 bytes
#   unpack_tpms(raw_bytes)  -> dict {"tyres": {...}, "seq": int, "crc_valid": bool}

import struct
import sys

from obd_decoder import crc8, U8_NA, U16_NA

TPMS_PACKET_TYPE = 0x54
TPMS_LAYOUT_VERSION = 0x01
TPMS_SIZE = 16
POSITIONS = ("fl", "fr", "rl", "rr")

_STRUCT = ">BBB" + "HB" * 4          # 15 bytes, CRC appended


def _pressure_raw(kpa):
    if kpa is None:
        return U16_NA
    return min(max(int(round(kpa * 10)), 0), 65534)


def _temp_raw(c):
    if c is None:
        return U8_NA
    return min(max(int(round(c)) + 40, 0), 254)


def pack_tpms(tyres: dict, seq: int = 0) -> bytes:
    """
    Pack tyre readings into the 16-byte TPMS packet.

    tyres: {"fl": {"pressure_kpa": float|None, "temp_c": float|None}, "fr": ..., ...}
           A missing position or a None value packs as the sentinel.
    """
    tyres = tyres or {}
    fields = [TPMS_PACKET_TYPE, TPMS_LAYOUT_VERSION, int(seq) & 0xFF]
    for pos in POSITIONS:
        t = tyres.get(pos) or {}
        fields.append(_pressure_raw(t.get("pressure_kpa")))
        fields.append(_temp_raw(t.get("temp_c")))
    body = struct.pack(_STRUCT, *fields)
    assert len(body) == TPMS_SIZE - 1
    packet = body + bytes([crc8(body)])
    assert len(packet) == TPMS_SIZE
    return packet


def unpack_tpms(raw_bytes: bytes) -> dict:
    """Unpack 16 bytes. Sentinels become None. Validates type byte and CRC-8."""
    if len(raw_bytes) != TPMS_SIZE:
        raise ValueError(f"Expected {TPMS_SIZE} bytes, got {len(raw_bytes)}")
    if raw_bytes[0] != TPMS_PACKET_TYPE:
        raise ValueError(f"Not a TPMS packet (type byte 0x{raw_bytes[0]:02X})")

    crc_valid = crc8(raw_bytes[:15]) == raw_bytes[15]
    f = struct.unpack(_STRUCT, raw_bytes[:15])
    _, layout, seq = f[0], f[1], f[2]
    tyres = {}
    for i, pos in enumerate(POSITIONS):
        p_raw, t_raw = f[3 + i * 2], f[4 + i * 2]
        tyres[pos] = {
            "pressure_kpa": None if p_raw == U16_NA else round(p_raw / 10.0, 1),
            "temp_c":       None if t_raw == U8_NA else float(t_raw - 40),
        }
    return {"tyres": tyres, "seq": seq, "layout_version": layout, "crc_valid": crc_valid}


# -- Self test -----------------------------------------------------------------

if __name__ == "__main__":
    errs = 0

    def check(cond, label):
        global errs
        if not cond:
            errs += 1
        print(f"  [{'PASS' if cond else 'FAIL'}] {label}")

    print("=" * 62)
    print("  TPMS CODEC (16-byte packet) -- self test")
    print("=" * 62)

    full = {"fl": {"pressure_kpa": 230.4, "temp_c": 38},
            "fr": {"pressure_kpa": 228.0, "temp_c": 39},
            "rl": {"pressure_kpa": 0.0,   "temp_c": -40},
            "rr": {"pressure_kpa": 6553.4, "temp_c": 214}}
    pkt = pack_tpms(full, seq=300)
    out = unpack_tpms(pkt)
    t = out["tyres"]
    check(len(pkt) == 16, "packet is exactly 16 bytes")
    check(pkt[0] == 0x54 and pkt[1] == 0x01, "type 0x54 and layout 0x01 in bytes 0-1")
    check(out["crc_valid"], "CRC valid on a clean packet")
    check(out["seq"] == 300 % 256, "seq wraps at 256 (300 -> 44)")
    check(t["fl"]["pressure_kpa"] == 230.4, "FL pressure 230.4 kPa round trip (0.1 kPa resolution)")
    check(t["fl"]["temp_c"] == 38.0, "FL temp 38 C round trip")
    check(t["rl"]["pressure_kpa"] == 0.0, "0 kPa is a real zero, not NA")
    check(t["rl"]["temp_c"] == -40.0, "-40 C (raw 0) is a real reading, not NA")
    check(t["rr"]["pressure_kpa"] == 6553.4, "max pressure 6553.4 kPa survives (0xFFFE)")
    check(t["rr"]["temp_c"] == 214.0, "max temp 214 C survives (0xFE)")

    none = unpack_tpms(pack_tpms({"fl": {"pressure_kpa": None, "temp_c": None}}, seq=1))
    check(all(none["tyres"][p]["pressure_kpa"] is None and none["tyres"][p]["temp_c"] is None
              for p in POSITIONS), "missing / None tyres unpack to null leaves (sentinels)")
    check(set(none["tyres"]) == set(POSITIONS), "all four positions present even when empty")

    bad = bytearray(pkt); bad[4] ^= 0x01
    check(unpack_tpms(bytes(bad))["crc_valid"] is False, "single bit flip caught by CRC-8")
    bad = bytearray(pkt); bad[3], bad[6] = bad[6], bad[3]
    check(unpack_tpms(bytes(bad))["crc_valid"] is False, "byte swap caught by CRC-8")

    try:
        unpack_tpms(pkt[:15]); check(False, "short packet raises ValueError")
    except ValueError:
        check(True, "short packet raises ValueError")
    try:
        unpack_tpms(bytes(16)); check(False, "wrong type byte raises ValueError")
    except ValueError:
        check(True, "wrong type byte raises ValueError")

    print("=" * 62)
    print("  ALL TESTS PASSED" if errs == 0 else f"  {errs} TEST(S) FAILED")
    print("=" * 62)
    sys.exit(0 if errs == 0 else 1)
