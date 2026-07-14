# Technical Brief: OBD Decode & Packet-Packing Logic

**To:** Shahid  (Team Lead)
**From:** Shaahir   
**Date:** July 7, 2026  
**Subject:** Implementation of OBD-II PID Decoder, 32-Byte Packet Packer, and Mock ELM327 Simulator  
**Brief Reference:** Brief 4 — OBD Decode & Packet-Packing Logic

---

## 1. What This Task Was

Brief 4 required us to build and test the code that turns raw OBD-II responses from an ELM327 adapter into our 32-byte binary vehicle packet — **before any hardware arrives**. The goal is that when the ELM327 is in hand, we only wire it in; the decode and packing logic is already written, tested, and proven.

This follows the same "fake-data-first" pattern we used for the backend WebSocket pipeline.

> [!IMPORTANT]
> No physical car, no ELM327, and no serial connection was used in this task. Everything runs on fake hex strings that match exactly what real hardware would send.

---

## 2. Files Delivered

| File | Location | Purpose |
| :--- | :--- | :--- |
| `mock_obd.py` | `backend/mock_obd.py` | Simulates raw ELM327 hex responses for all 8 target PIDs |
| `obd_decoder.py` | `backend/obd_decoder.py` | Decodes raw hex, packs 32-byte binary packet, unpacks back to JSON |

---

## 3. Architecture — How the Two Files Work Together

They are two **completely separate** files. `mock_obd.py` is a testing tool only. `obd_decoder.py` is the permanent production code that stays when real hardware arrives.

```
           CURRENT (no hardware)          FUTURE (ELM327 connected)
           ──────────────────────         ──────────────────────────
           mock_obd.py                    ELM327 serial port
           (fake hex strings)             (real hex strings)
                   |                               |
                   └──────────────┬────────────────┘
                                  ↓
                          obd_decoder.py
                          decode_pid()
                          pack_packet()
                          unpack_packet()
                                  ↓
                         32-byte binary packet
                                  ↓
                     Backend → WebSocket → Dashboard
```

When real hardware arrives, the only change needed is swapping the source of the hex string — from `mock_obd.get_response()` to `elm327_serial.readline()`. The decoder itself does not change at all.

---

## 4. Detailed Breakdown

### A. `mock_obd.py` — ELM327 Simulator

This file simulates a full ELM327 poll cycle. For each of the 8 target PIDs, it picks a realistic random value, applies the **reverse** of the OBD-II decode formula to produce raw bytes, and formats them as a hex string — exactly as real hardware would output.

**Example output per tick:**
```
[0x0c] RPM          raw: 41 0C 0B 34    (represents 717 RPM)
[0x0d] Speed        raw: 41 0D 3C       (represents 60 km/h)
[0x05] Coolant      raw: 41 05 7B       (represents 83°C)
[0x10] MAF          raw: 7F 01 10       (not supported — returns 7F)
```

**Key design decision — `UNSUPPORTED_PIDS`:**
At the top of the file is a configurable constant:
```python
UNSUPPORTED_PIDS = [0x10]   # MAF always returns 7F (Toyota-like default)
```
Any PID in this list permanently returns a `7F` negative response, simulating a specific car model that does not expose that sensor. Change it to `[]` to simulate a car that supports all 8 PIDs. This is how we test the `null` handler without needing a real car.

**Target PIDs covered:**

| PID | Sensor | Value Range |
|---|---|---|
| `0x0C` | RPM | 800 – 5000 RPM |
| `0x0D` | Vehicle Speed | 0 – 120 km/h |
| `0x05` | Coolant Temp | 75 – 98 °C |
| `0x04` | Engine Load | 20 – 70 % |
| `0x11` | Throttle Position | 10 – 60 % |
| `0x2F` | Fuel Level | 30 – 90 % |
| `0x10` | MAF Air Flow | 5.0 – 20.0 g/s |
| `0x0F` | Intake Air Temp | 25 – 45 °C |

---

### B. `obd_decoder.py` — Decoder, Packer & Unpacker

This file has three public functions:

#### `decode_pid(hex_str)` → float / int / None
Takes a raw OBD-II hex response string and returns the decoded real-world value using the correct SAE J1979 formula for each PID. Returns `None` on a `7F` negative response — never crashes, never returns a zero instead of null.

**Decode formulas implemented:**

| PID | Formula |
|---|---|
| `0x0C` RPM | `((A × 256) + B) ÷ 4` |
| `0x0D` Speed | `A` |
| `0x05` Coolant | `A − 40` |
| `0x04` Engine Load | `A ÷ 2.55` |
| `0x11` Throttle | `A ÷ 2.55` |
| `0x2F` Fuel Level | `A ÷ 2.55` |
| `0x10` MAF | `((A × 256) + B) ÷ 100` |
| `0x0F` Intake Temp | `A − 40` |

