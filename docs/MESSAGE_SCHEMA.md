# Shared Message Schema — LUS Car Automation

**One source of truth for the dashboard and the backend.**
Do not invent your own field names. If a field is missing, raise it with the team lead and it gets added *here* first.

---

## 0. How the data flows (read this first)

There are two links, and they use two different formats. Do not mix them up.

```
  [ Hardware: ELM327 + GPS + ESP32 ]
        |
        |   Link 1: compact BINARY packet  (32-byte vehicle+GPS packet)
        |            -- bandwidth-efficient, this is the "wire format"
        v
  [ Backend ]   <-- unpacks the bytes ONCE here (obd_decoder.py)
        |
        |   Link 2: JSON over WebSocket
        v
  [ Dashboard 1: Telemetry ]
```

**Rule for the UI people:** you only ever deal with **JSON** (Link 2). You never parse raw bytes in the browser. The byte layout is included at the end only so everyone can see where each JSON field comes from.

**Track 2 (the self-driving RC platform / Control Console dashboard) is cancelled.** This document no longer covers `platform_status` or `command` messages — see the change log if you're looking for why they disappeared.

---

## Schema Version

Current version is `2.1.0`. Every message carries a `"schema_version"` field (e.g. `"schema_version": "2.1.0"`) right next to `"type"` and `"ts"`.

**Rule:** Any change to this schema bumps this version number (using MAJOR.MINOR.PATCH format) and gets logged in the change-log table below. No schema change ships without updating this number!

---

## 1. Message envelope

Every WebSocket message is a JSON object with a `type` field. The receiver switches on `type`.

| `type` | Direction | Used by | Meaning |
|--------|-----------|---------|---------|
| `telemetry` | hardware → UI | Dashboard 1, Fleet dashboard | Real-car data (ELM327 + TPMS + GPS), or a recorded / simulated car in the fleet demo |
| `demo_control` | Fleet dashboard → simulator | Fleet demo only | Presenter scenario (v2.1.0). The backend relays it to every other client and does **not** save it — see §2b |

Every message also carries `ts` = timestamp in **milliseconds** (Unix epoch). The UI uses `ts` to show the "fresh vs stale" indicator: if `now - ts > 3000 ms`, grey the value out.

---

## 2. `telemetry` — real car → Dashboard 1

Sent roughly once per second. All fields optional-safe: if a value is unavailable, send `null` (never omit the key).

```json
{
  "type": "telemetry",
  "schema_version": "2.1.0",
  "ts": 1719750000000,
  "source": {
    "vehicle_id": "fronx",
    "name": "Maruti Suzuki Fronx",
    "model_year": 2024,
    "reg_no": "TN 22 DX 4817",
    "powertrain": "petrol",
    "data_mode": "recorded"
  },
  "vehicle": {
    "rpm": 2450,
    "speed_kmh": 62,
    "gear": null,
    "clutch": null,
    "brake": false,
    "throttle_pct": 28,
    "engine_load_pct": 41,
    "fuel_level_pct": null,
    "fuel_mileage_kmpl": 16.4,
    "coolant_c": 89,
    "intake_temp_c": 34,
    "ambient_temp_c": 31,
    "map_kpa": 98,
    "maf_gps": 12.6,
    "ac_on": null,
    "mil_on": false,
    "dtc_count": 0,
    "battery_v": 13.8
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
    "heading_deg": 41.5
  },
  "device": {
    "power_ok": true,
    "gps_ok": true,
    "can_ok": false,
    "seq": 42
  },
  "cabin": { "temp_c": null, "humidity_pct": null },
  "gsm":   { "rssi_dbm": null },
  "ev":    { "soc_pct": null, "range_km": null },
  "packet_hex": "6A 6C AF 8E 0A 80 00 7F FF FF FF 7F FF FF FF 00 00 B7 FF 1D FF FF 87 00 00 26 54 49 1F 80 01 58",
  "tpms_hex": null,
  "crc_valid": true,
  "tpms_crc_valid": null,
  "provenance": {
    "vehicle": "measured",
    "tyres": "not_supported",
    "gps": "simulated",
    "cabin": "not_supported",
    "gsm": "not_supported",
    "ev": "not_applicable",
    "fields": {
      "vehicle.fuel_level_pct": "not_supported",
      "vehicle.brake": "not_supported",
      "vehicle.clutch": "not_supported",
      "vehicle.ac_on": "not_supported",
      "vehicle.fuel_mileage_kmpl": "derived"
    }
  }
}
```

