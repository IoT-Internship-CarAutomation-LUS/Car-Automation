# REPORT 1: Fleet telemetry demo (2026-11-25)

Branch `demo/fleet-dashboard`, not pushed. Everything is in place for the review.

**Run command:** `python demo/run_demo.py`, or double-click `demo\run_demo.bat`. It opens http://localhost:8000/fleet/. Press **P** for the presenter panel. Ctrl+C stops everything.

The pipeline is real end to end: `fleet_sim.py` → `obd_decoder.pack_packet` (32 bytes, CRC-8) and `tpms_codec.pack_tpms` (16 bytes) → `unpack_packet` / `unpack_tpms` → schema v2.1.0 JSON → WebSocket → FastAPI `/ws` (saves telemetry, fans out) → dashboard. The browser checks the CRC-8 of every packet again.

## 1. Files added and changed

**Backend (changed only as listed in the brief, plus two needed fixes, see §8):**
- `backend/tpms_codec.py`: **new.** 16-byte TPMS pack/unpack and a self-test.
- `backend/obd_decoder.py`, `backend/config.py`: `SCHEMA_VERSION = "2.1.0"`. The 32-byte layout is unchanged.
- `backend/websocket_handler.py`:
  - The new `demo_control` type is relayed to other clients and not saved.
  - No gear is injected for EVs or when speed or rpm is null. The old code crashed on `None >= 3`.
  - `fan_out` iterates over a snapshot of the client set.
- `backend/main.py`: StaticFiles mount `/fleet` → `demo/fleet-dashboard/`. This is the only main.py change.
- `backend/elm327_bt.py`:
  - `SCHEMA_VERSION` set to 2.1.0.
  - The live stream message now carries the new 2.1.0 keys as null leaves, so the real Pi path stays schema-complete.
- `backend/tests/dry_run.py`: the schema check compares against `obd_decoder.SCHEMA_VERSION` instead of a hard-coded "2.0.0". It is still 74 checks.

**Docs:**
- `docs/MESSAGE_SCHEMA.md`:
  - v2.1.0 fields, the provenance table, the OBD speed-limit note, and the §2b `demo_control` message.
  - The §4b TPMS byte layout and a change-log entry.
- `docs/FRAME_FORMAT.md`: rewritten to match the v2 decoder (`battery_v`, three-state body signals, null-leaf `tyres`, v2.1.0 keys), with a dated note saying what drifted.
- `README.md`, `CLAUDE.md`: the version line now says v2.1.0.

**Demo:**
- `demo/run_demo.py`, `demo/run_demo.bat`: launcher.
- `demo/simulator/fleet_sim.py`: five cars, 1 Hz, one WebSocket each.
- `demo/simulator/build_data.py`: one-time data preparation (Fronx extract, OSRM routes, JS bundle).
- `demo/data/fronx_recorded.json`: 1,597 real samples, engine fields only, time re-based to 0, no session id or wall-clock time.
- `demo/data/routes/{fronx,corolla,veyron,omni,roadster}.json`: OSRM road geometry, closed loops.
- `demo/fleet-dashboard/`:
  - `index.html`, `css/app.css`.
  - `js/`: `codec.js` (JS port of pack/unpack + CRC-8), `ui.js`, `app.js`, `fleet.js`, `car.js`, `standalone.js`, `main.js`, and the generated `demo-data.js`.
  - `vendor/` (Leaflet 1.9.4, uPlot 1.6.31, with licences) and `fonts/` (Archivo, Red Hat Mono woff2).
- `demo/tests/verify_dashboard.py`: Playwright checks plus screenshot capture.
- `demo/screenshots/*.png`: 12 screenshots.
- `demo/README.md`: presenter guide.
- `demo/REPORT_1.md`: this file.

**Design records (impeccable skill):**
- `PRODUCT.md` (inferred from the brief, labelled as such).
- `DESIGN.md` and `.impeccable/design.json` (written from the finished build).
- `.impeccable/surfaces/demo-fleet-dashboard.md` (the direction contract).