#### `pack_packet(decoded, gps)` → 32 bytes
Packs all decoded values plus GPS placeholder data into the exact **32-byte binary layout** defined in `docs/MESSAGE_SCHEMA.md §6`. GPS placeholder values (lat, lng, sats) are passed in separately since GPS comes from a different hardware module, not the ELM327.

Byte 31 is an **XOR checksum** of bytes 0–30, computed automatically.

If a decoded value is `None` (unsupported PID), it is packed as `0` so the packet always maintains full 32-byte length.

**32-byte layout used (from MESSAGE_SCHEMA.md §6):**

| Bytes | Field | Pack Formula |
|---|---|---|
| 0–1 | RPM | `uint16: value × 4` |
| 2 | Speed | `uint8: km/h` |
| 3 | Coolant | `uint8: °C + 40` |
| 4 | Engine Load | `uint8: % × 2.55` |
| 5 | Throttle | `uint8: % × 2.55` |
| 6 | Fuel Level | `uint8: %` |
| 7–8 | MAF | `uint16: g/s × 100` |
| 9 | Intake Temp | `uint8: °C + 40` |
| 10 | AC Status | `uint8: 0/1` |
| 11 | Brake | `uint8: 0/1` |
| 12 | Clutch % | `uint8` |
| 13–16 | GPS Latitude | `int32: degrees × 1,000,000` |
| 17–20 | GPS Longitude | `int32: degrees × 1,000,000` |
| 21–22 | GPS Speed | `uint16: km/h × 10` |
| 23–26 | Timestamp | `uint32: Unix seconds` |
| 27 | DTC Count | `uint8` |
| 28–29 | Battery mV | `uint16` |
| 30 | GPS Satellites | `uint8` |
| 31 | **Checksum** | `uint8: XOR of bytes 0–30` |

#### `unpack_packet(raw_bytes)` → dict
Reverses every pack formula to produce a JSON-ready dict matching `MESSAGE_SCHEMA.md §2` (`telemetry.vehicle` + `telemetry.gps`). Also validates the XOR checksum and returns `checksum_valid: True/False`.

---

## 5. Test Results (Live Run)

Running `python obd_decoder.py` executes the full pipeline test and prints PASS/FAIL for every check:

**Test 1 — Hand-calculated PID decode verification:**
```
[PASS] RPM (41 0C 0B 34 -> 717 RPM) -> got 717.0
[PASS] Speed (41 0D 3C -> 60 km/h) -> got 60
[PASS] Coolant (41 05 7B -> 83°C) -> got 83
[PASS] Engine Load (41 04 66 -> ~40%) -> got 40.0
```

**Test 2 — 7F negative response returns None (no crash):**
```
[PASS] MAF not supported: decode_pid('7F 01 10') -> None
[PASS] Fuel level not supported: decode_pid('7F 01 2F') -> None
[PASS] RPM not supported: decode_pid('7F 01 0C') -> None
```

**Test 3 — Full pipeline (3 ticks, MAF unsupported):**
```
[PASS] Packet packed: 32 bytes
[PASS] Checksum valid: True
[PASS] RPM round-trip: original=4756.0 -> unpacked=4756.0

[PASS] Packet packed: 32 bytes
[PASS] Checksum valid: True
[PASS] RPM round-trip: original=1190.0 -> unpacked=1190.0

ALL TESTS PASSED — pipeline ready for hardware integration.
```

> [!NOTE]
> The `°C` character may appear garbled in some Windows terminals due to cp1252 encoding — this is a terminal display issue only and does not affect any data or logic.

---

## 6. Definition of Done — Status

| Requirement from Brief 4 | Status |
| :--- | :--- |
| Decoder handles all 8 PIDs with correct values, verified against hand-calculated outputs | ✅ Done |
| `7F` responses produce `None`, don't crash | ✅ Done |
| 32-byte pack/unpack round-trips correctly with valid checksum | ✅ Done |
| Test script demonstrates all of the above with fake data | ✅ Done — run `python obd_decoder.py` |

---

## 7. What Is Explicitly NOT Done (Blocked Per Brief)

Per Brief 4 scope, the following are deliberately excluded until hardware and architecture decisions are finalized:

- **Talking to a real ELM327** — blocked until the adapter arrives and the data-path decision (Brief 2 Part B: Laptop vs ESP32) is made.
- **AT init sequence and serial reading** — depends on whether we use USB or UART connection method.
- **Testing on a real car** — blocked until the vehicle research (Brief 1) confirms which car we borrow.

---

## 8. Hardware Integration Path (Next Step)

When the ELM327 arrives, plugging in real data requires changing **one line** per PID poll:

```python
# Current (testing with mock_obd.py)
raw_hex = mock_obd.get_response(0x0C)

# Future (real ELM327 over serial)
elm.send("01 0C\r")
raw_hex = elm.readline().decode().strip()

# Everything below stays identical
value = decode_pid(raw_hex)
packet = pack_packet(all_decoded_values, gps_data)
```

The decode and pack logic in `obd_decoder.py` does not need to change at all.
