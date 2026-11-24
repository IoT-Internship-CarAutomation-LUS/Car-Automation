# REPORT 2: Level 2 driver console and the Level 1 review fixes (2026-11-25)

Branch `demo/fleet-dashboard`. The push result is in §9.

**Run:** `python demo/run_demo.py`. It starts the backend on 0.0.0.0:8000 and the simulator, and opens http://localhost:8000/fleet/.
- **Driver console on this laptop:** http://localhost:8000/drive/
- **On a phone or second laptop:** `http://<laptop LAN IP>:8000/drive/`. The launcher prints it, and the presenter panel (P) shows it as text and a QR code.

Step-by-step for the review: `demo/RUN_SHEET.md`.

## 1. Part A: fixes from your review of Level 1

### A1. Map opened far too zoomed out
**Cause.** The map was framed once at start-up, sometimes before its container had a size, which makes Leaflet fit to a tiny box. A pan I added in Level 1 then pushed the cars to one side.

**Fix (`fleet-dashboard/js/fleet.js`):**
- **When it frames:** a ResizeObserver frames the map as soon as, and whenever, the container has a real size.
- **What it frames:** `fitBounds` covers every route plus every car's current position (live cars included), with 36 px padding and a maximum zoom of 14. The corner pan is gone.
- **Fit all:** a new button reframes on demand. Automatic framing stops once you scroll, drag or click the map.
- **Zoom cap:** `minZoom: 11` and Chennai `maxBounds`, so the view is never wider than about 85 km.
- **Wheel zoom:** `zoomSnap 1`, `zoomDelta 1` and `wheelPxPerZoomLevel 120`, so one notch is one level and it isn't jumpy.

**Measured views:** zoom 12 (42 km wide) in a 1920×1080 viewport; zoom 11 (84 km) at 1920×960, (68 km) at 1536×864 @125 %, and (56 km) at 1366×768. All routes are in view at every size.

### A2. Tile seams (faint lines)
**Cause.** Leaflet 1.9 blends tiles with `mix-blend-mode: plus-lighter`. At fractional device-pixel ratios, such as 125 % Windows scaling, the hairline where tiles overlap is drawn brighter, which gives light lines.

**Fix (`css/app.css`):**
- Whole-number zoom only.
- `img.leaflet-tile { mix-blend-mode: normal; width/height: 256.5px }`, so tiles overlap by half a pixel with normal blending.
- This applies to the car-view mini map too.

The browser checks confirm the computed style is applied on both maps at 1536×864 @125 %. Close-up crops are in `level2/map_seam_probe_*`.

### A3. Vehicle list cut off at 1920×1080
**Fix.** Rows were rebuilt as divided rows inside the column:
1. Name and data tag.
2. Plate and status.
3. Speed, RPM and the single most severe alert badge, plus a count.
4. The packet ribbon and field count.
5. A "Driven live from the Control Console" line, only for console cars.

**Measured row heights:** 87 px (14 px root) and 100 px (16 px root at 1700 px and wider).

**Results:**
- **All six cars (5 simulated + 1 live) fully visible without scrolling** at 1920×1080, 1920×960 (browser chrome), 1536×864 @125 % and 1536×740 @125 % (browser chrome).
- **At 1366×768:** six visible in the viewport, and the first five with browser chrome. The brief required four.
- **Space under the list at 1920:** now a tidy "Packet ribbon" key (field-group colours and hatch), pinned to the bottom of the column. Its explanatory sentence hides on short screens.

## 2. Level 2 design: "Control Console - Driver Simulator" (`demo/driver-console/`, `/drive/`)

The retired Control Console is reborn as a driver console. It keeps the old console's big clear controls, status banner, emergency stop and freshness dot, in the fleet dashboard's design system.

**Shared with the fleet dashboard:**
- It loads `../fleet/css/app.css` (tokens, shell, panels, tiles, byte strip), `../fleet/js/codec.js` (the byte-identical packPacket/unpackPacket + CRC-8 and the TPMS packer) and `../fleet/js/ui.js`.
- It uses the same light/dark toggle and the same `localStorage` key.