The v2.1.0 keys (`source`, `gps.heading_deg`, `cabin`, `gsm`, `ev`, `packet_hex`, `tpms_hex`, `crc_valid`, `tpms_crc_valid`, `provenance`) are **additive**: a v2.0.0 reader that ignores unknown keys keeps working. The same rule applies to them as to everything else: null on the leaf, never omit the key, never `"cabin": null`.

This example is deliberately realistic, not a best case: `gear`, `clutch`, `fuel_level_pct`, and `ac_on` are `null` because those signals have not been found on the CAN bus yet, and TPMS hardware isn't wired so `tyres` is all `null`. Nulls belong on leaf fields, never on the sub-object itself — `"tyres": null` would make the dashboard's freshness dot go green over dead data.

### Field reference

| Path | Unit / Range | Notes |
|------|--------------|-------|
| `vehicle.rpm` | 0–16383 RPM | OBD PID 0x0C |
| `vehicle.speed_kmh` | 0–254 km/h | OBD PID 0x0D |
| `vehicle.gear` | 0–6, `0`=neutral, `null`=unknown | not yet derived |
| `vehicle.clutch` | `true`/`false`/`null` | `true`=pressed, `false`=released, `null`=not found on CAN bus yet (**not** "released") |
| `vehicle.brake` | `true`/`false`/`null` | `null`=not found on CAN bus yet (**not** "off") |
| `vehicle.throttle_pct` | 0–100 % (0.5% resolution) | OBD PID 0x11, stored on the wire as value×2 |
| `vehicle.engine_load_pct` | 0–100 % (0.5% resolution) | OBD PID 0x04, stored on the wire as value×2 |
| `vehicle.fuel_level_pct` | 0–100 % (0.5% resolution) | OBD PID 0x2F, stored on the wire as value×2 |
| `vehicle.fuel_mileage_kmpl` | km/L | calculated from MAF + speed |
| `vehicle.coolant_c` | −40 to 214 °C | OBD PID 0x05 |
| `vehicle.intake_temp_c` | −40 to 214 °C | OBD PID 0x0F |
| `vehicle.ambient_temp_c` | −40 to 214 °C | OBD PID 0x46 |
| `vehicle.map_kpa` | 0–254 kPa | OBD PID 0x0B (manifold absolute pressure) |
| `vehicle.maf_gps` | g/s | OBD PID 0x10 |
| `vehicle.ac_on` | `true`/`false`/`null` | `null`=not found on CAN bus yet (**not** "off") |
| `vehicle.mil_on` | `true`/`false`/`null` | check-engine lamp, OBD PID 0x01 |
| `vehicle.dtc_count` | 0–127 | active fault codes, OBD PID 0x01 |
| `vehicle.battery_v` | volts (one decimal) | real ATRV reading, e.g. 13.8 = 13.8 V |
| `tyres.<pos>.pressure_kpa` | kPa (one decimal) | pos = fl, fr, rl, rr — `null` until TPMS is wired |
| `tyres.<pos>.temp_c` | °C (one decimal) | high-temp alert > 90 °C — `null` until TPMS is wired |
| `gps.lat` / `gps.lng` | decimal degrees | 6 decimal places, `null` if no fix |
| `gps.sats` | integer | satellites used; quality indicator |
| `gps.fix` | `true`/`false` | false = no valid position yet |
| `device.power_ok` | `true`/`false` | device power rail healthy |
| `device.gps_ok` | `true`/`false` | mirrors `gps.fix` |
| `device.can_ok` | `true`/`false` | CAN bus link healthy |
| `device.seq` | 0–255 | packet sequence counter, wraps at 256 |
| `source.vehicle_id` | string | stable id, e.g. `fronx`, `corolla` (v2.1.0) |
| `source.name` / `source.model_year` | string / integer | display name and model year (v2.1.0) |
| `source.reg_no` | string or `null` | registration plate. Fleet-demo plates are **fake** Tamil Nadu style (`TN 22 DX 4817`); `null` from the real Pi (v2.1.0) |
| `source.powertrain` | `"petrol"` / `"ev"` | an EV has no engine PIDs and no gear estimate (v2.1.0) |
| `source.data_mode` | `"live"` / `"recorded"` / `"simulated"` | `live` = the Pi on the real car right now; `recorded` = a real logged session replayed; `simulated` = made up by the demo simulator (v2.1.0) |
| `gps.heading_deg` | 0–359.9 °, true north | course over ground from the GPS; `null` when unknown. JSON only, not in the 32-byte packet (v2.1.0) |
| `cabin.temp_c` / `cabin.humidity_pct` | °C / % RH | DHT11 on Board 1. JSON only (v2.1.0) |
| `gsm.rssi_dbm` | dBm (−113 to −51) | SIM800L signal on Board 2 (`AT+CSQ` converted). JSON only (v2.1.0) |
| `ev.soc_pct` / `ev.range_km` | % / km | battery state of charge and estimated range; both `null` for petrol cars (v2.1.0) |
| `vehicle.rpm` (EV) | 0–16383 | for `powertrain: "ev"` this carries **motor** RPM in the same PID 0x0C slot (v2.1.0) |
| `vehicle.gear` (range) | 0–7 | `7` is only used by the 7-speed demo Veyron; `null` and never estimated for EVs (v2.1.0) |
| `packet_hex` | string | the 32-byte packet this message was unpacked from, as spaced upper-case hex (v2.1.0) |
| `tpms_hex` | string or `null` | the 16-byte TPMS packet (§4b) as spaced hex, `null` when there is no TPMS (v2.1.0) |
| `crc_valid` / `tpms_crc_valid` | `true`/`false`/`null` | CRC-8 result of the unpack of each packet; `null` when that packet does not exist (v2.1.0) |
| `provenance.<group>` | see below | where each group's values came from (v2.1.0) |
| `provenance.fields` | `{ "<group>.<leaf>": state }` | optional per-leaf override of the group state (v2.1.0) |

