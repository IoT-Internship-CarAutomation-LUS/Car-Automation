# REPORT 3: "How data flows" (/flow/) (2026-11-25)

Branch `demo/fleet-dashboard`.

**Run:** `python demo/run_demo.py`, then open http://localhost:8000/flow/. It is also reachable from **How data flows** in the fleet header, and from **Trace this packet** in any car view (opens `/flow/#car=<id>`).

## 1. What the page does

It follows **one value** from the car's ECU to the number on the dashboard tile, through eight stages plus a GPS side branch.

**Header and toolbar:**
- **Trace:** RPM 0x0C, speed 0x0D, coolant 0x05, throttle 0x11, fuel 0x2F.
- **Source:** every car on the fleet, including console cars as they join.
- **Pause/Live.**
- **Report example:** the exact numbers from Figures 4.3 and 5.13.
- **Summary view:** all the transformations for the value stacked in one column.
- Light/dark toggle.

**Pipeline strip:**
- Stages 1–3 are the hardware family ("In the car": dashed, Fog fill). Stages 4–8 are the software family ("Our code": solid, accent rule).
- The GPS branch sits above stage 5 and joins there.
- A dot glides along a rail to the active stage.
- **Keys:** Left/Right, Space (walk through, about 6 s per stage) and 1–8.

**Four panes per stage:**
- What happens (2–4 sentences and a key fact).
- The data here (input → transformation → output, with the traced bytes highlighted).
- The code (real snippets with file path and real line numbers, key lines highlighted, long functions collapsed with "N lines hidden, show" and "Expand all").
- Evidence (the report figure, its exact caption, "Report Figure X.Y" and a one-line note). Clicking a figure opens an in-page lightbox.

## 2. Stages, code and figures

| Stage | What it shows (RPM example) | Real code (file:lines at build time) | Report figure |
|---|---|---|---|
| 1 Car ECU | crankshaft sensor → ECU engine speed | none ("inside the car") | 5.11 Live Capture Inside the Fronx, 10 July |
| 2 OBD-II port | SAE J1962 pins 6/14 CAN, 16 +12 V, 4/5 ground. Request `7DF [02 01 0C ..]`, reply `7E8 [04 41 0C 0D 2E ..]` (ISO 15765-4). States that the ELM327 handles this and our code never sees these frames | none | 4.1 OBD-II Connector Pin Layout and the Pins Used; 4.3 Path of an Engine Speed Request and Its Reply |
| 3 ELM327 | /dev/rfcomm0 at 38400 baud. ATZ, ATE0, ATL0, ATSP0, ATH0, then `01 0C\r` → `41 0C 0D 2E\r\r>` | `backend/elm327_bt.py`: `AT_INIT_SEQUENCE` 69–75, `initialise_elm327` 154–185, `query_pid` 188–220 | 5.13 Raspberry Pi: ELM327 Initialisation and First Combined OBD and GPS Reading; 5.12 Parts for the In-Car Unit: Raspberry Pi 4, ESP32 Boards, GPS and CAN Modules |
| 4 Pi decodes | `decode_pid("41 0C 0D 2E")` → ((0x0D × 256) + 0x2E) / 4 = (3328 + 46) / 4 = 843.5 | `backend/obd_decoder.py`: `decode_pid` 160–192 and the PID's decoder (`_d_0x0C` 131, `_d_0x0D` 132, `_d_0x05` 133, `_d_0x11` 135, `_d_0x2F` 136) | 6.2 Raspberry Pi: Raw Replies, Decoded Values and the Packed 32-Byte Packet |
| GPS branch | NEO-6M `$GPGGA` sentence (rebuilt from the packet) → DDMM.MMMMM → decimal degrees → int32 × 1,000,000 → bytes 7–10 / 11–14 | `sensing/gps_neo6m_pi.py`: `NMEAParser._parse_gga` 208–256 and `parse_nmea_lat_lng` 66–106; `obd_decoder._coord` 248–252 | 5.4 Board 2 with GPS, CAN and GSM Modules |
| 5 Pack 32 bytes | value → `_u16(value, 4)` → bytes 4–5; the 32-byte grid in the fleet's field colours, sentinels hatched; `crc8(bytes 0–30)` checked against byte 31 | `obd_decoder.py`: `pack_packet` 255–336 (highlight follows the traced PID), `crc8` 213–219 | 6.2 (as stage 4) |
| 6 Unpack to JSON | bytes → schema JSON with the traced field highlighted; `crc_valid` recomputed | `obd_decoder.py`: `unpack_packet` 348–409 | 6.4 Laptop Receiver: Every Packet Decoded and Passing its CRC |
| 7 Backend | WebSocket text frame → route by type → `save_telemetry` (the SQLite row `id, ts, payload`) → `fan_out` | `backend/websocket_handler.py`: `websocket_endpoint` 26–92, `fan_out` 95–114; `backend/database.py`: `save_telemetry` 33–41 | 6.3 Raspberry Pi: Capture Running with Packet Forwarding Enabled |
| 8 Dashboard | `onmessage` → `FT.ingest` → `state.cars[id].msg` → the tile drawn with its provenance tag | `demo/fleet-dashboard/js/app.js`: `FT.connect` 240–261, `FT.ingest` 39–96; `demo/fleet-dashboard/js/car.js`: `setTile` 359–378 | 6.5 Dashboard Showing a Real Engine Speed Reading on 14 July |