**Layout:**
- **Header** (title, link state, theme), then a **status banner** (sending dot, plus info / good / warning / critical).
- **Setup card:**
  - Car: "Live Demo Car (manual, 6-speed)", "Maruti Suzuki Swift (manual)" or "Hyundai Creta (automatic)".
  - A fake TN registration, pre-filled and editable; powertrain Petrol.
  - The backend WebSocket URL, derived from the page's own host, with an override field.
  - The vehicle id and a **Connect** button.
- **Once connected:**
  - **Left column:** instruments (speed, gear, RPM bar with redline and a flashing limiter, coolant, fuel, battery), then the live 32-byte packet strip (packets sent, rate, seq).
  - **Right column:** ignition, horn, a large emergency stop, the gear lever, and three tall pedals.

**Identity:** `vehicle_id` is `live-<4 random chars>`, new on every page load, so two tabs or devices are two cars.

**Position:** it starts at BS Abdur Rahman Crescent Institute of Science and Technology, Vandalur (Nominatim, looked up once: 12.8748935, 80.0848035). It follows a 17.2 km OSRM loop over campus roads and GST Road between Vandalur and Kilambakkam, fetched once into `demo/data/routes/live.json`. A 9 KB `driver-console/js/live-route.js` copy means a phone doesn't load the 438 KB fleet bundle. The pedals move the car along the loop, heading follows the road, and it has 8–10 GPS satellites.

**Sending:** 5 Hz with the ignition on, 1 Hz with it off. Seq wraps at 256 per car.

**Physics** (forgiving, never stalls):
- Idle is about 765–835 rpm.
- Clutch in or neutral: RPM follows the throttle.
- Clutch engaged: RPM is tied to road speed through gear ratios, with a slip floor so you can pull away in any gear.
- Drive force comes from a torque curve (peak around 3,800 rpm) through the gear ratio.
- Braking up to 8.5 m/s², plus rolling and air drag and engine braking.
- **Rev limiter at 6,000 rpm**, with a flashing bar and banner.
- **Automatic (Creta):** shifts up and down by RPM and throttle, with creep in D.
- **Warm-up and consumption:** coolant warms from 31 °C toward 90 °C (sped up, visible within a couple of minutes), and fuel drains (sped up ×20).
- **Battery:** 14.1 V running, 12.4 V with the ignition off. With the ignition off the ECU is asleep, so engine PIDs are null (sentinels) and only the battery reads.
- **Pedal-driven values:** `throttle_pct` and `engine_load_pct` follow the pedal. `brake` and `clutch` are real booleans from the pedals (the clutch is null and N/A on the automatic). The gear comes from the lever, with reverse reported as 14 (0x0E).
- **Everything else:** MAF, MAP and intake are plausible, and TPMS, cabin and GSM are populated.

## 3. Controls

| Control | Mouse / touch | Keyboard |
|---|---|---|
| Throttle | drag the green pedal down; springs back on release | W or Up (ramps while held) |
| Brake | red pedal | S or Down |
| Clutch | blue pedal (disabled on the automatic) | Space or C |
| Gear | R N 1-6 lever, or P R N D on the automatic | Q down, E up |
| Ignition | button | I |
| Emergency stop | big red button: brakes to 0 fast and raises a critical alert on the fleet dashboard. Releases 3 s after stopping | X |
| Horn | hold the button (two-tone Web Audio, no data) | H |

**Guards:** selecting reverse (or a forward gear) while moving the other way is refused with a banner message, and so is Park while moving.

**Phones:**
- Portrait puts the instruments first, then the controls with tall thumb pedals, then the wire.
- In landscape, the instruments sit beside the controls and the pedals stay 52 vh tall.
- Pedals use pointer events with `touch-action: none` and pointer capture.

## 4. Schema 2.2.0 (additive)

