# Backend / Streaming

**Owner: Shaahir**

**Status: built and deployed** — `wss://api.nalusa.space/ws` (WebSocket) and `https://api.nalusa.space/api/...` (REST). FastAPI + SQLite.

Receives data from the hardware, stores it, and streams it to both dashboards.

## What's here

- `main.py` — app entry point, mounts the router and the WebSocket endpoint, runs with `uvicorn`.
- `config.py` — host/port/DB path.
- `database.py` — SQLite setup and reads/writes (`telemetry` and `platform_status` tables, full JSON payload per row).
- `routes.py` — REST API (prefix `/api`).
- `websocket_handler.py` — single `/ws` endpoint; routes hardware/dashboard messages by `type` and fans out to all connected clients.
- `mock_telemetry.py`, `mock_platform.py`, `mock_rc_platform.py` — fake hardware senders for developing/testing without real sensors or the platform present.

## Run it locally

```
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Then, in separate terminals, run one or more of the mock senders (`python mock_telemetry.py`, `python mock_rc_platform.py`) to generate live traffic without any hardware attached.

## REST endpoints

| Method | Endpoint | Returns |
|--------|----------|---------|
| `GET` | `/api/health` | `{ "status": "ok" }` |
| `GET` | `/api/telemetry/latest` | most recent `telemetry` object |
| `GET` | `/api/telemetry/history?limit=100` | last N telemetry records, oldest first |
| `GET` | `/api/gps/track?limit=200` | `{lat, lng, ts}` list, filtered to `gps.fix == true` |
| `GET` | `/api/platform/history?limit=200` | last N platform_status records, oldest first |
| `POST` | `/api/command` | HTTP fallback for commands (stores/echoes only — does not relay to hardware; the WebSocket is the real command path) |

## Responsibilities

- Ingest `telemetry` and `platform_status` messages over WebSocket, store them in SQLite.
- Stream live data to the dashboards; relay `command` messages back to the platform.
- Expose history endpoints for the dashboards to pull past data.

Keep all message shapes identical to [`../docs/MESSAGE_SCHEMA.md`](../docs/MESSAGE_SCHEMA.md) — that's the source of truth, not this README. Never commit credentials — use a git-ignored `.env`.

## Open item: cloud migration

Current deployment is a self-hosted FastAPI + SQLite instance at `api.nalusa.space`. Moving to the company's cloud server (managed API endpoint + cloud RDBMS instead of self-hosted SQLite) is an open future item, not yet started — provider, DB type, and credentials are still to be confirmed with the company. This is a migration of the *hosting*, not a change to the message contract.
