# Backend / Streaming

**Owner: Shaahir**

Receives data from the hardware, stores it, and streams it to both dashboards.

**Current direction (Day 5):** use the **company cloud server** — an API endpoint for streaming plus the cloud's RDBMS for storage — rather than a self-hosted server. Details to be confirmed with the company (provider, DB type, credentials).

Responsibilities:
- Ingest `telemetry` and `platform_status` messages.
- Store them in the cloud RDBMS.
- Stream live data to the dashboards; relay `command` messages back to the platform.
- Expose history endpoints for the dashboards to pull past data.

Keep all message shapes identical to `../docs/MESSAGE_SCHEMA.md`. Never commit credentials — use a git-ignored `.env`.