**Version bump:** `config.py`, `obd_decoder.py`, `elm327_bt.py`, `fleet_sim.py`, the JS codec and the `MESSAGE_SCHEMA.md` change log now all say 2.2.0. The `tpms_codec.py` header comment was updated too.

**New fields:**
- **`source.control`:** `auto` for the simulator and replay, `manual` for the console, `null` for the real Pi.
- **`data_mode`:** `live` is used for a person-driven car.
- **`driver` block:** `{ignition, throttle_pedal_pct, brake_pedal_pct, clutch_pedal_pct, transmission, estop}`. It carries null leaves on every other car (the simulator, the standalone simulator and `elm327_bt.py`), and there is a new `driver` provenance group.

**Console provenance:**
- Measured: `throttle_pct`, `brake`, `clutch`, `gear` and the `driver` block.
- Derived: `fuel_mileage_kmpl`.
- Simulated: everything else.
- On the automatic, the clutch is `not_applicable`.

**New `vehicle_left` message:** the backend sends it when a socket that streamed a `control: "manual"` car closes. It is not stored.

**Backend:**
- No gear estimate for `control: "manual"` cars, because the lever's neutral must stay neutral while rolling.
- New `GET /api/lan-info` returns the LAN IPv4 addresses. It ranks the Wi-Fi or hotspot adapter first, skips virtual adapters and caches for 30 s.
- New StaticFiles mount `/drive`.
- 32-byte and 16-byte layouts unchanged.

## 5. Fleet dashboard changes for live cars

- **Identity and card:** any new `vehicle_id` appears automatically with its own colour (spare slots s5 and s6, freed when the car leaves), a **Live** tag and "Driven live from the Control Console". Its marker glides at the real packet interval (0.2 s).
- **Feed:** an info alert "Live car joined: <name>, driven from the Control Console". On `vehicle_left`, "Live car left: <name>" is posted and the car's card, marker and trail are removed.
- **Alerts:** a critical alert "Emergency stop pressed on the Control Console" (badge "E-stop") while `driver.estop` is true. It clears when released.
- **Car view:** a **Driver inputs** panel at the top when control is manual. It shows clutch, brake and throttle bars, gear and gearbox type, and ignition, brake-switch and clutch-switch pills, with the e-stop flag. The panel is hidden for simulated cars. Gear 14 shows as **R**.
- **Map:** "Fit all" includes live cars. The shared console loop is drawn in neutral ink.
- **Presenter panel (P):** a QR code from vendored `qrcode-generator` 1.4.4 (MIT, `vendor/qrcode/`, no CDN), plus the URL as text.
  - Opened as localhost: the page asks `/api/lan-info` for the address.
  - Opened via the LAN IP: it uses its own host.
  - In standalone mode: it explains the console needs the backend.
- **Launcher:** prints both `/drive/` URLs, plus a firewall reminder.

## 6. Verification

**Backend:**
- `python backend/tests/dry_run.py`: **ALL 74 CHECKS PASSED**.
- `--stream`: **ALL 83 CHECKS PASSED**. Schema version is `2.2.0` and the backend logged no mismatch.
- `python backend/tpms_codec.py` and `python backend/obd_decoder.py`: **ALL TESTS PASSED**.

**Level 1 browser checks** (`demo/tests/verify_dashboard.py`, 1366×768):
- Live: **27/27**. Standalone: **27/27**.
- In the first final run, the Veyron "OBD limit" check timed out at 90 s, because the simulated Veyron reaches 254 km/h only in some cruise phases. I rewrote it: it waits up to 180 s and, on every sample, checks that the note's visibility matches the speed shown. On the re-run it passed after 32 s with zero mismatched samples. Nothing in the app changed for this.

**Level 2 browser checks** (`demo/tests/verify_level2.py`): **60/60**, final run after all polish.

**The live car:**

