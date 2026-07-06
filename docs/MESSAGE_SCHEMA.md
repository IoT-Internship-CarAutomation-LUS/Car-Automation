# Shared Message Schema — LUS Car Automation

**One source of truth for both dashboards and the backend.**
Do not invent your own field names. If a field is missing, raise it with the team lead and it gets added *here* first.

---

## 0. How the data flows (read this first)

There are two links, and they use two different formats. Do not mix them up.

```
  [ Hardware: ESP32 ]
        |
        |   Link 1: compact BINARY packets  (32-byte vehicle, 16-byte tyres)
        |            -- bandwidth-efficient, this is the "wire format"
        v
  [ ESP32 firmware / Backend ]   <-- unpacks the bytes ONCE here
        |
        |   Link 2: JSON over WebSocket   <-- BOTH dashboards use this
        v
  [ Dashboard 1: Telemetry ]   [ Dashboard 2: Control Console ]
```

**Rule for the UI people:** you only ever deal with **JSON** (Link 2). You never parse raw bytes in the browser. The byte layout is included at the end only so everyone can see where each JSON field comes from.

---

## 1. Message envelope

Every WebSocket message is a JSON object with a `type` field. The receiver switches on `type`.

| `type` | Direction | Used by | Meaning |
|--------|-----------|---------|---------|
| `telemetry` | hardware → UI | Dashboard 1 | Real-car data (ELM327 + TPMS + GPS) |
| `platform_status` | platform → UI | Dashboard 2 | Feedback from the car we built |
| `command` | UI → platform | Dashboard 2 | A control instruction (drive, brake, etc.) |

Every message also carries `ts` = timestamp in **milliseconds** (Unix epoch). The UI uses `ts` to show the "fresh vs stale" indicator: if `now - ts > 3000 ms`, grey the value out.

---

## 2. `telemetry` — real car → Dashboard 1

Sent roughly once per second. All fields optional-safe: if a value is unavailable, send `null` (never omit the key).

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

### Field reference

| Path | Unit / Range | Notes |
|------|--------------|-------|
| `vehicle.rpm` | 0–16383 RPM | OBD PID 0x0C |
| `vehicle.speed_kmh` | 0–255 km/h | OBD PID 0x0D |
| `vehicle.gear` | 0–8, `0`=neutral | may be derived on manual cars |
| `vehicle.clutch_pct` | 0–100 % | 0 = released, 100 = pressed |
| `vehicle.brake` | `true`/`false` | brake pedal pressed |
| `vehicle.throttle_pct` | 0–100 % | OBD PID 0x11 |
| `vehicle.engine_load_pct` | 0–100 % | OBD PID 0x04 |
| `vehicle.fuel_level_pct` | 0–100 % | OBD PID 0x2F |
| `vehicle.fuel_mileage_kmpl` | km/L | calculated from MAF + speed |
| `vehicle.coolant_c` | −40 to 215 °C | OBD PID 0x05 |
| `vehicle.intake_temp_c` | −40 to 215 °C | OBD PID 0x0F |
| `vehicle.maf_gps` | g/s | OBD PID 0x10 |
| `vehicle.ac_on` | `true`/`false` | AC compressor status |
| `vehicle.dtc_count` | 0–255 | active fault codes |
| `vehicle.battery_mv` | millivolts | e.g. 13800 = 13.8 V |
| `tyres.<pos>.pressure_kpa` | kPa (one decimal) | pos = fl, fr, rl, rr |
| `tyres.<pos>.temp_c` | °C (one decimal) | high-temp alert > 90 °C |
| `gps.lat` / `gps.lng` | decimal degrees | 6 decimal places |
| `gps.speed_kmh` | km/h | cross-check vs vehicle.speed_kmh |
| `gps.sats` | integer | satellites used; quality indicator |
| `gps.fix` | `true`/`false` | false = no valid position yet |

---

## 3. `platform_status` — built platform → Dashboard 2

Sent ~5 times per second (the control loop is fast). This is the feedback that drives the 100 m demo view.

```json
{
  "type": "platform_status",
  "ts": 1719750000000,
  "drive_state": "FORWARD",
  "avoidance_state": "CLEAR",
  "distance_m": 42.7,
  "target_distance_m": 100.0,
  "speed_kmh": 4.2,
  "target_speed_kmh": 5.0,
  "obstacle_cm": 180,
  "heading_deg": 271.5,
  "battery_mv": 11600
}
```

### Field reference

| Path | Unit / Range | Notes |
|------|--------------|-------|
| `drive_state` | `IDLE` \| `FORWARD` \| `BRAKING` \| `STOPPED` \| `ESTOP` | current motion state |
| `avoidance_state` | `CLEAR` \| `SLOWING` \| `BRAKING` | collision-avoidance banner. `CLEAR`=green, `SLOWING`=amber, `BRAKING`=red |
| `distance_m` | metres | from wheel encoders; progress toward target |
| `target_distance_m` | metres | usually 100.0 |
| `speed_kmh` | km/h | measured from encoders |
| `target_speed_kmh` | km/h | what the controller is aiming for |
| `obstacle_cm` | cm | front sensor (ultrasonic/ToF). `-1` = no reading / out of range |
| `heading_deg` | 0–360° | from IMU; for straight-line hold (optional) |
| `battery_mv` | millivolts | platform battery |