### Provenance (v2.1.0)

`provenance` tells a dashboard how to label each value honestly. Groups: `vehicle`, `tyres`, `gps`, `cabin`, `gsm`, `ev`. A leaf takes its entry from `provenance.fields` if there is one, otherwise its group's state.

| State | Meaning | How a UI must show it |
|-------|---------|-----------------------|
| `measured` | read from a real sensor on a real car (live or recorded) | the value, tagged *measured* |
| `simulated` | produced by the demo simulator | the value, tagged *simulated* |
| `derived` | calculated from other fields (e.g. `fuel_mileage_kmpl` from MAF + speed, a backend gear estimate) | the value, tagged *derived* |
| `not_supported` | this vehicle / hardware does not provide it | *not supported by this vehicle*, never `0`, never `OFF` |
| `not_applicable` | meaningless for this powertrain (engine PIDs on an EV, `ev.*` on a petrol car) | *not applicable (EV)* / *not applicable* |
| `no_data` | supported, but no reading in this sample or recording | *no reading* |

A `null` value whose resolved state is `measured` / `simulated` / `derived` is shown as *no reading*, still never as `0` or `OFF`.

### OBD speed limit

PID 0x0D is one byte, so the wire tops out at **254 km/h** (`0xFF` is the NA sentinel). A car going faster still reports 254. A dashboard should flag `speed_kmh == 254` as "at the OBD limit, real speed may be higher" rather than trusting it.

## 2b. `demo_control` — fleet dashboard → simulator (v2.1.0)

Used only by the fleet demo's hidden presenter panel. The backend relays it to every other connected client (the simulator acts on it) and **never writes it to the database**.

```json
{
  "type": "demo_control",
  "schema_version": "2.1.0",
  "ts": 1719750000000,
  "id": "k3f9x2",
  "scenario": "car_offline",
  "target": "veyron",
  "duration_s": 15
}
```

| Field | Notes |
|-------|-------|
| `id` | random string; a simulator with several sockets acts on each `id` once |
| `scenario` | `omni_overheat` (Omni coolant ramps past 110 °C), `corolla_puncture` (Corolla front-left falls below 150 kPa), `car_offline` (`target` stops sending for `duration_s`), `mil_on` (Corolla MIL on, `dtc_count` 2), `reset_all` (clear every scenario) |
| `target` | `vehicle_id` for `car_offline`, otherwise `null` |
| `duration_s` | seconds for `car_offline` (default 15), otherwise `null` |