**Commits:** 9ace9f1 (schema), a57e695 (simulator and launcher), 004a5ba (dashboard), bc00e2e (audit fixes), plus the final commit with this report.

## 2. Schema changes (v2.1.0, additive only)

- **New keys on every `telemetry` message:**
  - `source` {vehicle_id, name, model_year, reg_no, powertrain, data_mode}.
  - `gps.heading_deg`, `cabin` {temp_c, humidity_pct}, `gsm` {rssi_dbm}, `ev` {soc_pct, range_km}.
  - `packet_hex`, `tpms_hex`, `crc_valid`, `tpms_crc_valid`.
- **`provenance`:** one state per group (vehicle, tyres, gps, cabin, gsm, ev), plus an optional `provenance.fields` per-leaf override.
  - States: `measured`, `simulated`, `derived`, `not_supported`, `not_applicable`, `no_data`.
- **`data_mode`** also allows `live`, used by the real Pi path in `elm327_bt.py`.
- **`vehicle.gear`** range is documented as 0–7 (7 is only the 7-speed Veyron).
- **`vehicle.fuel_mileage_kmpl`** (already in the schema, never produced by the decoder) is derived by the simulator from MAF and speed and tagged `derived`.
- **New `demo_control` message:** {type, schema_version, ts, id, scenario, target, duration_s}. It is relayed by the backend and never stored.
- **Unchanged:** every existing field. Nulls stay on the leaves.

## 3. TPMS 16-byte packet (`backend/tpms_codec.py`)

| Bytes | Field | Encoding |
|---|---|---|
| 0 | packet type | `0x54` ('T') |
| 1 | layout version | `0x01` |
| 2 | sequence | uint8; the demo copies the paired 32-byte packet's seq |
| 3–4 / 6–7 / 9–10 / 12–13 | FL / FR / RL / RR pressure | uint16 big-endian, kPa × 10, `0xFFFF` = NA |
| 5 / 8 / 11 / 14 | FL / FR / RL / RR temperature | uint8, °C + 40, `0xFF` = NA |
| 15 | CRC-8 | CRC-8-CCITT (poly 0x07, init 0x00) over bytes 0–14, same as the 32-byte packet |

Example (FL 230 kPa, 38 °C, seq 7): `54 01 07 08 FC 4E FF FF FF FF FF FF FF FF FF 9C`.

The self-test checks:
- the size and the header bytes;
- seq wrapping;
- round trips, and that 0 kPa and −40 °C are real readings rather than NA;
- the maximum values;
- sentinels unpacking to null;
- single-bit and byte-swap corruption caught by the CRC;
- bad lengths and bad type bytes rejected.

## 4. Verification results

**Backend tests:**
- `python backend/tests/dry_run.py`: **ALL 74 CHECKS PASSED** (final run, after all changes).
- `python backend/tests/dry_run.py --stream`: **ALL 83 CHECKS PASSED**. This is the real backend; the schema version is 2.1.0 and no schema mismatch was logged.
- `python backend/tpms_codec.py`: ALL TESTS PASSED (16 checks).
- `python backend/obd_decoder.py`: ALL TESTS PASSED.

**JS codec against Python:**
- `packPacket` output is byte-identical to `pack_packet`, and the TPMS packer to `pack_tpms`.
- `unpackPacket` matches `unpack_packet` on `vehicle` and `gps`.

**Simulator physics** (20 simulated minutes, all CRC valid):
- **Fronx (simulated mode):** 690–2,650 rpm, coolant 87–90 °C, battery 13.8 V, 6–7 satellites. The backend injected gears 1–4.
- **Veyron:** 59–254 km/h, clamped at 254 for 140 of 1,200 s, gears 4–7.
- **Omni:** coolant 95–102 °C.
- **Roadster:** SOC drained from 78% to 73%.

**Launcher:**
- All five cars arrive within about 3 s of starting.
- Ctrl+Break (the same handler as Ctrl+C): exit code 0, "Port 8001 is free", no leftover python processes.
- Hard-killing the launcher: the Job Object takes the backend and simulator with it, and port 8000 is free.