| Check | Result |
|---|---|
| Live car appears on the fleet within 2 s of Connect | yes, 0.00 s (already there when Playwright first checks) |
| It arrives as `data_mode` live, `control` manual, schema 2.2.0, with a Live tag, the console note and "Live car joined" in the feed | yes |
| Dashboard throttle and RPM change after the pedal | 0.22 s (limit 1 s) |
| Dashboard speed starts rising | 0.00 s after the throttle check above |
| 3 s in 1st, then 3 s in 2nd | 41 km/h in gear 1, then 67 km/h in gear 2 |
| Brake (keyboard S) | brake ON on the dashboard in 0.16 s; speed fell from 67 to 23 km/h |
| Emergency stop alert on the dashboard | 0.05 s; car at 0 km/h 0.8 s later |
| Driver inputs panel | shown for the console car (throttle bar follows the pedal), hidden for simulated cars |

**Two consoles and leaving:**
- Two consoles at once are two cars with their own colours (s5, s6). The fleet then shows 7 cards.
- The automatic Creta reports the gearbox's own gear, with the clutch null and `not_applicable`.
- "Fit all" frames every car, live ones included.
- Closing a console: "Live car left" is posted and the car is removed. No console errors in any of the three pages.

**Phone (390×844, touch via CDP, light and dark):**
- Touch-holding the throttle drives the car (about 33 km/h in 2.5 s) and the fleet sees it.
- The pedal springs back to 0.
- No horizontal scroll.
- Landscape (844×390) keeps the pedals large.
- No console errors.

**Presenter panel (light and dark):** shows the QR code and the LAN `/drive/` URL, never localhost.

**Part A**, checked in both themes:

| Size | Cards | Map |
|---|---|---|
| 1920×1080 viewport | all six fit | zoom 12, 42 km wide |
| 1920×960 (browser chrome) | all six fit | zoom 11 |
| 1536×864 @125 % | all six fit | zoom 11 |
| 1536×740 @125 % (browser chrome) | all six fit | zoom 11 |
| 1366×768 | six visible | zoom 11 |
| 1366×650 (browser chrome) | first five visible (four required) | zoom 11 |

- Every size frames all routes at a whole zoom level.
- Tiles compute to `mix-blend-mode: normal`, 256.5 px, on the fleet map and the car-view mini map at 125 %.

**Launcher:** prints both `/drive/` URLs, taken from `/api/lan-info`.

## 7. Impeccable audit and polish

**Process:**
- **Surface brief:** the driver console extends the established fleet world, so no new identity. Its direction contract is in `.impeccable/surfaces/demo-driver-console.md`.
- **Detector:** run once over the console and the changed fleet files (`index.html`, `app.css`, `fleet.js`, `car.js`, `main.js`). There were **no blocking findings**; all were advisories.
  - **False positive:** "Black title text". The detector could not resolve `../fleet/css/app.css` from disk, because that path only exists when served, so it saw an unstyled page.
  - **Intentional:** the hatch stripes, which are the sentinel encoding.
  - **Pre-existing drift in the shared `app.css`:** off-ramp sizes (0.78–0.93rem, gauge px sizes), small radii (1–4 px on byte cells and plates), and the link-dot and EV-plate literals. These are recorded, not changed, to keep the approved Level 1 look.
  - **Console findings, fixed:**
    - A 10 px radius moved to 8 px.
    - Literal `#000` and `#1b1300` became tokens (or a commented fixed ink on the warning colour, which is the same in both themes).
    - 0.93/0.78/0.95rem sizes moved to 0.86/0.82/1rem.

**Audit**, scored after the fixes:

| # | Dimension | Score | Finding |
|---|---|---|---|
| 1 | Accessibility | 3 | The banner was an `aria-live` region whose text included the live speed, so a screen reader would announce it 5 times a second (P1). **Fixed:** the banner now changes only on state changes. Pedals are `role="slider"` with `aria-valuenow`, the gear lever is a radiogroup, every control has a key, and the e-stop is a large target. The trend charts' hover is still mouse-only. |
| 2 | Performance | 3 | Readouts rewrote `innerHTML` on every animation frame (P2). **Fixed:** they write only when the value changes. Physics runs at 20 Hz on one interval. Packets go out at 5 Hz. |
| 3 | Theming | 3 | The Connect button used the dark shell green, which nearly vanished on dark panels (P2). **Fixed:** it uses the accent with surface text in both themes. Everything else is tokens shared with the fleet dashboard. |
| 4 | Responsive | 4 | Phone portrait and landscape, laptop and projector sizes are all verified, with no horizontal scroll. Pedals stay at least 120 px tall. |
| 5 | Implementation integrity | 4 | One world across both pages. The console reuses the fleet's codec and CSS rather than copying them. |
| | **Total** | **17/20 (Good)** | |