All line numbers come from `build_snippets.py` and are regenerated with the code. Captions were copied from the PDF text, including those that wrap onto a second line.

**Not supported / not applicable**, shown in every stage:
- The ECU offers nothing.
- The CAN reply is no data (or a 7F).
- The ELM327 prints `NO DATA`, which `query_pid()` turns into `7F 01 2F`. This is exactly what Figure 5.13 shows for fuel.
- `decode_pid` returns None.
- The packed byte is the sentinel FF and unpacks to null.
- The tile reads "Not supported", or "Not applicable (EV)" on the Roadster, or "No reading" (for example a console car with the ignition off).

## 3. Reconstruction, and its test

Our cars send packets, not ELM327 text, so stages 1–4 are **rebuilt from each real packet** and labelled "Reconstructed from this packet". Stages 5–8 are labelled "Actual packet". Report-example mode is labelled "From report Figures 4.3 and 5.13".

**How each PID is rebuilt** (`demo/obd-flow/js/flow-model.js`):
- **RPM:** raw = rpm × 4 → A = raw >> 8, B = raw & 0xFF → `41 0C AA BB`.
- **Speed:** A = speed.
- **Coolant:** A = °C + 40.
- **Throttle and fuel:** the car speaks in 1/255 steps but our packet stores 0.5 % steps, so A is the byte whose decoded value packs to **exactly** the packet's byte, choosing the closest such A.

**Round-trip test** (`demo/tests/test_flow_roundtrip.py`, run in Node, no browser):
- **JS port vs Python:** the JS `decodePid` was compared with the real Python `decode_pid` on 2,073 replies (every byte for each traced PID, a sweep of two-byte RPM replies, NO DATA / 7F / short replies). **0 mismatches.**
- **Real simulator packets:** 3,600 packets from `fleet_sim.py` (all five cars, Fronx recorded **and** simulated, Omni overheating) × 5 PIDs. **18,000 / 18,000 exact:**
  - The value itself for RPM, speed and coolant.
  - The packet byte, and so the unpacked value, for throttle and fuel.
  - Every null sits on the FF sentinel, and its NO DATA reply decodes to None.
- **In the browser:** the same check over live packets for 12 s, every car on the fleet including a console car. **570 / 570 exact** (every live packet × 5 PIDs) over the Fronx, Corolla, Veyron, Omni, Roadster and a console car (`live-acnk`) in the final run (565 / 565 in the first run).

## 4. Report figures (private source)