**Playwright** (`demo/tests/verify_dashboard.py`, 1366×768). Live final run **27/27**, standalone final run **27/27**:

| Check | Live | Standalone |
|---|---|---|
| All five cars visible within 5 s | 1.17 s | 0.98 s |
| Browser console has no errors | yes | yes |
| Demo-data badge reads "1 recorded + 4 simulated" (computed from `data_mode`) | yes | yes |
| "Standalone mode" badge visible | n/a | yes |
| CRC pass KPI | 100% | 100% |
| Every car view renders, with no null shown as 0, OFF or blank | yes | yes |
| Fronx brake, clutch and AC render UNKNOWN | yes | yes |
| Roadster engine fields read "Not applicable (EV)"; battery charge replaces fuel | yes | yes |
| Omni unsupported PIDs read "Not supported" | yes | yes |
| Byte tooltips name the field and show the decoded value | yes | yes |
| Veyron "OBD limit" note appears | yes | yes |
| `mil_on` raises its alert | yes | yes |
| `omni_overheat` raises the coolant alert | after about 8 s | after about 9 s |
| `corolla_puncture` raises the tyre alert | after about 17 s | after about 16 s |
| `car_offline` (Roadster): stale, then offline | about 3 s / 7 s after the click | about 3 s / 7 s |
| The car returns: "Back online" plus a seq-gap alert | yes | yes |
| `reset_all` | sent at the start of every run | sent at the start of every run |

- In the very first live run, the badge check failed once. The badge refreshed on a 500 ms tick, so it briefly read "0 recorded". Fixed by refreshing the KPIs whenever a new car arrives.
- The console check ignores map-tile network errors only.

## 5. Impeccable audit, and what I fixed

**Context.** The context loader ran. There was no PRODUCT.md, and you said not to ask questions, so I inferred it from the brief and labelled it. The surface is Operate mode and was built code-first, since no image generation was available. The layout is pinned by the brief (`seed: none (pinned)`), so no concept roll was run.

**Detector** (`impeccable detect`, run once). One advisory: "repeating-gradient stripes". It is a false positive: the hatch marks sentinel bytes, which is data encoding rather than decoration. I kept it.

**Audit**, scored after the fixes below:

| # | Dimension | Score | Key finding |
|---|---|---|---|
| 1 | Accessibility | 3 | Light muted ink was 4.43:1 on the UNKNOWN pill and 4.24:1 on the alert tint (P1, fixed). No h1 in the fleet view (P2, fixed). The byte strip was hover-only (P2, fixed with arrow keys). Chart hover is mouse-only (open). |
| 2 | Performance | 3 | DOM updates are incremental (text nodes, not re-renders). One rAF loop for 5 markers. Label decluttering runs once a second. |
| 3 | Theming | 3 | Full token set for light and dark, including a separate dark step for every series slot. Literals remain on the link-state dots, plates and tooltip shadow. |
| 4 | Responsive | 3 | Checked at 1366×768 and 1920×1080 (16px root at 1700px and wider). Narrow breakpoints exist but are basic. |
| 5 | Implementation integrity | 4 | Coherent system with one signature, the packet ribbon. Detector clean apart from the verified false positive. |
| | **Total** | **16/20 (Good)** | |

**First fix batch:**
- `--ink-3` darkened to `#56636e`; it now measures at least 4.9:1 on every light surface.
- A hidden h1 in the fleet view.
- Keyboard stepping through the bytes.
- The car-view columns rebalanced (Data health moved to the left column).
- Compact vehicle rows, so all five cars fit at 768 px height.

**Finish review** (a fresh `impeccable-finish-reviewer` agent). It gave one correction round; disposition **fix**, with 8 material fixes:

1. A tyre alert read "180 kPa, below 180 kPa". The alert now shows one decimal.
2. The EV clutch showed UNKNOWN. It now shows a muted N/A (EV) pill.
3. Text was too small for a projector. Provenance tags are now 0.86rem, byte labels larger, gauge ticks 11px. Map trails are 6px solid, and route loops 3px dotted.
4. Gauge scales had odd steps. They now use round steps (Roadster 0–250).
5. The vehicle cards were nested cards. They are now divided rows.
6. The trend panel had no provenance tag. It now has one.
7. Mono was used for words. Words beside numbers are now set in Archivo.
8. The 1920 map framed open sea. It now frames the land.

