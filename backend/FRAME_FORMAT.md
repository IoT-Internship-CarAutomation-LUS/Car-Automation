# Telemetry Dashboard — Expected Frame Format

**Owner:** Person A (Telemetry Dashboard)
**Source of truth:** `MESSAGE_SCHEMA.md` section 2. This file just states, plainly, what `a.js` actually parses right now, so the hardware/backend side can check their output against it. If the two ever disagree, `MESSAGE_SCHEMA.md` wins and this file is out of date — update it there first.

## What the dashboard listens for

The dashboard connects over WebSocket to `ws://<ESP32_IP>:81` and reads every message as JSON. It only acts on messages where `"type": "telemetry"`. Any other `type` (e.g. `platform_status`, `command`) is logged to the terminal panel but otherwise ignored — those belong to the Control Console dashboard.

**Important — this is JSON only.** The dashboard does not decode the raw 32-byte vehicle packet or 16-byte tyre packet described in `MESSAGE_SCHEMA.md` section 6. That unpacking happens once, upstream, on the firmware/backend. If the backend sends raw bytes over this socket instead of the JSON below, nothing will render.

## Exact shape expected

```json
{
  "type": "telemetry",
  "ts": 1719750000000,
  "vehicle": {
    "rpm": 2450,
    "speed_kmh": 62,
    "gear": 4,
    "clutch_pct": 0,
    "brake": false,
    "throttle_pct": 28,
    "engine_load_pct": 41,
    "fuel_level_pct": 73,
    "fuel_mileage_kmpl": 16.4,
    "coolant_c": 89,
    "intake_temp_c": 34,
    "maf_gps": 12.6,
    "ac_on": true,
    "dtc_count": 0,
    "battery_mv": 13800
  },
  "tyres": {
    "fl": { "pressure_kpa": 220.0, "temp_c": 38.5 },
    "fr": { "pressure_kpa": 218.5, "temp_c": 39.0 },
    "rl": { "pressure_kpa": 221.0, "temp_c": 37.5 },
    "rr": { "pressure_kpa": 219.5, "temp_c": 38.0 }
  },
  "gps": {
    "lat": 12.920364,
    "lng": 80.131663,
    "speed_kmh": 60,
    "sats": 7,
    "fix": true
  }
}
```

## Rules the dashboard relies on

1. **`ts` is required** and must be milliseconds since Unix epoch. It drives the per-panel freshness dots — if `now - ts > 3000ms`, the relevant panel (Drivetrain, TPMS, or GPS) greys out. Send it on every message, not just the first.
2. **Send `null`, never omit the key**, for a field that has no current reading (e.g. no GPS fix yet, sensor not wired up). Omitting a key entirely is treated the same as "this whole sub-object wasn't sent this tick," which affects freshness tracking for that section.
3. **`vehicle`, `tyres`, and `gps` are independent sub-objects.** Each one updates its own freshness dot. If, say, GPS is on a slower cadence than the OBD reads, that's fine — just include a `ts` that reflects when each part was actually sampled, or send them together in one message (recommended for now, and what the current dashboard code assumes).
4. **Tyre pressure is `pressure_kpa`, not PSI.** The dashboard converts to PSI for display. Don't pre-convert on the hardware side.
5. **`gps.fix` must be `true` before the dashboard trusts `lat`/`lng`.** If `fix` is `false` or missing, the marker and breadcrumb trail won't move, even if `lat`/`lng` happen to be present.
6. **One message per tick is fine** — the dashboard doesn't require `vehicle`, `tyres`, and `gps` to arrive in separate messages. Roughly once per second, per `MESSAGE_SCHEMA.md` section 2.

## Not currently wired up

The dashboard renders every field in the schema above. If new fields get added to `MESSAGE_SCHEMA.md` §2 later, they won't show up here until `a.js` is updated to bind them to a panel — that's a code change, not just a schema change.