**The private source:**
- `demo/_private/` is in `.gitignore`. `git check-ignore -v "demo/_private/Shahid Final.pdf"` matches `.gitignore:19:demo/_private/`.
- The report file is named `Shahid Final.pdf` (with a space), not `Shahid_Final.pdf`.

**Extraction:**
- PyMuPDF 1.28.6, run through `demo/obd-flow/extract_figures.py`. It reads only pages 27, 30, 37, 45, 46, 48, 57, 58 (two images) and 60.
- I looked at each image and each matches its figure.
- None needed resizing (all are 1,187 px wide or less). Photos were saved as JPG (q82), screenshots and diagrams as PNG. Total about 1.6 MB.
- The captions and figure numbers are in `img/figures.json` and `js/figures.js`.

**Nothing else was extracted:** no title page, no photo or bio page, no Figure 5.6 map.

## 5. Verification

**`demo/tests/verify_flow.py`: 27/27.**

**Page and stages:**
- The page loads with no console errors and the default source (Fronx, recorded) is live.
- The strip renders 8 stage nodes plus the GPS branch.
- All 9 views render What / Data / Evidence / Code for every one of the 5 traced PIDs.
- **Every code pane equals the real source lines:** 85 snippet renders compared line by line with the files.

**Code panes and evidence:**
- Long functions are collapsed around their highlighted lines and expand fully.
- All 10 figures load as images, and each stage's evidence image renders.
- Clicking a figure opens the lightbox with its caption ("Report Figure 5.13: …").

**Navigation:**
- Keyboard 1 / Right / 8 / Left moves to ecu / port / dash / backend.
- Space starts the walk-through: it advanced after 6.0 s, to the GPS branch, and Space stops it.

**Modes and sources:**
- **Report example:** `41 0C 0D 2E` → 843.5 rpm appears in stages 3 and 4 and in the summary.
- **Source picker:** a console car that connects after the page has loaded appears in the picker, and the page follows its packets.
- **In-browser round trip** over live packets: 570 exact, 0 failed, across all six cars.
- **Not-supported path:** Fronx fuel, Omni throttle and Roadster coolant all run NO DATA → None → FF → null → "Not supported" (or "Not applicable (EV)" for the Roadster). The Roadster's motor RPM is traced normally, as a control case.
- **Pause** holds the packet, and Live follows new packets again.

**Links and layout:**
- The fleet header links to `../flow/`, and "Trace this packet" opens `/flow/#car=corolla` with Corolla selected.
- No horizontal scroll at 1920×1080, 1536×864 or 1366×768, in light and dark.

**Other suites:**
- **`demo/tests/test_flow_roundtrip.py`:** **PASS.**
  - JS `decodePid` vs Python `decode_pid`: 2,073 replies, 0 mismatches.
  - 18,000 / 18,000 exact over 3,600 real simulator packets.
- **Level 1 (`verify_dashboard.py`):** **27/27 live and 27/27 standalone** (54/54).
- **Level 2 (`verify_level2.py`):** **60/60**. The two presenter-QR checks only run in `--shots` mode, so the final run wrote its screenshots to a scratch folder and the committed Level 2 images were left unchanged.
- **`python backend/tests/dry_run.py`:** **ALL 74 CHECKS PASSED.** With `--stream`: **ALL 83 CHECKS PASSED.**
- **`python backend/tpms_codec.py` and `python backend/obd_decoder.py`:** ALL TESTS PASSED.
- **`python demo/obd-flow/build_snippets.py --check`:** OK, 22 snippets found and every highlight matches.

## 6. Impeccable audit and polish

**Process:**
- **Surface:** the page extends the established fleet world (Operate mode, code-first; DESIGN.md tokens and the shared `app.css`). No new identity was introduced; the projector root size is one step larger (15 px, or 17 px at 1700 px and wider).
- **Detector:** run once over `index.html`, `flow.css` and `flow.js`.

