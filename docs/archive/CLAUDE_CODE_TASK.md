# Claude Code Task: schema v2.0.0 migration + Track 2 removal

**This file replaces `CLAUDE_CODE_V2_TASK.md`. Use this one instead — it is that task plus the Track 2 cleanup, so the repo is touched once.**

Two files are already written and tested. **Do not rewrite them:**

- `backend/obd_decoder.py` — v2, self-test passes (`python obd_decoder.py`)
- `backend/session_logger.py` — new, tested

Everything else is your job.

**Ground rules.** Do not invent byte offsets, scalings, or field names — they are fixed by `obd_decoder.py`, which is the source of truth for the wire format. Read it first. Run `python obd_decoder.py` before and after; it must pass. Do not commit; leave changes for review.

---

# PART A — Remove Track 2

## Context

Track 2 was the self-driving model car (RC platform with A* pathfinding, ultrasonic obstacle avoidance, a 100 m demo run). **It is cancelled.** The project is now real-car data acquisition only.

Real-car acceleration and braking will be designed fresh later. **Do not preserve the existing `command` path for reuse.** It is RC-specific (`forward`/`stop`/`brake`/`estop` with `target_speed_kmh`), and on a real vehicle a WebSocket `estop` is not a safety mechanism — that has to be a physical kill switch cutting actuator power. Reusing this path would import a model-car safety model into a real vehicle. Delete it.

## A1. Delete these files entirely

| File | Reason |
|---|---|
| `backend/mock_platform.py` | Track 2. Also superseded by `mock_rc_platform.py`. |
| `backend/mock_rc_platform.py` | Track 2. |
| `backend/mock_obd.py` | **Orphaned.** The v1 decoder's test imported it; the v2 decoder has a self-contained test. Nothing references it now. Verify with a repo-wide grep for `mock_obd` before deleting. |

## A2. `backend/database.py`

Remove:
- the `platform_status` table from `init_db()`
- `save_platform_status()`
- `get_platform_history()`

Keep `telemetry`, `save_telemetry()`, `get_latest_telemetry()`, `get_telemetry_history()`, `get_gps_track()`.

**Do not touch `get_gps_track()`.** It filters on `gps.get("fix") is True`. That filter was correct all along but returned nothing, because v1 never sent `gps.fix`. v2 sends it, so this endpoint comes alive on its own.

**Existing DB files:** dropping the table from `init_db()` does not remove it from an existing `telemetry.db`. That is fine — leave old rows alone, do not write a migration. Note it in your report.

## A3. `backend/routes.py`

Remove:
- `GET /api/platform/history`
- `POST /api/command` (and its `valid_actions` set)

Keep `/api/health`, `/api/telemetry/latest`, `/api/telemetry/history`, `/api/gps/track`.

## A4. `backend/websocket_handler.py`

Remove the `platform_status` and `command` branches from the routing block, and the `save_platform_status` import. Only `telemetry` remains; anything else falls through to the existing "unknown message type" log.

## A5. Dashboards — REPORT ONLY, DO NOT EDIT

These are owned by other people. List what breaks; do not touch them.

| File | Finding |
|---|---|
| `dashboard-control/` (`index.html`, `control-console.js`, `control-console.css`) | **Entirely Track 2.** It is the RC control console: estop, distance, obstacle avoidance. Its purpose no longer exists. |
| `history.html`, `history.js` | **Track 2.** Contains `avoidance`, `obstacle_cm`, `distance_m`, `drive_state` — this is RC drive replay, not car history. |
| `dashboard-telemetry/a.js` | Track 1, keep. But it references `platform_status` and sends a `msg_driver` command, both now dead. It also reads `clutch_pct` (percent) and `battery_mv` — **both removed in v2.** |

---

# PART B — Migrate to schema v2.0.0

## The v2 packet