**Percent fields are ×2 on the wire, not ×2.55.** With ×2.55, 100% encodes as 255, which collides with the `0xFF` "unavailable" sentinel — wide-open throttle would read as unknown. ×2 caps valid readings at 200 (100.0%) and leaves 201–255 free for the sentinel, at 0.5% resolution.

### Unavailable values (sentinels)

The binary packet has no `null` — every field is a fixed-width integer. A reserved value on the wire means "unavailable" and becomes JSON `null` when the backend unpacks it:

| Wire type | Sentinel | Meaning |
|-----------|----------|---------|
| uint8 | `0xFF` | unavailable |
| uint16 | `0xFFFF` | unavailable |
| int32 | `0x7FFFFFFF` | unavailable |

This applies to every field packed as one of those widths (RPM, speed, temperatures, percentages, MAF, MAP, battery, GPS lat/lng, gear, MIL/DTC). **A `0` on the wire is a real reading of zero, never "no data."** Only the sentinel means unavailable.

### Byte 24 validity bits

`ac_on`, `brake`, and `clutch` are not plain booleans on the wire — each has its own **validity bit** alongside its **state bit**, packed into byte 24:

| Bit | Meaning |
|-----|---------|
| 0 | brake state |
| 1 | brake valid |
| 2 | clutch state |
| 3 | clutch valid |
| 4 | ac state |
| 5 | ac valid |
| 6–7 | reserved |

**A validity bit of `0` means the signal has not been found on the CAN bus yet — UNKNOWN, not "off."** The backend only reads the state bit when the matching validity bit is set; otherwise it unpacks to JSON `null`. Never render `null` as `false`/"OFF"/"RELEASED" on a dashboard — that claims a state we don't actually know.

---

## 3. Connection details

- Transport: **WebSocket**
- Via backend: `wss://api.nalusa.space/ws` (Dashboard 1 is deployed separately at `lus.nalusa.space` — it is not the backend host.)
- On connect, the backend may send one `telemetry` message immediately so the UI isn't blank.

---

## 4. Byte-layout reference (Link 1 — hardware/backend only)

UI people can ignore this. This is only for the backend person who unpacks the binary into the JSON above.

### 32-byte packet → maps to `telemetry.vehicle` + `telemetry.gps` + `telemetry.device`

| Bytes | Field | Encoding |
|-------|-------|----------|
| 0–3 | Timestamp | uint32 Unix seconds |
| 4–5 | RPM | uint16, value × 4, `0xFFFF`=NA |
| 6 | Speed | uint8 km/h, `0xFF`=NA |
| 7–10 | GPS latitude | int32, deg × 1e6, `0x7FFFFFFF`=NA |
| 11–14 | GPS longitude | int32, deg × 1e6, `0x7FFFFFFF`=NA |
| 15 | Sats + fix | bits 0–5 satellite count, bit 6 fix |
| 16–17 | MAF | uint16, g/s × 100, `0xFFFF`=NA |
| 18 | Gear | uint8, `0xFF`=unknown |
| 19 | Throttle | uint8, % × 2, `0xFF`=NA |
| 20 | Coolant temp | uint8, °C + 40, `0xFF`=NA |
| 21 | Fuel level | uint8, % × 2, `0xFF`=NA |
| 22 | Battery | uint8, volts × 10, `0xFF`=NA |
| 23 | MIL + DTC | bit 7 MIL, bits 0–6 count, `0xFF`=NA |
| 24 | AC/brake/clutch | bit-packed with validity bits — see §2 |
| 25 | Engine load | uint8, % × 2, `0xFF`=NA |
| 26 | Intake temp | uint8, °C + 40, `0xFF`=NA |
| 27 | Ambient temp | uint8, °C + 40, `0xFF`=NA |
| 28 | MAP | uint8 kPa, `0xFF`=NA |
| 29 | Device health | bit 7 power, bit 6 gps, bit 5 can |
| 30 | Sequence | uint8, N mod 256 |
| 31 | CRC-8 | CRC-8-CCITT over bytes 0–30 |