**Detector findings:**
- **Warning, fixed:** a lightbox `<img>` without a `src`. The image is now created only when the lightbox opens.
- **Advisories, partly fixed:** off-scale radii 5 px and 10 px were snapped to the 6/8/12 scale. Two hairline radii (the 2 px rail and the 4 px inline highlight) match the fleet's byte cells and were kept.
- **Advisories, intentional:** off-ramp font sizes are the projector type sizes for this page.
- **False positive:** the detector cannot resolve `../fleet/css/app.css` from disk (the path only exists when served), so its colour rules were incomplete.

**Audit**, scored after the fixes:

| # | Dimension | Score | Finding and fix |
|---|---|---|---|
| 1 | Accessibility | 3 | **Code-token contrast:** light numbers (4.43:1), light function names (4.36:1) and dark comments (4.03:1) were below 4.5:1 on highlighted rows. **Fixed:** new token colours measure 5.3–7.1:1 in their own theme. Stage nodes are buttons with `aria-current="step"`. All navigation also works from the keyboard. The lightbox is a native `<dialog>` (Esc and a close button). The status text is a polite status region that changes only with the mode. |
| 2 | Performance | 4 | Live re-render is throttled to about 2 per second. Code and evidence re-render only when the stage, PID or supported state changes. highlight.js loads as three small ES modules (30 KB). Figures are lazy-loaded. |
| 3 | Theming | 3 | Tokens are shared with the fleet. Code colours have a separate dark set. |
| 4 | Responsive | 3 | 1920×1080, 1536×864 and 1366×768 in both themes, with no horizontal scroll. Below 1100 px the panes stack and the strip wraps to four columns. |
| 5 | Implementation integrity | 4 | One world across `/fleet/`, `/drive/` and `/flow/`. The page reuses the fleet's codec, WebSocket state and tile code rather than copying them. |
| | **Total** | **17/20 (Good)** | |

**Polish during the build:**
- **The dot on the strip** sat over the node text. It now rides a rail under the stage row.
- **The decode arithmetic** wrapped in a narrow output box. The transformation column is capped and the output column is wider.
- **The ELM327 key fact** always quoted the RPM reply. It now quotes the traced PID's reply.
- **Provenance tags in the summary** were set in mono. They now use the UI face.
- **The `websocket_endpoint` highlight** lit both identical `fan_out` lines. An `@first:` option now highlights only the telemetry branch.

## 7. Screenshots (`demo/screenshots/flow/`)

The following exist for `light`/`dark` and for `1920x1080`/`1366x768`:
- `stage2_port_<theme>_<size>.png`
- `stage4_decode_<theme>_<size>.png`
- `stage5_pack_<theme>_<size>.png`
- `stage7_backend_<theme>_<size>.png`
- `summary_report_<theme>_<size>.png`

That is 20 files. The stage views use the live Fronx; the summary uses the report example.

## 8. Push

`[[PUSH]]`

## 9. Known issues

1. **Some evidence figures show real data from the test location.** Figures 5.13, 6.2 and 6.4 show real GPS coordinates (12.805…, 79.938…), and Figure 6.3 shows private LAN IPs (10.20.126.x). You chose these figures. They are now in the repository and public when pushed. The report example on the page also uses the coordinates from Figure 5.13.
2. **The push check is not empty:** `git ls-files | findstr /i "pdf _private"` lists 14 PDFs under `Internship/PDF/` (see §8). They have been on `origin/main` since 31 July and this branch did not add them. Nothing from `demo/_private/` is tracked.
3. **Code snippets are a snapshot.** If you edit a quoted function, re-run `python demo/obd-flow/build_snippets.py`; `--check` fails if a function or highlight is missing. The `/flow/` test compares the page with the files, so it would catch a stale snippet.
4. **Partly illustrative report example.** Its packet timestamp uses 16:37 IST on 18 July (the minute is illustrative). The CAN padding bytes are shown as `··`, because the padding value depends on the adapter and the report does not show it.
5. **The page needs the backend.** It reuses `/fleet/` files and ES-module highlighting, so it is not meant to be opened from disk. Without a backend it falls back to the in-browser simulator after 4 s, like the fleet page.
6. **Older screenshots don't show the new links.** The Level 1 and Level 2 screenshots predate the "How data flows" header link and the "Trace this packet" button. The behaviour checks were re-run.
7. **CAN-level frames are illustrative of ISO 15765-4.** The ELM327 hides them. The page says this in stage 2 and does not claim we captured them.

