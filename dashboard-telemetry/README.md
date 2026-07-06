# Dashboard 1 — Telemetry Monitor

**Owner: Sapthagiri** · Deployed: lus.nalusa.space

Read-only dashboard for real-car data (Objectives I, III, IV). Connects over WebSocket and shows drivetrain, TPMS, engine health, and GPS with a live map + breadcrumb trail. Per-panel freshness dots grey out stale data.

- Parses the `telemetry` JSON message (see `../docs/MESSAGE_SCHEMA.md`). **JSON only — never raw bytes.**
- Files: `index.html`, `a.css`, `a.js`