**Polish on the changed fleet parts:**
- **Vehicle rows at 1366 and 1536.** The plate and status ran into the RPM, and names truncated hard. **Fixed:** the name and tag now get the full top line, speed, RPM and the alert badge share line 3, and the row is tighter. Six cars fit at 1536×740.
- **Car-view RPM gauge for console cars.** Its tick labels read "1.142857k". **Fixed:** unknown cars get a 0–7k scale, and labels are rounded.
- **Driver inputs panel.** Its fact tiles stretched to fill the row. **Fixed:** they have a fixed width.
- **Console layout.** The packet strip moved under the instruments to balance the columns, and the wire strip got an empty state before connecting.

**DESIGN.md** gained a "Level 2 additions" block covering display-size readouts, pedals, the status banner, the Connect accent, live-car slots and the neutral console route.

No new finish-reviewer agent was run this time: the console extends an approved world, and your instruction for Part D was an audit plus a polish pass.

## 8. Screenshots (`demo/screenshots/level2/`)

**Fleet:**
- `fleet_live_light_1920x1080.png` and `fleet_live_dark_1920x1080.png` (fleet with the live car).
- `fleet_after_leave_light_1920x1080.png`.
- `fleet_{light,dark}_{1920x960,1536x740,1366x650}.png` (Part A sizes, live car included).
- `map_seam_probe_{light,dark}_1536x864_125pct.png`.

**Car view:** `car_live_light_1920x1080.png` and `car_live_dark_1920x1080.png` (Driver inputs panel).

**Driver console:**
- `drive_desktop_light_1366x768.png`, `drive_desktop_dark_1366x768.png` and `drive_setup_dark_1366x768.png`.
- `drive_phone_{light,dark}_390x844.png` and `drive_phone_landscape_{light,dark}_844x390.png`.

**Presenter panel:** `presenter_qr_light_1920x1080.png` and `presenter_qr_dark_1920x1080.png`.

The Level 1 screenshots in `demo/screenshots/` are unchanged from REPORT 1.

## 9. Push

- `git push -u origin demo/fleet-dashboard`: **succeeded**. It created a new remote branch, set to track `origin/demo/fleet-dashboard`.
- Branch: https://github.com/IoT-Internship-CarAutomation-LUS/Car-Automation/tree/demo/fleet-dashboard
- The commit with all the Level 2 work was **5d8e73d** ("demo: Level 2 polish, run sheet, CLAUDE.md, REPORT 2"). This section was then added in one more small commit and pushed the same way; its hash is the branch head on GitHub.
- Only this branch was pushed. `main` and the other branches were not touched. No force-push.
- GitHub offers a pull request link; none was opened.

## 10. Known issues

1. **The network decides whether a phone can connect.**
   - Campus Wi-Fi often isolates clients; use a phone hotspot.
   - Windows must treat the network as Private, and Python must be allowed through the firewall.
   - All of this is in RUN_SHEET.md. I could only test from this laptop (headless browsers, localhost and the LAN address), not from a real phone.
2. **Map tiles (Stadia, OSM fallback) need internet.** A phone hotspot usually provides it.
3. **Phone touch was tested with Chrome's touch emulation** (CDP touch events at 390×844 and 844×390), not on a physical phone. iOS Safari may show its own rubber-band scrolling around the pedals. The pedals themselves use `touch-action: none`.
4. **Fixed engine envelope:** the console's physics use one rev limit (6,000) and one idle (about 800) for all three car identities. The torque, ratios and mass differ per car.
5. **Reloads and duplicates:**
   - Reloading the console page creates a new car (a new id). The old one is removed when its socket closes.
   - "Duplicate tab" makes a second car, as intended.
