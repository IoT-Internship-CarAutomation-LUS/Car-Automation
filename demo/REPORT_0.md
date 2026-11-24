# REPORT 0 — pre-demo setup (2026-11-24)

## 0. Folder state
- Git repo, remote `origin` = github.com/IoT-Internship-CarAutomation-LUS/Car-Automation. `git fetch --all --prune` ran. It pruned origin/Document_Addition and origin/Schema_Versioning.
- Start: branch `main`, **61 commits behind** origin/main, 0 ahead. One modified file, `backend/elm327_bt.py` (`COM_PORT` changed from `/dev/rfcomm0` to `COM15`). No staged or untracked non-ignored files.
- Stashes (2, left untouched): `stash@{0}` WIP on main (06b58ed), `stash@{1}` WIP on main (d4126e4).
- Local branches:
  - `main`: 0 ahead / 61 behind origin/main.
  - `Schema_Versioning`: remote gone, 39 ahead / 141 behind origin/main.
  - `tidy-backend-mocks`: no upstream, 0 ahead / 86 behind origin/main.
  - Remote branches now: Format_Modifying, gps-integration, schema-versioning-clean, schema-versioning-land.
- Done: `backup/pre-demo-2026-11-24` (1be4ec1) holds the COM15 edit, committed as "backup: local state before demo work". Back on main, `git merge --ff-only origin/main` succeeded (main had no local-only commits, so no `backup/local-main` branch was needed).
- Folder check: backend/, dashboard-telemetry/, docs/, firmware/, scripts/, sensing/ are all present. Extras: hardware/, Instruction Docs/, Internship/, dashboard-control/ (only `_headers`), ws_test.py, `_headers`. Git-ignored: logs/, backend/telemetry.db, .claude/, __pycache__.

## A. Daily digest removed
- Deleted `.github/workflows/daily-digest.yml` and `scripts/generate_daily_digest.py`. It was the only workflow, so `.github/` is now gone. `docs/day-reports/` is kept.
- Doc search: no file claimed the automation. The README `docs/` row now says the digest was retired. CONTRIBUTING, ONBOARDING and docs/ needed no change.
- Pushed to origin/main without errors:
  - 248e057 "chore: retire daily digest workflow after internship"
  - 952a90c "docs: note daily digest workflow retired in README"
- The README edit was not staged in the first commit. I added it as a second commit rather than amending a pushed commit.
- Last origin commit before mine was the bot's "docs: update daily activity digest [automated]" (042fcbd).

## B. Skills
- Copied from anthropics/skills into `~/.claude/skills/`: `frontend-design` (SKILL.md, LICENSE.txt) and `webapp-testing` (SKILL.md, scripts/, examples/, LICENSE.txt).
- Impeccable: `npx skills add pbakaus/impeccable --skill impeccable -g -a claude-code -y` worked ("copied"). The path is `~\.claude\skills\impeccable` (agents/, reference/, scripts/, SKILL.md). A copy already existed there from 16 Sep, and the install overwrote it. The git fallback was not needed. The installer showed a Snyk "Med Risk" and a Socket "1 alert" rating for the skill.
- Temp clone deleted. User skills folder now: find-docs, frontend-design, impeccable, synced (pre-existing), webapp-testing.
- Playwright: `pip install playwright` and `python -m playwright install chromium` done (Chrome Headless Shell 159.0.8154.6). The headless `about:blank` check printed "playwright ok about:blank".

## C. Environment and discovery
- `python` = 3.13.17, `py` = 3.14.3. Node v22.21.0, npm 11.15.0. `backend/requirements.txt` installed with no errors.
- `dry_run.py`: **ALL 74 CHECKS PASSED**. The `--stream` test was skipped by design.
- Backend: `uvicorn main:app --port 8000` started, `GET /api/health` returned `{"status":"ok"}`, then it was stopped (port 8000 confirmed closed). My first taskkill hit the wrong PID, so I stopped it via the port listener.
- **CSV search**: 5 files, all under git-ignored `logs/`. All timestamps are IST. **None has lat/lng columns** and **none is the 18 July drive**.

  | File | Rows | First → last (IST) | Max speed_kmh |
  |---|---|---|---|
  | logs/2026-07-16/decoded/decoded_2026-07-16.csv | 40 | 07-16 13:59:31 → 14:00:21 | 0.0 |
  | logs/2026-07-16/stream/stream_2026-07-16.csv | 2 | 13:59:30 → 13:59:59 | no speed column |
  | logs/2026-07-31/decoded/decoded_2026-07-31.csv | 1597 | 07-31 19:52:06 → 21:05:17 | 0.0 |
  | logs/2026-07-31/raw/raw_2026-07-31.csv | 474 | 19:52:05 → 19:52:56 | no speed column |
  | logs/2026-07-31/stream/stream_2026-07-31.csv | 1566 | 19:52:05 → 21:07:13 | no speed column |

  - decoded columns: session_id, ts_iso, ts_ms, rpm, speed_kmh, coolant_c, engine_load_pct, throttle_pct, fuel_level_pct, maf_gps, intake_temp_c, ambient_temp_c, map_kpa, mil_on, dtc_count, packet_hex
  - raw columns: session_id, ts_iso, ts_ms, pid, request, response, decoded_value, status
  - stream columns: session_id, ts_iso, ts_ms, event, detail
  - Other sources checked read-only:
    - `backend/telemetry.db` (ignored): 577 JSON rows, 2026-07-31 20:04–20:15 IST, no GPS lat/lng values, no speed above 0 in the fields I checked.
    - Git history: `backend/obd_session.csv` (288 rows, 2026-07-10 16:01–16:07 IST, max speed 0) was tracked and later removed.
  - The 18 July drive (~285 packets, GPS) is **not on this machine**. README says "285/285" for 18 Jul. It is probably on the Pi, on another teammate's laptop, or in a OneDrive/Drive folder.