| Byte | Field | Encoding |
|---|---|---|
| 0-3 | timestamp | uint32 Unix seconds |
| 4-5 | RPM | uint16, value × 4, `0xFFFF`=NA |
| 6 | speed | uint8 km/h, `0xFF`=NA |
| 7-10 | GPS lat | int32, deg × 1e6, `0x7FFFFFFF`=NA |
| 11-14 | GPS lng | int32, deg × 1e6, `0x7FFFFFFF`=NA |
| 15 | sats + fix | bits 0-5 sats, bit 6 fix |
| 16-17 | MAF | uint16, g/s × 100, `0xFFFF`=NA |
| 18 | gear | uint8, `0xFF`=unknown |
| 19 | throttle | uint8, **% × 2**, `0xFF`=NA |
| 20 | coolant | uint8, °C + 40, `0xFF`=NA |
| 21 | fuel level | uint8, **% × 2**, `0xFF`=NA |
| 22 | battery | uint8, volts × 10, `0xFF`=NA |
| 23 | MIL + DTC | bit 7 MIL, bits 0-6 count, `0xFF`=NA |
| 24 | AC/brake/clutch | bit-packed with validity bits |
| 25 | engine load | uint8, **% × 2**, `0xFF`=NA |
| 26 | intake temp | uint8, °C + 40, `0xFF`=NA |
| 27 | ambient temp | uint8, °C + 40, `0xFF`=NA |
| 28 | MAP | uint8 kPa, `0xFF`=NA |
| 29 | device health | bit 7 power, bit 6 gps, bit 5 can |
| 30 | sequence | uint8, N mod 256 |
| 31 | CRC-8 | CRC-8-CCITT over bytes 0-30 |

Byte 24: bit 0 brake state / bit 1 brake valid / bit 2 clutch state / bit 3 clutch valid / bit 4 ac state / bit 5 ac valid.

**Percent fields are × 2, not × 2.55.** With × 2.55, 100% equals 255 which is the "unavailable" sentinel, so wide-open throttle would read as unknown. Do not "correct" this back.

**A validity bit of 0 means UNKNOWN, not "off".** Those three signals have not been found on the CAN bus yet.

## B1. `backend/config.py`

```python
SCHEMA_VERSION = "2.0.0"
```

## B2. `backend/elm327_bt.py`

The capture logic, the four run modes, the SEARCHING recovery in `query_pid()`, and the reconnect loop are correct. Keep them. Change only what follows.

**B2a. Logging.** Apply `LOGGING_INTEGRATION.md` in full. It replaces `init_csv`/`log_csv` with `SessionLogger`. Delete both functions and the `CSV_LOG_PATH` constant.

**B2b. New PIDs.** Import the list rather than redeclaring:

```python
from obd_decoder import decode_pid, decode_atrv, pack_packet, unpack_packet, TARGET_PIDS
```

Eleven PIDs now, up from eight. Update `PID_NAMES`:

```python
PID_NAMES = {
    0x0C: "rpm", 0x0D: "speed_kmh", 0x05: "coolant_c",
    0x04: "engine_load_pct", 0x11: "throttle_pct",
    0x2F: "fuel_level_pct", 0x10: "maf_gps", 0x0F: "intake_temp_c",
    0x46: "ambient_temp_c", 0x0B: "map_kpa", 0x01: "mil_dtc",
}
```

Add the same three columns to `FIELDS["decoded"]` in `session_logger.py`.

**B2c. Probe supported PIDs once at startup.** After `initialise_elm327()` succeeds, send `0100`, print the raw reply prominently, and log it. This is the car's own statement of what it supports and is a required deliverable. Do not gate polling on it — just capture it.

**B2d. Real battery via ATRV**, once per cycle:

```python
ser.reset_input_buffer()
ser.write(b"ATRV\r")
battery_v = decode_atrv(read_until_prompt(ser, timeout=2.0))
```

**B2e. Pass extras to pack_packet.** Replace the current `pack_packet(decoded, GPS_PLACEHOLDER)`:

```python
seq = (seq + 1) & 0xFF
gps = {"lat": None, "lng": None, "sats": 0, "fix": False}   # until GPS is wired
extras = {
    "battery_v": battery_v,
    "gear": None,
    "seq": seq,
    "can": {"brake": None, "clutch": None, "ac": None},   # not found yet
    "health": {"power_ok": True, "gps_ok": gps["fix"], "can_ok": False},
}
raw_bytes  = pack_packet(decoded, gps, extras)
packet_hex = raw_bytes.hex(' ').upper()
unpacked   = unpack_packet(raw_bytes)
```

Keep the pack/unpack round trip — it validates the CRC against real car data before the ESP32 stage needs it. Assert `unpacked["crc_valid"]` and warn if false. Delete `GPS_PLACEHOLDER`.

**B2f. Fix the telemetry envelope.** Two bugs:

```python
telemetry_packet = {
    "type": "telemetry",
    "schema_version": SCHEMA_VERSION,
    "ts": ts_ms,
    "vehicle": unpacked["vehicle"],
    "tyres": {                            # BUG: was "fl": None
        "fl": {"pressure_kpa": None, "temp_c": None},
        "fr": {"pressure_kpa": None, "temp_c": None},
        "rl": {"pressure_kpa": None, "temp_c": None},
        "rr": {"pressure_kpa": None, "temp_c": None},
    },
    "gps": unpacked["gps"],               # BUG: v1 never sent gps.fix
    "device": unpacked["device"],
}
```

Nulls belong on leaf fields, not the sub-object. `gps.fix` missing in v1 silently killed the map trail and `get_gps_track()`.

**B2g. Drain the WebSocket under `--stream`.** See B4. The backend echoes every message back to the sender and this script never reads them, so the buffer fills and capture freezes mid-session. Add a background thread calling `ws_client.recv()` and discarding, or drain with a short timeout each cycle. A recv error must not kill the capture.

## B3. `backend/mock_telemetry.py`

This is how the dashboards get tested without hardware, so it must match v2 exactly.

- `SCHEMA_VERSION = "2.0.0"` (currently `0.9.0` while `config.py` says `1.0.0` — that mismatch warns on every message and looks like a real failure when debugging something else)
- `battery_mv` → `battery_v` (float volts, e.g. `13.8`)
- `clutch_pct` (0-100) → `clutch` (bool or `None`)
- `brake_pct` → **delete**; `brake` becomes bool or `None`
- add `mil_on` (bool/`None`), `ambient_temp_c`, `map_kpa`
- add `device`: `{"power_ok": true, "gps_ok": true, "can_ok": false, "seq": n}`
- **Emit `None` sometimes.** Roughly 1 in 5 messages should have `fuel_level_pct: None` and `ac_on`/`brake`/`clutch` as `None`, so the dashboards get exercised against unavailable data. That is the entire point of v2 and the mock must reflect it.
- keep `fuel_mileage_kmpl` and `gear` — backend-derived, not packet fields

## B4. `backend/websocket_handler.py` — BUG

```python
async def fan_out(raw_message: str, sender: WebSocket):
    """Send a message to every connected client, including the sender."""
    for client in connected_clients:
        await client.send_text(raw_message)
```

`sender` is accepted and never used, so every telemetry message is echoed back to the sender. With Track 2 gone there is no command path that might rely on the echo, so simply skip the sender:

```python
for client in connected_clients:
    if client is sender:
        continue
```

## B5. `docs/MESSAGE_SCHEMA.md`

The team's source of truth. Currently documents v1.

- version → `2.0.0` throughout
- section 6 byte table → the v2 table above
- section 2 telemetry example → new field set, showing `null` for fuel and the CAN fields
- field reference → new fields; note the `×2` percent scaling and every sentinel
- **new section:** unavailable values — `0xFF` / `0xFFFF` / `0x7FFFFFFF` → `null` in JSON
- **new section:** byte 24 validity bits; state plainly that valid=0 means unknown, not off
- **delete section 3** (`platform_status`) and **section 4** (`command`) — Track 2
- section 5 connection details → remove the platform/ESP32-direct references
- section 8 "known drift" → the `msg_driver` / `left`/`right`/`backward`/`start` rows are all Track 2 or dropped features. Delete the section or mark them removed.
- change log → add a v2.0.0 row dated today, marked **breaking**, listing: Track 2 removed; nulls no longer become zero; percent scaling changed; CRC-8 replaces XOR; `battery_mv`→`battery_v`; `clutch_pct`→`clutch` bool; `brake_pct` removed; new fields added

## B6. `backend/README.md`

Update so it does not become a third source of truth contradicting `MESSAGE_SCHEMA.md`:
- remove the deleted mock scripts and endpoints
- remove `platform_status` / command relay from the responsibilities list
- keep the "open item: cloud migration" note

---

# Report back

1. Does `python obd_decoder.py` still pass?
2. Files deleted, files changed.
3. Confirm nothing still imports `mock_obd`, `mock_platform`, or `mock_rc_platform`.
4. The dashboard breakages from A5, listed for their owners.
5. Anything in Part A you found that this task did not anticipate.