## 10. Choices I made

1. **Report figure file name.** The report is `demo/_private/Shahid Final.pdf` (with a space), so `extract_figures.py` uses that name.
2. **The extraction script is committed** (it contains no report content). The PDF never is. The script exits with a clear message if the PDF is missing.
3. **Image formats.** Photos are JPG and screenshots and diagrams are PNG. All were already 1,187 px wide or less, so nothing was resized.
4. **The GPS code comes from `sensing/gps_neo6m_pi.py`** (`NMEAParser._parse_gga`, `parse_nmea_lat_lng`). This branch's `elm327_bt.py` still has the GPS placeholder, while the 18 July capture ran `elm327_bt.py` from the gps-integration branch, which imports this same `NMEAParser`. The page says so.
5. **Stage 3 shows the real request string `"01 0C\r"` (with a space)**, as `query_pid()` builds it and as Figure 4.3 shows. Your brief wrote `"010C\r"`.
6. **Stage 3 shows the full AT sequence** from `AT_INIT_SEQUENCE` (ATZ, ATE0, ATL0, ATSP0, ATH0), as in the code and Figure 5.13, not only the three in the brief.
7. **The not-supported reply is `NO DATA` → `7F 01 xx`.** That is what `query_pid()` returns, and what Figure 5.13 shows for fuel (`7F 01 2F`) and ambient (`7F 01 46`).
8. **Report example: the whole Figure 5.13 capture cycle**, not only RPM. All eleven raw replies are decoded with the JS `decodePid`, packed with `packPacket` and unpacked. So every PID, and the GPS branch, has report numbers, with fuel showing the not-supported path.
9. **Throttle and fuel reconstruction** matches the packet byte rather than an impossible exact value, because the car's 1/255 steps and our 0.5 % steps differ. The page explains this.
10. **highlight.js 11.9.0** comes from the ES-module builds of core + python + javascript (cdnjs), loaded by a tiny `hl.js` module. The page works without it (plain text), and re-renders when it arrives.
11. **The page reuses `../fleet/js/app.js`** for the WebSocket, state and `FT.ingest`, so the packets traced are the same live packets the fleet shows. Stage 8 quotes that very code.
12. **Collapse rule:** a snippet longer than 16 lines shows its first two lines, two lines around each highlighted line, and the last line. The rest is folded behind "N lines hidden, show", plus "Expand all". Nothing is ever cut.
13. **Walk-through:** 6 s per stage, through 1 → 2 → 3 → 4 → GPS → 5 → 6 → 7 → 8 → 1. The 1–8 keys jump to the main stages, and the GPS branch is reached with Left/Right or by clicking.
14. **State in the URL:** `#car=…&pid=…&stage=…`, plus `view=summary` or `mode=report`. Links and screenshots are therefore reproducible, and "Trace this packet" opens straight on the car.
15. **The two Level 1/2 changes are only links:** a "How data flows" text link in the fleet header, styled like the shell, and a "Trace this packet" button in the car-view header, styled like the existing Back button. Nothing else in Levels 1 and 2 changed.
16. **Talk placement:** in RUN_SHEET.md the flow page sits between the fleet view and live driving (1:30 to 2:45), with the Summary view kept for questions.
17. **New dependencies:** PyMuPDF and Pillow, installed only to run `extract_figures.py`. They are not needed to run the demo or its tests.
18. **`init_db` (the table definition) is extracted but not shown;** stage 7 shows the row shape directly. It is kept as a check that the table still has the `(id, ts, payload)` columns the page describes.