I also built the reviewer's ceiling suggestion: hovering a byte outlines the tile it decodes to, and hovering a tile lights its bytes. Two of the documenter's drift notes were fixed too: the idle dot is now a ring, and alerted tiles carry an icon.

**Verdict pass** (the final review). Fixes 1, 2, 3, 5 and 6 were scored *resolved*; 4, 7 and 8 *partial*. It found two regressions from my fix round: a tile seam at fractional zoom, and byte labels running together at 1366. Disposition **fix**.

**After the verdict, I made one more small batch** that has **not been re-reviewed**:
- Gauge labels moved out and the readout shrunk to 25px, so the labels clear the readout.
- "s ago" set in Archivo.
- Whole zoom levels again, which removed the seam.
- Byte labels at 0.76rem below 1700px, centred under their bytes.
- Greedy map-label placement, so labels no longer overlap.
- Alerted tyres get an icon.
- The car-view trail matches the fleet map.

I checked these in the recaptured screenshots myself. Still open: about 185 px of empty vehicle column at 1920×1080.

**DESIGN.md** was written from the shipped CSS by the `impeccable-documenter` agent and refreshed after the fix round. Named rules: Slot Discipline, Hatch Means Absent, Green Roof, Mono For Every Number, Unknown Is Quieter, Projector Floor, One Lift.

## 6. Screenshots (`demo/screenshots/`)

Each of these exists for `light`/`dark` and for `1366x768`/`1920x1080`:
- `fleet_<theme>_<size>.png`
- `car_corolla_<theme>_<size>.png`: every field populated, with the presenter scenarios active (MIL, puncture).
- `car_roadster_<theme>_<size>.png`: the EV, with "Not applicable (EV)" fields.

That is 12 files. The car views are full-page captures.

## 7. Known issues

1. **Map tiles.**
   - CARTO Positron and Dark Matter now return an "API KEY REQUIRED" tile for every keyless request, which I verified with curl. The map uses Stadia Alidade Smooth and Smooth Dark instead, the closest keyless look, and switches to grey-filtered OSM tiles after 3 tile errors.
   - Stadia needs the page to send a Referer, which localhost does; `file://` goes straight to OSM.
   - **Without internet there are no map tiles** (grey background). Cars, trails and everything else still work. Test the venue Wi-Fi first.
2. **The Fronx recording vs. the brief.** The only real log on this laptop is the 31 July session, a stationary idle with no GPS and no speed.
   - The brief's envelope (idle 688–850, max 3,126 rpm, coolant 87–90 °C, 6–7 satellites) comes from the 18 July drive, which is not on this machine. I used it for `--fronx-mode simulated`.
   - In the recording itself, `coolant_c` is empty in every row, so it shows "No reading" (tagged `no_data`).
   - **Ambient temperature has real values (33–41 °C) in that log**, although the brief says it was never found. By default I replay what the car reported, labelled measured. To follow the brief instead, run `fleet_sim.py --fronx-ambient null`, which makes it "Not supported". Please check which is right before the review.
3. `dashboard-telemetry/a.js` (not modified, as you asked) expects schema 2.0.0, so it will show its schema-mismatch warning on v2.1.0 data. `backend/mocks/mock_telemetry.py` still sends 2.0.0 and lacks the new keys, so the backend will log a mismatch if it is used.
4. The Veyron reports gear 7. The schema now documents 0–7.
5. The CAN body signals on the Fronx and Omni show UNKNOWN with "Not found on the CAN bus". The Veyron's clutch says the same, although the real reason is that a dual-clutch car has no clutch pedal.
6. The trend-chart hover tooltip is mouse-only.
7. At 1920×1080 the vehicle column has empty space below the last car.
8. `backend/telemetry.db` (git-ignored) grows by about 18,000 rows per hour while the demo runs.
9. The "OBD limit" check waits up to 90 s for the Veyron to reach 254. In standalone mode it took 87 s.
10. `demo/REPORT_0.md` is still uncommitted, as before.

