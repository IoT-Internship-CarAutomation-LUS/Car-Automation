# CLAUDE.md — Car-Automation (LUS IoT internship)

## What this project is
Real-vehicle telemetry. A Raspberry Pi 4 reads a Maruti Suzuki Fronx through an ELM327 Bluetooth
OBD-II adapter plus a NEO-6M GPS, packs each sample into a **32-byte binary packet with CRC-8**, and
sends it to a **FastAPI + SQLite backend over WebSocket**. A dashboard shows it as JSON.
The model-car track (Control Console, `dashboard-control/`) was **cancelled on 15 July 2026**.

## Repo map
- `backend/` — FastAPI + SQLite streaming API, plus acquisition scripts
- `dashboard-telemetry/` — Dashboard 1, the real-car telemetry monitor (JSON only)
- `dashboard-control/` — retired Control Console (only a `_headers` file is left)
- `docs/` — schema, frame format, day reports (`day-reports/` is history, keep it), archive
- `sensing/` — NEO-6M GPS reader for the Pi; `firmware/` — ESP32 sketches (superseded)
- `scripts/` — CAN sniffer and git hooks; `hardware/` — build notes; `Internship/` — reports
- `demo/` — (this branch) the review demo; `logs/` — git-ignored real session CSVs

Key files: `backend/obd_decoder.py` (pack/unpack, CRC, sentinels), `backend/elm327_bt.py`
(Pi acquisition), `backend/websocket_handler.py` (broker), `backend/config.py`,
`docs/MESSAGE_SCHEMA.md` (**single source of truth** for the data format).

## Current goal: college internship review demo (no live car allowed)
Building a fleet telemetry dashboard in `demo/` on branch `demo/fleet-dashboard`.
- **Level 1 (done, REPORT_1)** — fleet dashboard (`demo/fleet-dashboard/`, served at `/fleet/`)
  with 5 simulated/replayed cars: Fronx (real 31 Jul recording), Toyota Corolla, Bugatti Veyron,
  Maruti Omni, Tesla Roadster (first generation). Simulator: `demo/simulator/fleet_sim.py`.
- **Level 2 (done, REPORT_2)** — driver console (`demo/driver-console/`, served at `/drive/`):
  "Control Console - Driver Simulator". A phone, second laptop or second window joins the fleet
  as a live car (`data_mode: "live"`, `control: "manual"`), 5 Hz, starting at the Crescent campus,
  Vandalur. Presenter panel (P) shows a QR code of the LAN `/drive/` URL (`/api/lan-info`).
- **Level 3** — a three.js 3D car view.
- **Extra** — an OBD data-flow visualizer.

## Hard rules
- Unavailable values are `null` on leaf fields — never omitted, never shown as 0 / OFF.
- `brake` / `clutch` / `ac_on` = `null` means UNKNOWN, not off.
- Every simulated message must go through `obd_decoder.pack_packet` / `unpack_packet`.
- Any schema change bumps the version in `docs/MESSAGE_SCHEMA.md`, `backend/config.py` and
  `backend/obd_decoder.py` together (currently v2.2.0; also the JS codec, `fleet_sim.py`,
  `elm327_bt.py` nulls). v2.2.0 added `source.control`, the `driver` block and `vehicle_left`.
- Label demo data honestly: **measured** / **simulated** / **not supported** (also `derived`,
  `not_applicable`, `no_data`; see the provenance table in MESSAGE_SCHEMA.md).
- Refer to company leadership by role only in documents, never by name.
- `python backend/tests/dry_run.py` must keep passing (74 checks).

## Working rules
- Windows + PowerShell. Python is `python` (3.13) or `py` (3.14).
- Commit to `demo/fleet-dashboard`. **Never push unless told** (it was pushed once, when asked,
  for Level 2). Never push or merge `main`. Never force-push, never `git reset --hard` /
  `git clean`, never discard work.
- For UI use the `impeccable` and `frontend-design` skills; verify in a browser with the
  `webapp-testing` skill (Playwright, screenshots).
- Finish every task with a written report saved under `demo/` (e.g. `demo/REPORT_<n>.md`).
- Real session CSVs and `*.db` are git-ignored — never commit them.

## How to run
- Backend: `cd backend; python -m uvicorn main:app --port 8000` then `GET /api/health`
  (WebSocket at `ws://localhost:8000/ws`). Install deps: `pip install -r backend/requirements.txt`.
- Tests: `python backend/tests/dry_run.py` (add `--stream` with port 8000 free),
  `python backend/tpms_codec.py`, `python backend/obd_decoder.py`.
- Demo: `python demo/run_demo.py` (backend on 0.0.0.0:8000 + simulator + browser; prints the LAN
  `/drive/` URL). Run sheet for the review: `demo/RUN_SHEET.md`.
- Browser checks (demo running): `python demo/tests/verify_dashboard.py` (Level 1) and
  `python demo/tests/verify_level2.py [--shots demo/screenshots/level2]`.
