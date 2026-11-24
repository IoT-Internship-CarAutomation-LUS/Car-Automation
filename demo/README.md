# Fleet telemetry demo

Five cars on one screen for the internship review. Only the cars are simulated or replayed. Every
message goes through the real pipeline:

```
fleet_sim.py -> obd_decoder.pack_packet (32 bytes, CRC-8) -> unpack_packet -> schema v2.1.0 JSON
             -> WebSocket -> FastAPI backend (/ws, saves + fans out) -> fleet dashboard (/fleet/)
```

## Run it

```
python demo/run_demo.py
```

or double-click `demo/run_demo.bat`. It starts the backend on port 8000, waits for
`/api/health`, starts the simulator, and opens http://localhost:8000/fleet/. Ctrl+C stops
everything and frees port 8000.

Options: `--fronx-mode simulated` (drive the Fronx instead of replaying the 31 July log),
`--no-sim` (backend only, e.g. when a second laptop drives the cars), `--no-browser`,
`--kill-existing` (free port 8000 first). The launcher prints the LAN address for a second
laptop. The simulator alone: `python demo/simulator/fleet_sim.py --ws ws://<host>:8000/ws`.

## The cars

| Car | Data | What it shows |
|-----|------|---------------|
| Maruti Suzuki Fronx | **Recorded**: the real 31 July 2026 session (idling, parked), replayed. GPS is a fixed, simulated point on GST Road (the log has no GPS) | Real data; fuel, brake, clutch and AC are null because the car does not report them |
| Toyota Corolla | Simulated, OMR | The full planned sensor set: TPMS, CAN body signals, cabin, GSM |
| Bugatti Veyron | Simulated, ECR | OBD speed is one byte, so the wire clamps at 254 km/h ("OBD limit" note) |
| Maruti Omni | Simulated, Anna Salai / T. Nagar | Legacy ECU: only RPM, speed and coolant; runs warm; weak GSM; occasional lost packet |
| Tesla Roadster (2008) | Simulated, Kamarajar Salai | EV: engine fields "Not applicable (EV)", motor RPM, battery charge and range |

## Presenter keys

- **P**: presenter panel. Omni overheat, Corolla puncture, Corolla check-engine, any car offline for
  15 s, reset all. Sent as `demo_control` through the backend.
- Click a card or a map marker to open the car view. Hover or arrow-key through the packet bytes.
- `?mode=standalone`: in-browser simulator, no backend (also used automatically when no backend
  answers within 4 s).

## Checks

```
python demo/tests/verify_dashboard.py                  # with the demo running
python demo/tests/verify_dashboard.py --shots demo/screenshots
python backend/tests/dry_run.py
python backend/tpms_codec.py
```

Data preparation (already done, only re-run to refresh): `python demo/simulator/build_data.py`.