TPMS (tyre pressure/temperature) is not yet wired to any hardware, so on the real car `telemetry.tyres` is always sent as all-`null` leaf values. There is no tyre data in this packet; tyres have their own 16-byte packet, below.

### 4b. 16-byte TPMS packet → maps to `telemetry.tyres` (v2.1.0)

Designed in v2.0.0, specified and implemented in v2.1.0 (`backend/tpms_codec.py`, `pack_tpms` / `unpack_tpms`; self-test: `python backend/tpms_codec.py`). The sensors were never bought, so on the real car this packet is never produced. The fleet demo simulator uses it so simulated tyre data crosses the same kind of binary link as engine data. Big-endian, same sentinel and CRC rules as the 32-byte packet.

| Bytes | Field | Encoding |
|-------|-------|----------|
| 0 | Packet type | uint8, always `0x54` (`'T'`) |
| 1 | Layout version | uint8, `0x01` |
| 2 | Sequence | uint8, N mod 256 (the demo copies the paired 32-byte packet's seq) |
| 3–4 | FL pressure | uint16, kPa × 10 (0.1 kPa), `0xFFFF`=NA |
| 5 | FL temperature | uint8, °C + 40, `0xFF`=NA |
| 6–7 | FR pressure | uint16, kPa × 10, `0xFFFF`=NA |
| 8 | FR temperature | uint8, °C + 40, `0xFF`=NA |
| 9–10 | RL pressure | uint16, kPa × 10, `0xFFFF`=NA |
| 11 | RL temperature | uint8, °C + 40, `0xFF`=NA |
| 12–13 | RR pressure | uint16, kPa × 10, `0xFFFF`=NA |
| 14 | RR temperature | uint8, °C + 40, `0xFF`=NA |
| 15 | CRC-8 | CRC-8-CCITT (poly 0x07, init 0x00) over bytes 0–14 |

Ranges: pressure 0–6553.4 kPa, temperature −40 to 214 °C (whole degrees on the wire). Example, FL only (230 kPa, 38 °C), seq 7: `54 01 07 08 FC 4E FF FF FF FF FF FF FF FF FF 9C`.

---

## 5. Change log

Any change to this schema goes through the team lead and gets a line here so nobody is working off an old copy.

| Date | Change | By |
|------|--------|-----|
| 2026-11-25 | **v2.1.0 — additive only.** New `telemetry` keys: `source` {vehicle_id, name, model_year, reg_no, powertrain, data_mode}, `gps.heading_deg`, `cabin` {temp_c, humidity_pct} (DHT11, Board 1), `gsm` {rssi_dbm} (SIM800L, Board 2), `ev` {soc_pct, range_km}, `packet_hex`, `tpms_hex`, `crc_valid`, `tpms_crc_valid`, and the `provenance` map (§2). New `demo_control` message type, relayed but not stored (§2b). 16-byte TPMS byte layout specified and implemented (§4b, `backend/tpms_codec.py`). `vehicle.gear` range noted as 0–7. The backend no longer injects a gear estimate for EVs or when speed/rpm is null. 32-byte layout unchanged. | Team lead, for the fleet demo |
| 2026-07-15 | **v2.0.0 — BREAKING.** Track 2 (`platform_status`, `command`) removed entirely along with the Control Console dashboard. Unavailable values no longer become `0`/`false` — they are now sentinels on the wire (`0xFF`/`0xFFFF`/`0x7FFFFFFF`) that unpack to JSON `null`. Percent scaling changed from ×2.55 to ×2 (fixes the 100%-collides-with-NA-sentinel bug). Checksum changed from XOR to CRC-8-CCITT. `battery_mv` → `battery_v` (float volts, not millivolts int). `clutch_pct` (0–100) → `clutch` (three-state bool). `brake_pct` removed (brake is now three-state bool only). New fields: `ambient_temp_c`, `map_kpa`, `mil_on`, `device` (power_ok/gps_ok/can_ok/seq). AC/brake/clutch now carry validity bits distinguishing "not found yet" from "off". | Shaahir (team lead) |
| 2026-07-06 | v1.0.0 — formalized schema_version field across all message types; added brake_pct to telemetry.vehicle | Shaahir (team lead) |
| (initial) | v1 — initial schema: telemetry, platform_status, command | team lead |
