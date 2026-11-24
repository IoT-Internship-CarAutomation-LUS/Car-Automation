# Telemetry Dashboard — Expected Frame Format

**Owner:** Person A (Telemetry Dashboard)
**Source of truth:** `MESSAGE_SCHEMA.md` section 2. This file just states, plainly, what a dashboard parses, so the hardware/backend side can check their output against it. If the two ever disagree, `MESSAGE_SCHEMA.md` wins and this file is out of date — update it there first.

> **Updated 2026-11-25 (schema v2.1.0).** This file had drifted from the v2.0.0 decoder. It still showed the v1 shape: `battery_mv` (integer millivolts), `clutch_pct`, a `gear` of 4 and real tyre numbers, and no `schema_version`, `ambient_temp_c`, `map_kpa`, `mil_on` or `device` block. The example below is now what `backend/obd_decoder.py` `unpack_packet()` actually emits, plus the envelope and tyre block the sender adds: `battery_v` in volts, `clutch` / `brake` / `ac_on` as three-state booleans, `tyres` as null **leaves** (TPMS was never wired), and the v2.1.0 additive keys. `fuel_mileage_kmpl` is listed in the schema but is not produced by the decoder; the fleet demo derives it, the live Pi does not send it. `dashboard-telemetry/a.js` itself was not changed and still expects `2.0.0`, so it shows a version warning on v2.1.0 data.

## What the dashboard listens for

The dashboard connects over WebSocket to the backend (`wss://api.nalusa.space/ws`, or `ws://localhost:8000/ws` for the local demo) and reads every message as JSON. It only acts on messages where `"type": "telemetry"`. Any other `type` (for example `demo_control`) is ignored by Dashboard 1.

**Important — this is JSON only.** Dashboard 1 does not decode the raw 32-byte vehicle packet or the 16-byte tyre packet described in `MESSAGE_SCHEMA.md` §4 / §4b. That unpacking happens once, upstream, on the Pi/backend. (The fleet demo dashboard *displays* `packet_hex` and `tpms_hex` byte by byte for teaching, but still reads its values from the JSON.)

## Exact shape expected (v2.1.0)

```json
{
  "type": "telemetry",
  "schema_version": "2.1.0",
  "ts": 1719750000000,
  "source": {
    "vehicle_id": "fronx", "name": "Maruti Suzuki Fronx", "model_year": 2024,
    "reg_no": null, "powertrain": "petrol", "data_mode": "live"
  },
  "vehicle": {
    "rpm": 2450,
    "speed_kmh": 62,
    "gear": null,
    "throttle_pct": 28.0,
    "coolant_c": 89,
    "fuel_level_pct": null,
    "maf_gps": 12.6,
    "engine_load_pct": 41.0,
    "intake_temp_c": 34,
    "ambient_temp_c": null,
    "map_kpa": 98,
    "battery_v": 13.8,
    "mil_on": false,
    "dtc_count": 0,
    "brake": null,
    "clutch": null,
    "ac_on": null
  },
  "tyres": {
    "fl": { "pressure_kpa": null, "temp_c": null },
    "fr": { "pressure_kpa": null, "temp_c": null },
    "rl": { "pressure_kpa": null, "temp_c": null },
    "rr": { "pressure_kpa": null, "temp_c": null }
  },
  "gps": {
    "lat": 12.920364,
    "lng": 80.131663,
    "sats": 7,
    "fix": true,
    "heading_deg": null
  },
  "device": { "power_ok": true, "gps_ok": true, "can_ok": false, "seq": 42 },
  "cabin": { "temp_c": null, "humidity_pct": null },
  "gsm":   { "rssi_dbm": null },
  "ev":    { "soc_pct": null, "range_km": null },
  "packet_hex": "…32 bytes as spaced hex…",
  "tpms_hex": null,
  "crc_valid": true,
  "tpms_crc_valid": null,
  "provenance": {
    "vehicle": "measured", "tyres": "not_supported", "gps": "measured",
    "cabin": "not_supported", "gsm": "not_supported", "ev": "not_applicable"
  }
}
```

## Rules the dashboard relies on

1. **`ts` is required** and must be milliseconds since Unix epoch. It drives the per-panel freshness dots — if `now - ts > 3000ms`, the relevant panel greys out. Send it on every message, not just the first.
2. **Send `null`, never omit the key**, for a field that has no current reading (e.g. no GPS fix yet, sensor not wired up). `"tyres": null` is wrong; four objects with null leaves is right.
3. **`null` is not zero and not off.** `brake` / `clutch` / `ac_on` = `null` means the signal has not been found on the CAN bus — show UNKNOWN, never OFF. `fuel_level_pct` = `null` means the car does not report it — never show an empty tank.
4. **Battery is `battery_v`, in volts** (one decimal, e.g. `13.8`), not `battery_mv`.
5. **Tyre pressure is `pressure_kpa`, not PSI.** The dashboard converts to PSI for display if it wants to.
6. **`gps.fix` must be `true` before the dashboard trusts `lat`/`lng`.**
7. **One message per tick**, roughly once per second.
8. **`provenance`** (v2.1.0) says whether each group is measured, simulated, derived, not supported or not applicable; label values with it.