6. **An abrupt network drop:** `vehicle_left` relies on the backend noticing the closed socket. If a phone simply loses Wi-Fi, the car shows Stale, then Offline after 10 s, until the backend times the socket out.
7. **The QR screenshots show this laptop's private LAN address** (an RFC 1918 192.168.x.x address). It is not reachable from outside the local network.
8. **Kept from REPORT 1:**
   - `dashboard-telemetry` still expects schema 2.0.0.
   - `mock_telemetry.py` still sends 2.0.0.
   - Ambient on the recorded Fronx is replayed as measured; `--fronx-ambient null` follows the original brief instead.
9. **The detector still reports pre-existing type-ramp and radius advisories** in the shared `app.css`, along with the link-dot and plate literals. They are recorded rather than fixed.

## 11. Choices I made

1. **A `driver` block in the schema.** Your 2.2.0 list named `source.control` and `data_mode: "live"`. Showing the pedal bars and raising the e-stop alert also needed pedal positions and an e-stop flag, so I added an additive `driver` block. Every other car carries null leaves, and it gets its own provenance group.
2. **A backend `vehicle_left` message** for the "left" alert. It is sent when the socket closes, so a closed tab, a locked phone or a lost connection all trigger it. A client-side goodbye message would not.
3. **Gear estimation.** The backend skips it for `control: "manual"` cars, so neutral stays neutral while rolling. Reverse uses the existing 0x0E (14) value.
4. **Ignition off means the ECU is asleep:** engine PIDs are null and only the ELM327 battery reading (12.4 V) is real. This matches how a real car behaves.
5. **One car per page load** (`live-xxxx`), not per sessionStorage, so "duplicate tab" or a second window is always a separate car.
6. **Car list and names.** "Live Demo Car" is manual 6-speed. The Swift is manual 6-speed (your brief asked for a 6-speed lever). The Creta is a 6-speed automatic with P R N D. On the fleet, names are sent without "(manual)/(automatic)"; the gearbox type is in the Driver inputs panel.
7. **Forgiving physics.** No stalling, and you can pull away in any gear. Shifting without the clutch is allowed. Direction changes and Park at speed are refused.
8. **Sped-up warm-up and fuel** (×20 fuel, quick coolant), so changes are visible during a 5-minute talk. This is labelled simulated.
9. **The console route** goes over campus roads and GST Road between Vandalur and Kilambakkam, exactly as OSRM returned it. It is longer than a simple loop because of U-turn points.
10. **The console reuses fleet files over `/fleet/...` paths**, so it needs the backend. Opening `driver-console/index.html` from disk is not supported; standalone mode stays a fleet-only backup.
11. **Map zoom limits.**
    - `minZoom 11` plus Chennai `maxBounds`, a trade-off: at very small window sizes some route ends can sit off-screen. Fit all still frames as much as zoom 11 allows.
    - Automatic framing stops once you touch the map, so the presenter can zoom in on a car without it jumping back. "Fit all" turns it back on.
12. **Vehicle row alerts:** only the most severe badge is shown, plus "+n" (all alerts are in the tooltip and the feed), so every row stays one height.
13. **The live-car colour** comes from the spare slots s5 and s6 and is freed when the car leaves. A third console at once gets the neutral slot.
14. **`/api/lan-info`** runs `ipconfig` on Windows (Wi-Fi or hotspot adapters first, virtual adapters skipped), with a routing-table fallback.
15. **File renames.** `demo/README.md` was renamed to `demo/RUN_SHEET.md`, keeping one presenter file. `REPORT_1.md` still mentions the old name, as history.
16. **`demo/REPORT_0.md`** had been left untracked since the setup session. It holds only setup notes (no names or secrets), so I committed it to leave the tree clean, as you asked.
17. **One finish-review round was skipped** this time (see §7). The audit, polish and browser checks were done in-thread.