- **Old Control Console** (read from b2992a4^, not restored). Files: README.md, _headers, control-console.css, control-console.js, history.css, history.html, history.js, index.html.
  - index.html (Tailwind, Chart.js and Lucide via CDN, dark slate theme):
    - Header: WS URL input (default `wss://api.nalusa.space/ws`), Connect button, connection status.
    - Collision-avoidance banner with CLEAR / SLOWING / BRAKING states.
    - Link to History.
    - Left, Drive Controls: drive-state box, Start and Stop, D-pad (Forward, Left, Right, Backward), Brake, a large EMERGENCY STOP, a target-speed slider (0–10 km/h), and an outbound command log.
    - Right, Live Feedback: distance travelled with a progress bar to a 100 m target, current speed and target speed, obstacle distance (cm, "--" for -1 or null), battery (battery_mv / 1000 V), heading with a compass direction, a feed-freshness dot (stale if `now - ts > 3000 ms`), and an inbound status log.
  - control-console.js message types:
    - Outbound `{type:"command", action, ...}` with actions forward (plus target_speed_kmh), set_speed, stop, brake, estop, and the unschemed left, right, backward, start.
    - Inbound `{type:"platform_status", ts, drive_state, avoidance_state, distance_m, target_distance_m, speed_kmh, target_speed_kmh, obstacle_cm, heading_deg, battery_mv}`. Other types are ignored.
  - history.html/js:
    - Fetches `https://api.nalusa.space/api/platform/history?limit=100`.
    - Five summary cards: total records, average speed, max speed, low-battery count, max distance.
    - Speed, battery and distance line charts (Chart.js).
    - A safety-events table.
    - A searchable history table.
- **obd_decoder / FRAME_FORMAT**:
  - `pack_packet(decoded: dict, gps: dict = None, extras: dict = None) -> bytes` (32 bytes, CRC-8 in byte 31).
  - `unpack_packet(raw_bytes: bytes) -> dict` raises ValueError if the length is not 32.
  - `decoded` is `{pid_int: value_or_None}` with keys 0x0C RPM, 0x0D speed, 0x05 coolant, 0x04 load, 0x11 throttle, 0x2F fuel, 0x10 MAF, 0x0F intake, 0x46 ambient, 0x0B MAP. 0x01 is a `(mil_on, dtc_count)` tuple or None.
  - `gps` has keys lat, lng, sats, fix.
  - `extras` has keys battery_v, gear (0–6, 0x0E = reverse, None = unknown), seq, `can` {brake, clutch, ac: bool|None}, and `health` {power_ok, gps_ok, can_ok}.
  - unpack output:
    - Top level: `schema_version`, `ts` (ms, from uint32 seconds), `vehicle`, `gps`, `device`, `crc_valid`. No `type` and no `tyres` key.
    - `vehicle`: rpm, speed_kmh, gear, throttle_pct, coolant_c, fuel_level_pct, maf_gps, engine_load_pct, intake_temp_c, ambient_temp_c, map_kpa, battery_v, mil_on, dtc_count, brake, clutch, ac_on.
    - `gps`: lat, lng, sats, fix.
    - `device`: power_ok, gps_ok, can_ok, seq.
  - Caveats:
    - FRAME_FORMAT.md is out of date against the v2.0.0 decoder: it lists `battery_mv`, `clutch_pct`, `fuel_mileage_kmpl` and a `tyres` block. The decoder emits `battery_v`, boolean clutch, and no tyres.
    - `elm327_bt.py` adds `type:"telemetry"` and an all-null `tyres` block at about line 525.
  - **No code exists for the 16-byte TPMS packet.** README and MESSAGE_SCHEMA say it was designed but never wired, and MESSAGE_SCHEMA has no tyre byte layout. `tyres` is always all-null.

## D. Demo branch
- Branch `demo/fleet-dashboard` created from main (952a90c), local only, not pushed.
- `CLAUDE.md` (53 lines) committed as 7561365 "docs: add CLAUDE.md for demo work". It covers the project, repo map, key files, goal levels 1–3 plus extra, hard rules, working rules, and how to run, with a placeholder for `demo/run_demo.py`.
- `demo/REPORT_0.md` is this file, left uncommitted as asked.

## Choices I made
1. Committed the lone COM15 edit to the backup branch using `git add -A`. No other files were affected.
2. Nothing existed to back up as local-main commits, so `backup/local-main-2026-11-24` was not created.
3. Added the README retirement line as a second commit rather than amending a pushed commit.
4. Added the Co-Authored-By and Claude-Session trailers to the CLAUDE.md commit only. The two commits on main follow your exact messages with no trailers.
5. Left the old `Schema_Versioning` and `tidy-backend-mocks` local branches and both stashes untouched.
6. Used `python` (3.13) for everything. Installed packages into the global Python, with no venv.
7. Did not search outside the repo for the 18 July CSV (you said to stay inside the folder).
8. Wrote the CLAUDE.md "Python is python (3.13) or py (3.14)" and "74 checks" lines from observed values. Update them if the toolchain changes.

## Errors / open items
- First taskkill of uvicorn used the wrong PID. Fixed by stopping the port-8000 listener.
- Git warns that LF will be replaced by CRLF on README.md and CLAUDE.md (autocrlf). Harmless.
- The 18 July drive CSV is missing locally, so the replay data for the Fronx will need to come from elsewhere or be simulated.
