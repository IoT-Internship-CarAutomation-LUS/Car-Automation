# Car Automation — IoT Internship (LUS)

ESP32-based vehicle telematics and autonomous-driving project. The system reads live vehicle data, sends it to a backend, and shows it on two web dashboards — one that **monitors** a real car, and one that **controls** a small self-built platform over the CAN bus.

This is the team's single source of truth. Every track has a folder here; overall progress is tracked in the status board below.

---

## Status board

| Track | Owner | Folder | Status | Notes |
|-------|-------|--------|--------|-------|
| Dashboard 1 — Telemetry Monitor | Sapthagiri | `dashboard-telemetry/` | 🟢 Deployed | lus.nalusa.space — built, bound to schema |
| Dashboard 2 — Control Console | Sathish | `dashboard-control/` | 🟢 Deployed | dashboard2.nalusa.space — built, bound to schema |
| Backend / streaming | Shaahir | `backend/` | 🟢 Deployed | api.nalusa.space — FastAPI + SQLite, built and running; company cloud migration is an open future item |
| Platform hardware / parts | Venkat | `hardware/` | 🟡 Research | Parts list ready; awaiting budget sign-off |
| Real-car sensing (ELM327 / TPMS) | Pavan | `sensing/` | 🟡 Early research | In-house direct-wire approach (no Bluetooth app) |
| Firmware (GPS / CAN / motor node) | Shared | `firmware/` | 🟢 Bring-up done | GPS + CAN loopback working on Board 2 |
| GPS real-world testing | Shahid | `firmware/` | 🟢 Done | Live fix obtained in Chennai |

Legend: 🟢 done / working · 🟡 in progress · 🔴 blocked · ⚪ not started

---

## Objectives

| # | Objective | Status |
|---|-----------|--------|
| — | Backend server + API (all data flows here) | 🟢 Built and deployed (api.nalusa.space) — company cloud migration open |
| I | GPS live location | 🟢 Hardware done |
| II | Camera (lane / drowsiness detection) | ⚪ Parked — later phase (needs Pi/phone-class vision) |
| III | Real-time OBD data (RPM, load, speed, etc.) | 🟡 Partial — CAN proven, ELM327 pending |
| IV | Tyre parameters as 16 bytes (TPMS) | 🟡 Designed only |

---

## How it fits together

```
  HARDWARE                          BACKEND (api.nalusa.space)      DASHBOARDS
  ------------------------          -----------------------        ---------------------------
  Built platform (Track B)  ─┐
    ESP32 + MCP2515 → CAN    │      FastAPI + SQLite               Dashboard 1 (Telemetry)
    → motor node → servos    ├──▶   - stores telemetry      ──▶    lus.nalusa.space
                             │      - streams to dashboards
  Real-car sensing (Track A) │                                     Dashboard 2 (Control)
    ELM327 (direct) + TPMS  ─┤                                     dashboard2.nalusa.space
                             │      commands flow back down ◀── from Dashboard 2
  GPS (NEO-6M)  ─────────────┘
```

Backend hosting on the company cloud (managed API endpoint + cloud RDBMS instead of self-hosted SQLite) is an open future item — see `backend/README.md`.

Data travels as **compact binary** (32-byte vehicle + 16-byte tyre packets) on the hardware link, and is unpacked into **JSON** once at the ESP32/backend boundary. Dashboards only ever see JSON. See [`docs/MESSAGE_SCHEMA.md`](docs/MESSAGE_SCHEMA.md) — the single source of truth for the data format.

---

## Repo layout

| Folder | What's in it |
|--------|--------------|
| `docs/` | Planning docs, message schema, parts list, daily reports |
| `dashboard-telemetry/` | Dashboard 1 — real-car telemetry monitor |
| `dashboard-control/` | Dashboard 2 — vehicle control console |
| `backend/` | Streaming API + storage — FastAPI + SQLite, deployed at api.nalusa.space |
| `firmware/` | ESP32 sketches — GPS/CAN bring-up, platform motor node |
| `hardware/` | Chassis, parts, wiring diagrams, build photos |
| `sensing/` | ELM327 / TPMS decoding, payload notes |

---

## Team

| Person | Role |
|--------|------|
| **Shahid Mihransha** | Team lead — planning, hardware bring-up, GPS testing, backend & parts support |
| Sapthagiri | Dashboard 1 (Telemetry) |
| Sathish | Dashboard 2 (Control Console) |
| Shaahir | Backend + streaming API |
| Venkat | Platform hardware / procurement |
| Pavan | Real-car sensing (ELM327 / TPMS) + documentation |

---

## Working agreement

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for how we branch, commit, and review. In short: work in your own folder, use a branch, open a pull request, and the lead reviews before it merges to `main`.
