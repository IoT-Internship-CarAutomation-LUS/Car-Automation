# Backend Brief — LUS Car Automation

> **STATUS: BUILT AND DEPLOYED.** This backend now exists and is live at
> `api.nalusa.space` (WebSocket `wss://api.nalusa.space/ws`). It was built in
> Python with **FastAPI + SQLite + WebSocket**, exposes the REST endpoints
> listed in §2 Part C, and is exercised by three mock sender scripts
> (`mock_telemetry.py`, `mock_rc_platform.py`, `mock_platform.py`). Both
> dashboards connect to it. **The sections below are the original build brief,
> kept as the design record** — read them as "why it's built this way," not as
> "still to do." For the running system, see `backend/README.md` and the code
> in `backend/`.
>
> **Open item (not yet done):** the project lead's direction was to eventually
> stream via the company's own cloud + RDBMS. What's deployed today is
> self-hosted (FastAPI + SQLite on our domain). Whether/when to migrate to the
> company cloud is an unresolved decision awaiting his answer.

**Owner: Shaahir.** This was the piece everything else depended on — before it existed, every module (GPS, OBD, TPMS, the platform) produced data with nowhere to go, the dashboards talked straight to the ESP32, and nothing was stored or survived a refresh. This brief defined the server that sits in the middle.

The **Message Schema** (`docs/MESSAGE_SCHEMA.md`) is the contract — the backend's JSON in and out matches it exactly.

---

## 1. What the backend is for (in one line)

Receive data from the hardware, store it, and serve it to the dashboards — both as a **live stream** and as **stored history**.

```
  [ ESP32 / Platform ]  --(WebSocket, JSON)-->  [ BACKEND ]  --(WebSocket)-->  [ Dashboards: live ]
                                                     |
                                                     +--(REST API)---------->  [ Dashboards: history ]
                                                     |
                                                  [ Database ]
```

The dashboards already know how to open a WebSocket. Today they point at the ESP32 directly. Once you exist, they point at you instead — and you also give them a way to ask for *past* data (e.g. "show me the last 100 GPS points", "replay the last drive").

---

## 2. What to build — three parts

### Part A — WebSocket relay (do this first)
- Accept a WebSocket connection **from the hardware** (ESP32/platform) that pushes `telemetry` and `platform_status` messages.
- Accept WebSocket connections **from dashboards**.
- Forward every hardware message to all connected dashboards (fan-out).
- Forward `command` messages from a dashboard back down to the hardware.
- This alone makes the system work end-to-end and unblocks both UI people.

### Part B — Storage
- Write every `telemetry` and `platform_status` message into a database as it arrives (with its `ts`).
- Keep it simple. This is not a big-data problem — a few messages per second.

### Part C — REST API (history + retrieval)
Expose these endpoints so dashboards can pull stored data, not just the live feed:

| Method | Endpoint | Returns |
|--------|----------|---------|
| `GET` | `/api/health` | `{ "status": "ok" }` — used by the dashboard "hardware link" indicator |
| `GET` | `/api/telemetry/latest` | the most recent `telemetry` object |
| `GET` | `/api/telemetry/history?limit=100` | last N telemetry records (for graphs) |
| `GET` | `/api/gps/track?limit=200` | list of `{lat, lng, ts}` — feeds Dashboard 1's breadcrumb trail |
| `GET` | `/api/platform/history?limit=200` | last N platform_status records (for replaying a drive) |
| `POST` | `/api/command` | accept a command over HTTP too (backup path if WebSocket drops) |

Keep the JSON shapes identical to the Message Schema. A GPS point from the API must look the same as one from the live stream.

---

## 3. Suggested stack (pick what the person already knows)

Don't over-engineer. Two clean options:

**Option 1 — Node.js (recommended if they know JS, since the dashboards are JS):**
- `express` for the REST API
- `ws` for WebSockets
- `sqlite` (via better-sqlite3) or a JSON file to start — upgrade later if needed

**Option 2 — Python:**
- `FastAPI` (has REST + WebSocket built in, auto-generates API docs)
- `sqlite3` (built into Python)

Either is fine. SQLite is the right database to start — one file, zero setup, more than enough for this data rate. Postgres/Mongo only if the team specifically needs it later.

---

## 4. Database — start with two tables

```sql
CREATE TABLE telemetry (
  id        INTEGER PRIMARY KEY,
  ts        INTEGER,          -- ms epoch, from the message
  payload   TEXT              -- the full JSON telemetry object as a string
);

CREATE TABLE platform_status (
  id        INTEGER PRIMARY KEY,
  ts        INTEGER,
  payload   TEXT
);
```

Storing the whole JSON blob per row is the fastest way to start and keeps you in lock-step with the schema. You can pull specific columns out later if a query needs them. Don't design 30 columns on day one.

---

## 5. Order of work (so it's useful early, not all-or-nothing)

1. **`GET /api/health`** returning `{status:"ok"}` — 15 minutes, and it lights up the dashboard's connection indicator. Instant proof of life.
2. **WebSocket relay (Part A)** — get one fake hardware sender and one dashboard talking through you. This is the milestone that unblocks the UI team.
3. **Storage (Part B)** — start writing messages to SQLite.
4. **History endpoints (Part C)** — add them one at a time; `/api/gps/track` first since Person A needs it for the trail.
5. **Deploy** — *resolved:* the backend has its own domain, `api.nalusa.space` (`wss://api.nalusa.space/ws`, `https://api.nalusa.space/api/...`), separate from either dashboard's site. (This brief originally assumed it would share `lus.nalusa.space` with Dashboard 1 — that's not how it was deployed; `lus.nalusa.space` is Dashboard 1's own URL.)

---

## 6. What Person C needs from others (so they're not blocked)

- **From you (lead):** deploy target is resolved — `api.nalusa.space`, separate from both dashboard domains.
- **From the UI people:** nothing to start — they build against the schema in parallel. Later, confirm the exact endpoint URLs with them.
- **From the firmware/sensing people:** eventually the ESP32 needs to send JSON to the backend URL instead of serving its own WebSocket. Until then, Person C can develop against a **fake sender** — a tiny script that emits schema-shaped JSON every second so the whole pipe can be built and tested with no hardware present. Tell them to build this fake sender first; it means the backend and both dashboards can be fully developed before a single sensor is wired.

---

## 7. Definition of done (v1) — ACHIEVED

All five original acceptance criteria are met by the deployed backend:

- ✅ Dashboard connection indicator goes green (`/api/health` works).
- ✅ A message sent by a mock sender appears live on both dashboards, through the backend.
- ✅ That same message is stored in the database afterwards.
- ✅ `/api/gps/track` returns a list Dashboard 1 draws as a trail.
- ✅ A `command` from Dashboard 2 is relayed to the platform/hardware side.

The backbone of the project exists and every other track plugs into it. Remaining backend work is tracked as open items (company-cloud migration decision; replacing mock senders with real ESP32 firmware; optional auth on the endpoints).