## 8. Choices I made

1. **Two backend fixes beyond the brief.** These were needed for the demo to run reliably:
   - `fan_out` iterates over a snapshot of the client set. Without it, a client joining during a send raised "Set changed size during iteration" and dropped the sender.
   - Gear estimation is skipped when speed or rpm is null. The old code raised a `TypeError` on the Omni-style nulls.
2. **`elm327_bt.py`:** its version was bumped and its stream message gained the v2.1.0 keys, all null. Otherwise the real Pi would have triggered a schema mismatch, and the dry run's "no mismatch" check would have failed.
3. **`dry_run.py`:** the schema assertion now reads the version from `obd_decoder` instead of hard-coding "2.0.0". The check count is unchanged.
4. **Provenance:**
   - I added `derived` (km/L, backend gear estimate) and `no_data` (supported, but no reading in this sample) to the states in the brief, plus a per-leaf `provenance.fields` override, because one state per group could not label the Fronx honestly.
   - `data_mode` also allows `live` for the real Pi.
5. **Heading, cabin, GSM and EV** live only in the JSON (they are not in the 32-byte packet), and the schema says so.
6. **Freshness and staleness** use the browser's receive time, not `ts`, so clock skew with a second laptop cannot fake staleness.
7. **The Fronx sends no gear**, like the real Pi, so the real backend `calculate_gear` fills it in and it is labelled `derived`. The Omni is handled the same way. The EV never gets a gear.
8. **Fake plates:**
   - Fronx TN 11 AZ 4817, Corolla TN 14 BK 2209, Veyron TN 09 BV 1001, Omni TN 07 AC 1986, Roadster TN 10 EV 2008.
   - The Roadster's plate is green, as Indian EV plates are.
   - Model years: Corolla 2020, Veyron 2011, Omni 2005.
9. **Sensor sets.**
   - **Corolla:** every field, a manual gearbox (so the clutch is real), AC on.
   - **Veyron:** everything except the clutch (dual-clutch gearbox).
   - **Omni:**
     - The vehicle fields are RPM, speed and coolant only; everything else is not supported.
     - It does have GPS and a weak GSM signal from our boards, with no cabin sensor.
     - It loses one packet every 35–90 s.
   - **Roadster:** everything that applies to an EV, plus TPMS, cabin and GSM.
10. **Scenarios.**
    - `car_offline` keeps the car's seq counter running, so its return shows a real seq gap of about 15 packets.
    - The presenter's default offline car is the Veyron.
    - The puncture drops 3.2 kPa/s and holds at 128 kPa.
    - The overheat climbs to 116 °C.
11. **Alerts.**
    - Each alert has hysteresis: coolant clears below 103 °C, speed below 115 km/h, pressure above 185 kPa, battery above 12.2 V.
    - A raise for the same car and rule is not posted again within 60 s.
    - Seq-gap and CRC alerts are one-off events that stay counted for 20 s.
    - "Back to normal" messages are posted only for alerts that were posted.
12. **Routes.** OSRM gave every route on the first try. Each loop is A→B then B→A, and the Omni's is a closed loop. The hand-written fallback waypoints are kept in `build_data.py`.
13. **Standalone data.** The data is bundled as `js/demo-data.js` (432 KB), so standalone mode also works from `file://`. Only one `/fleet` mount was added to `main.py`.
14. **Charts.** RPM and speed are two single-axis uPlot charts, never one dual-axis chart.
15. **Look.**
    - Indian highway-sign green header over a cool grey ground.
    - Archivo for words, Red Hat Mono for numbers and hex.
    - Validated categorical colours for packet field groups and car identities.
    - Status always shown with an icon and a word.
    - The signature is the 32-cell packet ribbon on every vehicle row, with hatched cells where a byte is "not available".
16. **Theme.** Light by default. The dark toggle is stored in `localStorage` inside try/catch and applied before first paint.
17. **Commits.** Every commit ends with the Co-Authored-By and Claude-Session lines. Nothing was pushed.
