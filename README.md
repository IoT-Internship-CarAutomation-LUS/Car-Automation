# Car Automation — IoT Internship (LUS)

Real-vehicle telematics project. A Raspberry Pi reads live engine data (ELM327 over Bluetooth) and live GPS position from a real car, packs both into a compact binary packet, and streams it to a backend that a web dashboard displays live.

The project originally also planned a self-built autonomous model-car platform and a second dashboard to drive it. **That track was cancelled on 15 July 2026** (schema v2.0.0) so the team could go deep on the real vehicle instead of splitting effort — see the change log in [`docs/MESSAGE_SCHEMA.md`](docs/MESSAGE_SCHEMA.md).

This is the team's single source of truth. Every workstream has a folder here; overall progress is tracked in the status board below.

---

## Status board

| Track | Owner | Folder | Status | Notes |
|-------|-------|--------|--------|-------|
| Dashboard 1 — Telemetry Monitor | Sapthagiri | `dashboard-telemetry/` | 🟢 Deployed | lus.nalusa.space — built, bound to schema |
| Dashboard 2 — Control Console | Sathish | `dashboard-control/` | ⚫ Retired | Built and deployed for the self-built platform track; retired 15 Jul when that track was cancelled — no longer receives data |
| Backend / streaming | Shaahir | `backend/` | 🟢 Deployed | api.nalusa.space — FastAPI + SQLite, built and running; company cloud migration is an open future item |
| Real-car sensing (ELM327 + GPS) | Pavan / Shahid | `sensing/`, `backend/elm327_bt.py` | 🟢 Proven on vehicle | 18 Jul: Raspberry Pi 4 + ELM327 Bluetooth + NEO-6M GPS on a Maruti Suzuki Fronx — 285/285 packets captured, 100% passing CRC-8 |
| CAN signals (brake / clutch / AC) | Shahid / Shaahir | `firmware/` | 🟡 In progress | Listen-only CAN sniffing on the Fronx; whether the OBD-II port even carries body-network traffic is still unresolved |
| Accelerator actuation | Shahid | `Internship/` (planning doc) | 🟡 Scoped & costed | Physical pedal actuator (servo) chosen — driving the throttle via OBD/CAN was investigated and ruled out (ECU rejects spoofed pedal signals). ~₹2,600–3,350, not yet built |
| Hardware / procurement | Venkat | `hardware/` | 🟢 Acquisition hardware bought | OBD/GPS/CAN gear bought and working; TPMS (tyre) sensors were designed for but never purchased |
| Firmware (GPS / CAN bring-up) | Shared | `firmware/` | 🟢 Bring-up done | GPS + CAN loopback working on Board 2 (ESP32) — early bring-up; production capture now runs on the Raspberry Pi |
| GPS real-world testing | Shahid | `firmware/` | 🟢 Done | Live fix obtained in Chennai |

Legend: 🟢 done / working · 🟡 in progress · 🔴 blocked · ⚪ not started · ⚫ retired / cancelled

---

## Objectives

| # | Objective | Status |
|---|-----------|--------|
| — | Backend server + API (all data flows here) | 🟢 Built and deployed (api.nalusa.space) — company cloud migration open |
| I | GPS live location | 🟢 Proven on the vehicle (NEO-6M on the Raspberry Pi, 18 Jul) |
| II | Camera (lane / drowsiness detection) | ⚪ Parked — later phase (needs Pi/phone-class vision) |
| III | Real-time OBD data (RPM, load, speed, etc.) | 🟢 Proven end to end on a real car (Maruti Fronx, 18 Jul). Fuel level and ambient temp are unsupported on this vehicle (recorded as `null`, not 0). Brake/clutch/AC aren't standard OBD values — recovering them needs CAN sniffing, in progress |
| IV | Tyre parameters as 16 bytes (TPMS) | 🟡 Designed only — sensors never purchased, never wired |

---

## How it fits together

```
  HARDWARE                            BACKEND (api.nalusa.space)      DASHBOARD
  ----------------------------        -----------------------        ---------------------------
  Raspberry Pi 4
    ELM327 (Bluetooth) → OBD-II  ─┐
    NEO-6M GPS (serial)           ├──▶   FastAPI + SQLite      ──▶    Dashboard 1 (Telemetry)
    → packs 32-byte packet        │      - stores telemetry            lus.nalusa.space
    → logs to CSV + streams       │      - streams to dashboard
                                   │
  CAN sniffing (brake/clutch/AC) ─┘      (listen-only, in progress — not yet feeding the packet)
```

Backend hosting on the company cloud (managed API endpoint + cloud RDBMS instead of self-hosted SQLite) is an open future item — see `backend/README.md`.

Data travels as a **compact 32-byte binary packet** on the hardware link, and is unpacked into **JSON** once at the Pi/backend boundary. Dashboards only ever see JSON. A companion 16-byte tyre packet was designed but never wired to hardware (TPMS sensors were never bought). See [`docs/MESSAGE_SCHEMA.md`](docs/MESSAGE_SCHEMA.md) (currently **v2.0.0**) — the single source of truth for the data format.

---

## Repo layout

| Folder | What's in it |
|--------|--------------|
| `docs/` | Planning docs, message schema, parts list, daily reports |
| `dashboard-telemetry/` | Dashboard 1 — real-car telemetry monitor |
| `dashboard-control/` | Dashboard 2 — vehicle control console. **Retired** along with the self-built platform track; no longer receives data |
| `backend/` | Streaming API + storage (FastAPI + SQLite, deployed at api.nalusa.space) plus the real-vehicle acquisition scripts (`elm327_bt.py` runs on the Raspberry Pi, `obd_decoder.py` packs/unpacks the 32-byte packet) |
| `firmware/` | ESP32 sketches — early GPS/CAN bring-up, now superseded for production capture by the Raspberry Pi |
| `hardware/` | Chassis, parts, wiring diagrams, build photos |
| `sensing/` | GPS (NEO-6M) reader for the Raspberry Pi (`gps_neo6m_pi.py`); CAN sniffing work for brake/clutch/AC |

---

## Team

| Person | Role |
|--------|------|
| **Shahid Mihransha** | Team lead — planning, hardware bring-up, Raspberry Pi + real-vehicle GPS/OBD testing, CAN sniffing (brake/clutch/AC), data acquisition standard & packet design, repo governance |
| Sapthagiri | Dashboard 1 (Telemetry) |
| Sathish | Dashboard 2 (Control Console) — retired along with the self-built platform track |
| Shaahir | Backend + streaming API, gear estimation algorithm, CAN sniffing (brake/clutch/AC) |
| Venkat | Hardware / procurement |
| Pavan | Real-car sensing — ELM327 + GPS proven end to end on the vehicle — plus documentation |

---

## Working agreement

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for how we branch, commit, and review. In short: work in your own folder, use a branch, open a pull request, and the lead reviews before it merges to `main`.