---

## 4. `command` — Dashboard 2 → built platform

Sent when the user presses a button or moves the slider. Keep it tiny.

```json
{ "type": "command", "action": "forward", "target_speed_kmh": 5.0 }
```

```json
{ "type": "command", "action": "set_speed", "target_speed_kmh": 3.0 }
```

```json
{ "type": "command", "action": "stop" }
```

```json
{ "type": "command", "action": "brake" }
```

```json
{ "type": "command", "action": "estop" }
```

### Actions

| `action` | Extra field | Meaning |
|----------|-------------|---------|
| `forward` | `target_speed_kmh` | start driving forward at the given speed |
| `set_speed` | `target_speed_kmh` | change target speed while moving |
| `stop` | — | coast to a stop (cut power, no hard brake) |
| `brake` | — | active braking (short motor terminals) |
| `estop` | — | **emergency stop** — immediate hard stop, overrides everything |

**Safety rule (both UI and firmware must honour):** `estop` always wins. After an `estop`, the platform stays stopped until a fresh `forward` command is sent. The Emergency Stop button in the UI must be big and always visible.

---

## 5. Connection details

- Transport: **WebSocket**
- Dev URL (direct to ESP32): `ws://<ESP32_IP>:81`
- Via backend (current): `wss://api.nalusa.space/ws` — same message formats, no change to either dashboard. (Dashboard 1 is deployed separately at `lus.nalusa.space`, Dashboard 2 at `dashboard2.nalusa.space` — neither is the backend host.)
- On connect, hardware/backend may send one `telemetry` or `platform_status` immediately so the UI isn't blank.

---

## 6. Byte-layout reference (Link 1 — hardware/backend only)

UI people can ignore this. This is only for the firmware/backend person who unpacks the binary into the JSON above.

### 32-byte vehicle packet → maps to `telemetry.vehicle` + `telemetry.gps`

| Bytes | Field | Encoding |
|-------|-------|----------|
| 0–1 | RPM | uint16, raw ÷ 4 |
| 2 | Speed | uint8 km/h |
| 3 | Coolant | uint8, value − 40 = °C |
| 4 | Engine load | uint8, raw ÷ 2.55 = % |
| 5 | Throttle | uint8 % |
| 6 | Fuel level | uint8 % |
| 7–8 | MAF | uint16, ÷100 = g/s |
| 9 | Intake temp | uint8, value − 40 = °C |
| 10 | AC status | uint8 0/1 |
| 11 | Brake | uint8 0/1 |
| 12 | Clutch | uint8 % |
| 13–16 | GPS latitude | int32, ÷ 1e6 = degrees |
| 17–20 | GPS longitude | int32, ÷ 1e6 = degrees |
| 21–22 | GPS speed | uint16, ÷10 = km/h |
| 23–26 | UTC timestamp | uint32 Unix seconds |
| 27 | DTC count | uint8 |
| 28–29 | Battery | uint16 mV |
| 30 | GPS satellites | uint8 |
| 31 | Checksum | uint8 XOR of bytes 0–30 |

### 16-byte tyre packet → maps to `telemetry.tyres`

| Bytes | Field | Encoding |
|-------|-------|----------|
| 0–1 | FL pressure | uint16, ÷10 = kPa |
| 2–3 | FL temp | int16, ÷10 = °C |
| 4–5 | FR pressure | uint16, ÷10 = kPa |
| 6–7 | FR temp | int16, ÷10 = °C |
| 8–9 | RL pressure | uint16, ÷10 = kPa |
| 10–11 | RL temp | int16, ÷10 = °C |
| 12–13 | RR pressure | uint16, ÷10 = kPa |
| 14–15 | RR temp | int16, ÷10 = °C |

---

## 7. Change log

Any change to this schema goes through the team lead and gets a line here so nobody is working off an old copy.

| Date | Change | By |
|------|--------|-----|
| (today) | v1 — initial schema: telemetry, platform_status, command | team lead |

---

## 8. Known drift (pending team-lead decision)

The following fields/actions are already used in shipped code but are **not yet formalized here**. Do not treat their presence in code as approval — they're listed so the drift is visible, pending a decision as part of the upcoming data-standard work. Until then, nothing outside this list should be treated as schema-legal.

| Item | Type | Used in | Notes |
|------|------|---------|-------|
| `brake_pct` | `telemetry.vehicle` field | `backend/mock_telemetry.py`, `dashboard-telemetry/index.html` | Only boolean `brake` is defined above (§2). Dashboard 1 renders a `brake_pct` bar labelled "Digital until hardware sends brake_pct"; the mock sender fabricates a value client-side. |
| `msg_driver` | `command` action | `dashboard-telemetry/a.js` | Not in the §4 action table. Sent from Dashboard 1's outbound message console; no consumer currently handles it. |
| `left`, `right`, `backward`, `start` | `command` actions | `dashboard-control/control-console.js`, `dashboard-control/index.html` | Not in the §4 action table. Wired to Dashboard 2's D-pad/start button; flagged in-code as "pending addition to MESSAGE_SCHEMA.md." No firmware/mock currently handles any of the four. |
