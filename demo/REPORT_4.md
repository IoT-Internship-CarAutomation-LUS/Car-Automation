# REPORT 4: Level 3, the live 3D view (/3d/) (2026-11-25)

Branch **`demo/level3-3d`**, created from `demo/fleet-dashboard` at `1d91e79`. Before branching, that branch was clean and equal to `origin/demo/fleet-dashboard`. Nothing was committed to, merged into or pushed to `demo/fleet-dashboard` or `main`.

**Run:** `python demo/run_demo.py`, then open http://localhost:8000/3d/ (also **3D** in the fleet header). In any car view, **3D view** in the *Engine and speed* panel opens the same view inline.

## 1. Tiers completed

All three tiers are done.

| Tier | Item | Status |
|---|---|---|
| 1 (must) | 3D car per body type, live data binding, camera, both entry points, tests | Done |
| 2 (should) | Body pitch and roll, TPMS tyre rings, scrolling road and compass, smooth interpolation | Done |
| 3 (nice) | Hardware X-ray with labels linking to /flow/ and a packet pulse | Done |

## 2. What was built

**Files:**
- `demo/view-3d/index.html` and `js/page.js`: the /3d/ page. It has car buttons (keys 1–9), the `#car=<id>` URL, the link state and the theme toggle.
- `js/view3d.js`: the view module, used by both entry points. It holds the scene, the data binding, the camera, the readout, the X-ray labels and the debug object.
- `js/bodies.js`: the six procedural bodies and the wheels.
- `js/world.js`: the road, roadside posts, compass rose, lights and theme palette.
- `js/xray.js`: the hardware overlay.
- `js/motion.js`: the telemetry maths. It is pure, with no three.js and no DOM.
- `css/view3d.css`: scoped `.v3d-*` and `.v3p-*` classes, built on the fleet tokens in `../fleet/css/app.css`.
- `vendor/three/`: three.js **r186** from the npm package `three@0.186.0`.
  - `three.core.min.js` and `three.module.min.js` were minified with esbuild, keeping the licence comment.
  - `OrbitControls`, `RoundedBoxGeometry` and `RoomEnvironment` are copied unchanged, except that their import points at the local module, so no import map is needed.
  - `README.md` and `LICENSE` sit alongside. Total 817 KB. **No CDN at runtime.**
- `backend/main.py`: a `/3d` StaticFiles mount, written like the other three.

**Changes to the approved Levels 1/2 (only what the brief listed):**
- `demo/fleet-dashboard/index.html`: a **3D** header link. In the *Engine and speed* panel head, one **3D view** button and an empty, hidden host div. It also loads one script, `js/embed3d.js`.
- `demo/fleet-dashboard/js/embed3d.js` (new):
  - The first click loads `../3d/css/view3d.css` and dynamically imports `../3d/js/view3d.js`, which brings in three.js.
  - It then swaps the gauges for the canvas. The button becomes **Gauges**.
  - Closing the view, leaving the car view or switching back disposes the renderer and releases the WebGL context.
- `demo/fleet-dashboard/js/car.js`: two lines. `open(id)` lets an open 3D view follow the car, and `close()` disposes it.
- Until the button is pressed, the car view is unchanged and fetches no 3D files. This is verified (0 requests).

**Data:** the module reads the same state as the fleet. That is `window.FT.state`, filled by `../fleet/js/app.js` from the backend WebSocket, falling back to the in-browser simulator. It therefore sees every car, including console cars that join later, and it never opens a second socket.

## 3. How each car body is built

All bodies are generic and stylised. **No model files, no copied designs, no logos.** Identity comes from the fleet slot colour, the name and the number plate.

**Construction recipe (all bodies):**
- **Lower body.** A side profile: a rounded polygon with two wheel-arch cut-outs. It is extruded to the car's width with a 45 mm bevel.
- **Greenhouse.** A narrower profile extruded on top, which gives the tumblehome.
- **Glass.**
  - Side windows are the greenhouse outline inset by the pillar widths and split at the B (and C) pillars.
  - The windscreen and rear glass are thin panels lying just proud of the two slopes.
  - The glass is near-black clear-coated, with reflections from a generated studio environment (RoomEnvironment, no texture files).
- **Details on every car:**
  - Door shut lines and handles, and mirrors.
  - A grille between the headlights, and dark bumper lips front and rear.
  - Headlights, tail lamps, and a centre stop lamp on closed cars.
  - A dark chassis tub that shows through the arches.
  - Front and rear **number plates** lettered in Red Hat Mono with the car's fake registration. Plates are white with black letters, and green with white letters for the EV (Indian plate rules).
- **Wheels.**
  - Lathe-turned tyres with rounded shoulders.
  - A **five-spoke disc** (one extruded disc with five window cut-outs) over a dark barrel, so rotation is easy to see.
  - A fixed brake caliper.
  - A speed-blur disc that fades in above about 16 rad/s, so fast wheels read as spinning rather than strobing.
  - A thin **TPMS ring** on the outer sidewall.

| Car | Body | Size (L × W, tyre radius) | Distinguishing build |
|---|---|---|---|
| Fronx | Compact crossover | 4.00 × 1.76 m, r 0.33 m | High sill, sloping hatch roof, black arch cladding and sill strip, roof rails |
| Corolla | Sedan | 4.63 × 1.78 m, r 0.32 m | Three-box: long hood, cabin, separate boot deck |
| Veyron | Low two-door supercar | 4.46 × 1.99 m, r 0.36 m | Very low, wide; raised front-wheel fender line, teardrop cabin set back, one long side window, rear wing |
| Omni | Tall boxy van | 3.37 × 1.40 m, r 0.27 m | One-box, near-vertical nose, tall glasshouse with two pillars, small 12-inch-class wheels |
| Roadster | Small open-top two-seater | 3.95 × 1.85 m, r 0.31 m | No roof: dark cockpit, two seats with headrests and hoops, framed windscreen; green EV plate |
| Console cars | Hatchback | 3.85 × 1.73 m, r 0.31 m | Two-box with a short tail and roof spoiler |

The tyre radius comes from the body type and drives the wheel speed (§4).

## 4. Data bindings

Everything moves from the telemetry and nothing is invented. Packets arrive at 1 Hz (simulated cars) or 5 Hz (console cars), so each value is interpolated linearly from the value on screen to the new packet value. The interpolation runs over that car's own measured packet interval (median of the last 7, clamped to 120–1600 ms). Values never jump, and they lag by at most one interval.

| On screen | From | How |
|---|---|---|
| Wheel spin | `vehicle.speed_kmh` | ω = (v / 3.6) / r with the body's tyre radius. A null speed means stopped, and the readout says "No reading". |
| Road scroll, roadside posts | `speed_kmh` | Distance += v·dt. The lane markings (3 m dash every 9 m) and kerb blocks scroll under the car, which stays centred. |
| Compass rose | `gps.heading_deg` | Interpolated on the shortest arc. The rose turns so N points at true north relative to the car. |
| Front-wheel steer | Rate of change of `heading_deg` | Bicycle model, δ = atan(wheelbase × yaw rate / v), clamped to ±30° and smoothed (τ 0.28 s). Zero below 1.5 m/s. |
| Body pitch | Change in `speed_kmh` between packets | Target 0.42° per m/s², clamped to −2.2°…+1.5°: the nose squats up under acceleration and dives under braking. A spring-damper adds one soft settle. |
| Body roll | Speed × yaw rate (lateral acceleration) | Target 0.45° per m/s² away from the turn, clamped to ±2.2°. Same spring. |
| Brake lights | `vehicle.brake` | `true` = bright (emissive 2.6) plus a red spill on the road. `false` = tail lamps dim (0.32). `null` = **unlit**, and the readout says **Brake: Unknown (not found on CAN bus)** (or "(no reading)" when the provenance is not *not_supported*). |
| TPMS rings | `tyres.*` | Green normally. **Amber** below 200 kPa or above 80 °C. **Red** below 180 kPa or above 90 °C (the fleet's critical alert limits). **Grey** with "TPMS not fitted" when the car has no TPMS reading. Hovering a tyre or ring shows its pressure, temperature and state in words. |
| Stale / offline | Packet age (3 s / 10 s, as on the fleet) | The paint fades towards grey (70 % stale, 100 % offline). The wheels coast to a stop (τ 0.7 s), and pitch, roll and steer return to zero. Values resume from the coasted speed when packets return. |
| Readout | Packet fields | Shows name, plate, data-mode tag, body type, status, speed (254+ at the OBD limit), RPM or motor rpm, gear (N, R, or "N/A (EV)"), throttle or accelerator, heading, brake (three states), tyres, time since the last packet, and provenance. Nulls use the fleet's words ("Not supported", "No reading"), never 0. |
| Pedal bars (console cars) | `driver.*_pedal_pct` | Throttle (good tint), brake (critical tint), clutch (slot-1 tint), as in Level 2. |

**Camera:**
- OrbitControls: drag to orbit, scroll to zoom. Pan is off so the car stays centred.
- The polar angle is clamped above the road, and the distance is clamped to the car's size.
- Presets fly over 750 ms with an ease-out: **C** Chase, **S** Side, **T** Top, **R** reset (a three-quarter front view).
- A slow **auto-orbit** starts after 6 s idle when the car is stopped. It holds still while the pointer is over the view, so labels and buttons stay clickable.
- **X** toggles the hardware X-ray.
- On /3d/, keys **1–9** pick a car.

**Performance and hardening:**
- devicePixelRatio is capped at 2.
- Rendering stops while the tab is hidden.
- An adaptive step runs after 3 s below 40 fps: first pixel ratio 1, then no shadow map.
- `dispose()` frees the geometries, materials, textures, environment map and controls, then calls `renderer.dispose()` and `forceContextLoss()`.
- `prefers-reduced-motion` stops the auto-orbit and makes the camera presets jump instead of fly.
- Below 760 px the readout becomes a top strip and the header is shortened.

**Tests:** `window.__view3d` is a frozen object of read-only getters: speed, packet speed, wheel ω, tyre radius, brake-light state, tail emissive, rings, pitch, roll, steer, fps, frames, X-ray, grey, quality, draw calls and memory. `window.__view3dRegistry` counts created, disposed and live renderers.

## 5. Hardware X-ray (Tier 3)

**X**, or **Show our hardware**, turns the body, glass and trim see-through (opacity 0.08–0.5) and shows a schematic of our kit:

- A translucent dashboard and the steering wheel on the right, since Indian cars are right-hand drive.
- The **OBD-II port** under the dashboard on the driver's side, with the **ELM327** plugged in.
- A dashed **Bluetooth link** from the ELM327 to the **Raspberry Pi 4** on the dashboard.
- The **NEO-6M GPS antenna** under the windscreen.
- A dashed path **out of the car to the backend**.

A pulse runs ELM327 → Pi → out for every packet the page receives. The kit is drawn 1.6× life size so it is visible on a projector. A note says "Illustrative placement, kit drawn larger than life".

Each label is a link to the matching /flow/ stage for this car:

| Label | Opens |
|---|---|
| OBD-II port | `/flow/#car=<id>&stage=port` (stage 2) |
| ELM327 adapter | `stage=elm` (stage 3) |
| Raspberry Pi 4 | `stage=decode` (stage 4) |
| NEO-6M GPS antenna | `stage=gps` (the GPS branch) |
| To the backend | `stage=backend` (stage 7) |

In the embedded view the labels are shortened (name + "Stage n"). The readout strip and the note step aside so the labels fit in the panel.

## 6. Verification

**New suite: `demo/tests/verify_level3.py`, 51/51 checks passed.** Chromium runs headless with WebGL through ANGLE on Direct3D 11 on the real GPU (`--gl gpu`, the default). `--gl swiftshader` uses the CPU rasteriser.

**/3d/ page:**
- Loads with no console errors and a non-empty canvas (2,352 distinct colours).
- `#car=` deep links work.
- **Every fleet car can be selected and gets its body:** fronx = crossover, corolla = sedan, veyron = supercar, omni = van, roadster = roadster.

**Motion:**
- **Wheel ω × r = displayed speed (0.00 % error over 40 samples).** This holds by construction. The real check is the next one.
- **The displayed speed always lies between the last two packet speeds.** The largest frame-to-frame step was 0.02 km/h.
- Pitch and roll stay within limits: max pitch 0.14° in the sampled 2 s, while the Corolla was cruising straight, so roll was 0.
- A stopped car (Fronx, recorded, 0 km/h) has ω = 0.000.

**Brake and tyre states:**
- **Fronx brake null:** "Brake: Unknown (not found on CAN bus)", lights unlit (emissive 0), grey rings and "TPMS not fitted". **Omni:** also unknown and unlit.
- **Corolla brake true → lights on** (emissive 2.57). Brake false → dim, not off.
- **Corolla puncture scenario → FL ring red** after 16.8 s, at 179.3 kPa. The other rings stay green, and the readout's FL chip gets the critical icon.
- Hovering a tyre shows its label. A car without TPMS says "TPMS not fitted".

**Camera, X-ray and theme:**
- Keys C/S/T/R and the preset buttons work. Dragging down cannot take the camera under the road (it stayed at y 1.04). An idle car auto-orbits.
- X-ray shows the 5 labels with the right /flow/ links. Pulses run on packets. Ctrl+clicking the ELM327 label opens /flow/ at stage `elm` for the Fronx.
- The **theme toggle** re-colours the scene (background `#eceff1` ↔ `#0e1317`) and back.

**Stale car:**
- Taken offline (presenter "Go offline"), the Veyron greys out (0.70) and its wheels coast from 208 to 0.15 km/h.
- The readout says **Stale**, and the colour and wheels return with the packets.

**Rendering:**
- **Frame rate at 1920×1080: 60.0 fps.** That is the display's vsync cap, measured over 5 s at full quality (pixel ratio 1, shadows on) on the review laptop's NVIDIA GeForce RTX 3060 Laptop GPU (ANGLE D3D11).
  - In a separate probe with Chromium's new headless mode it rendered 165 fps (that screen's refresh rate).
  - **SwiftShader (CPU, no GPU) manages only 2.0 fps** even after adapting down to quality level 0. It is a software fallback, not representative of a laptop GPU.
- Rendering pauses while the tab is hidden: 0 frames hidden, 25 frames in 0.4 s after.

**Console car:**
- A console car that connects after load appears in the picker at once. It is a hatchback with the Live tag and pedal bars.
- **Its wheels respond to the throttle in 0.31 s.** The pedal bar follows (95 %), and the console brake turns the brake lights on.
- When it leaves, its button goes and the view says "Live Demo Car left the fleet".

**Embedded view:**
- The car view is unchanged until clicked: gauges shown, **0** /3d/ requests.
- The click lazy-loads three.js (5 files) and swaps the gauges for the canvas.
- **Closing releases the WebGL resources:** registry created 1 / disposed 1 / live 0, `__view3d` null, canvas removed, gauges back.
- Opening and closing 3 more times gives 4 / 4 / 0, so no leaked contexts.
- An open view follows a switch to another car. Leaving the car view disposes it (5 / 5 / 0).
- No console errors.

**No WebGL** (`--disable-webgl --disable-3d-apis`):
- /3d/ shows "3D needs WebGL, which is turned off or unsupported in this browser."
- The embedded toggle shows a message strip, and the gauges keep updating.

**Existing suites, all re-run on this branch:**

| Suite | Result |
|---|---|
| `python backend/tests/dry_run.py` | ALL 74 CHECKS PASSED |
| `python backend/tests/dry_run.py --stream` (port 8000 free) | ALL 83 CHECKS PASSED |
| `python backend/tpms_codec.py`, `python backend/obd_decoder.py` | ALL TESTS PASSED (both) |
| `python demo/obd-flow/build_snippets.py --check` | OK, 22 snippets, all highlights match |
| `python demo/tests/test_flow_roundtrip.py` | PASS |
| `python demo/tests/verify_dashboard.py` (Level 1) | 54/54 = 27/27 live + 27/27 standalone |
| `python demo/tests/verify_level2.py` | 60/60 (run with `--shots` to a scratch folder so the QR checks ran and the committed Level 2 images stayed unchanged) |
| `python demo/tests/verify_flow.py` | 27/27 |

## 7. Impeccable audit and polish

**Process:**
- Impeccable was used with frontend-design and webapp-testing.
- The surface is **Operate mode**. It extends the established fleet world (DESIGN.md "The Wire Under Glass", shared `app.css` tokens) with no new identity.
- You asked for an unattended run with no questions, so the direction came from the brief and the existing world rather than an interview.
- The detector ran over `index.html`, `view3d.css`, `view3d.js`, `page.js` and `embed3d.js`.

**Detector: 0 warnings, 19 advisories.**
- **3 colour advisories, all accepted or false positives:**
  - `#5f6d79` is the fleet's own car-glyph fallback colour.
  - `rgb(0,0,0)` on the brand text is a false positive: the detector cannot resolve `../fleet/css/app.css` from disk, so it misses the shell's white ink.
- **16 font-size advisories:**
  - Two stray sizes were snapped to the scale: 0.9 → 0.93rem, and 1.15 → 1.25rem (the numeric token).
  - Two sub-floor sizes (0.78 and 0.8rem) were raised to the **0.82rem projector floor**.
  - The rest are deliberate: 0.86, 0.93 and 0.82rem are the projector sizes already used across the fleet, 3.1, 2.2 and 2.1rem are the display-size speed readouts DESIGN.md allows for driving readouts, the 1.2rem readout title was kept, and 15px is the projector root size, as on /flow/.

**Audit**, scored after the fixes:

| # | Dimension | Score | Finding and fix |
|---|---|---|---|
| 1 | Accessibility | 3 | **Keyboard:** all controls are real buttons and links with visible focus rings, plus C/S/T/R/X and 1–9 shortcuts. **Words, not just colour:** state is never colour alone (Brake pill + words; tyre chips + critical/warning icons; the hover label states "Normal / Watch / Alert" in words). **Canvas:** has `role="img"` and a per-car `aria-label`. **Readout:** not a live region, so screen readers are not flooded at 5 Hz. **Fixed:** reduced-motion support (no auto-orbit; presets jump). **Fixed:** the key hint lost contrast over white road markings, so it now sits on a surface backing. |
| 2 | Performance | 4 | **Measured:** 60 fps (vsync) at 1080p with shadows. About 63–76 draw calls and 31–36k triangles per car before the detail pass (mirrors, door lines and lips add a few dozen small meshes). **Loading:** three.js is lazy in the car view. **Runtime:** stops when hidden, adapts quality, and disposes everything (verified with the registry). |
| 3 | Theming | 4 | **Scene:** background, ground, road, kerbs, rose, lights and environment intensity follow the theme. **Colours:** car paint and ring colours come from the fleet tokens. **Overlays:** share the fleet surfaces. **Theme changes:** picked up live through a MutationObserver on `data-theme`. |
| 4 | Responsive | 3 | **Sizes checked:** 1920×1080, 1366×768 and 390×844, with no horizontal scroll. **Fixed:** below 760 px the readout becomes a strip and the header is shortened (it overlapped at 390 px). **Fixed:** the embedded view clipped the car's nose and placed the readout over the car, so a projection view-offset now frames the car right-of-centre. **Fixed:** the embedded X-ray at 1366 was crowded, so the labels were shortened and the readout steps aside. |
| 5 | Implementation integrity | 4 | **One module** serves both entry points. **No copying:** it reuses the fleet's state, link, codec, provenance words, pills, tags and plates rather than copying them. **Telemetry only:** everything shown is bound to telemetry. **Code layout:** the maths sits in a pure `motion.js`. |
| | **Total** | **18/20 (Excellent)** | |

**Polish from looking at the screenshots:**
- **Road:** washed into the ground in light theme, so the road and ground colours and the lighting were retuned.
- **Compass letters:** too heavy and upside-down from the camera. They are now lighter and face the centre, so they read upright from outside the ring.
- **Too toy-like:** mirrors, door shut lines and handles, a grille and bumper lips were added.
- **Veyron's side "intake" box:** looked like a sticker, so it was removed.
- **Centre stop lamp:** poked above the Veyron's roof. It is now inside the top of the rear glass, and not fitted on the supercar.
- **Arch gaps:** looked too big, so they were tightened (8.8 cm radius over the tyre, about 4 cm visible).
- **X-ray labels:** could run off the top edge and under the note. They are now clamped inside the view using each label's measured size, and the note moved to the bottom-left in place of the key hint.
- **X-ray dashboard:** read as a heavy block, so it is now lighter and smaller.
- **"Left the fleet" message:** kept the waiting copy ("appears as soon as its first packet arrives"). It now says "Its Control Console disconnected. Pick another car."

## 8. Screenshots (`demo/screenshots/level3/`, 45 files)

These were taken by `verify_level3.py --shots` on the real GPU, in **light and dark** at **1920×1080 and 1366×768** (`<theme>_<size>`):
- `3d_corolla_chase_*`, `3d_corolla_side_*`: the Corolla, Chase and Side presets.
- `3d_veyron_side_*`: the Veyron at speed, with blurred wheels.
- `3d_roadster_hero_*`: the Roadster, open top and green EV plate.
- `3d_omni_side_*`: the Omni, with Brake Unknown and TPMS not fitted.
- `3d_fronx_hero_*`: the Fronx, recorded.
- `3d_xray_fronx_*`, `3d_xray_corolla_*`: the hardware X-ray.
- `embedded_corolla_*`, `embedded_xray_*`: the 3D view inside the fleet car view.
- `3d_console_chase_{light,dark}_1920x1080.png`, `3d_console_side_{light,dark}_1920x1080.png`: a console car driven from /drive/ with the throttle held, so the pedal bars are visible.
- `3d_corolla_puncture_side_light_1920x1080.png`: the puncture with FL red in the readout.

## 9. Push

**Checks before pushing:**
- `git status`: clean.
- `git diff --name-only origin/demo/fleet-dashboard..HEAD | grep -iE "pdf|_private|\.db$|\.csv$"`: **none**. This branch adds no PDF, nothing from `demo/_private/`, and no database or session CSV.
- `git check-ignore` confirms `demo/_private/Shahid Final.pdf` is ignored (`.gitignore:19`). The 14 team PDFs under `Internship/PDF/` noted in REPORT 3 are unchanged and were already on `origin/main`.

**The push:**
- `git push -u origin demo/level3-3d`: **succeeded**, `* [new branch] demo/level3-3d -> demo/level3-3d`. No force, and nothing to `main` or `demo/fleet-dashboard`.
- Branch: https://github.com/IoT-Internship-CarAutomation-LUS/Car-Automation/tree/demo/level3-3d
- Commits: `bb8e948` (Level 3 view), `3c1d923` (polish, screenshots, run sheet, CLAUDE.md). This report was then added in one more commit and pushed the same way; the branch head on GitHub is that commit.
- GitHub offers a pull-request link. No PR was opened.

## 10. Known issues

1. **SwiftShader is slow.** Headless Chromium without a GPU renders about 2 fps. On the review laptop's GPU it is 60 fps. A laptop with WebGL switched off gets the clear message instead.
2. **The memory-pressure stop.** During this run, Claude Code stopped the demo server once because the laptop was critically low on memory. It was restarted when you said so, and every suite was re-run afterwards. The killed backend left a `telemetry.db-journal`, which the backend consumed on restart. Nothing from it was committed.
3. **Steering and roll are derived, not measured.** They come from the heading change between packets. At 1 Hz this is coarse, and on straight GPS segments roll is simply 0, as in the sampled check. The values are clamped and smoothed so they stay believable, never cartoonish.
4. **The FL ring is on the car's left side,** so it is not visible from the **Side** preset (right side). Use the default or Chase view when showing the puncture. The readout's FL chip turns red either way.
5. **Presenter scenarios persist across test suites.** A suite that leaves "Corolla puncture" on affects later suites. `verify_level3.py` now sends `reset_all` first.
6. **The embedded view needs the backend.** From `file://` (fleet standalone opened from disk) the button explains that the 3D view needs `python demo/run_demo.py`, and the gauges keep working.
7. **Older screenshots don't show the new links.** The Level 1, Level 2 and /flow/ screenshots predate the **3D** header link and the **3D view** button.

## 11. Choices I made

1. **Branch:** `demo/level3-3d` from `demo/fleet-dashboard` at `1d91e79`, after checking it was clean and equal to origin. I pushed only this branch.
2. **three.js r186**, the version the installed three.js skills target, from npm. Minified locally with esbuild (no `.min` builds ship in r186). The licence is kept.
3. **Addons bundled beyond OrbitControls:** `RoundedBoxGeometry` (soft edges) and `RoomEnvironment` (reflections without texture files). Their `from 'three'` import was rewritten to a relative path, so the module also loads inside the classic-script fleet page without an import map.
4. **WebGLRenderer, not WebGPU**, for the widest laptop support. NeutralToneMapping keeps the identity colours close to the fleet's.
5. **Bodies:** extruded side profiles with bevels and separate glass panels, sized for the class. The Veyron's identity is "low, wide, fender line, wing", and no real design cue is copied.
6. **Driver's side = right (+z).** Indian cars are right-hand drive, so the OBD port and steering wheel sit on the right. **The car keeps the left lane**, with the centre line on its right.
7. **Interpolation:** linear across the measured packet interval, rather than extrapolation, so the screen never shows a value the car has not sent. The cost is up to one interval of lag (0.2 s on console cars; measured wheel response 0.31 s).
8. **Brake "dim" for `false`:** tail lamps glow faintly, like a car with its lights on. Only `null` is fully unlit, so unknown never looks like off.
9. **TPMS amber band (below 200 kPa or above 80 °C)** is new to the 3D view as an early warning. Red uses exactly the fleet's critical limits. Words, not colour alone, carry the state.
10. **Stale coast-down:** exponential with τ 0.7 s, so a fast car visibly stops within a few seconds. Stale greys to 70 %, offline to 100 %.
11. **Auto-orbit holds while the pointer is over the view.** Otherwise the X-ray labels cannot be clicked on an idle car (the first test run caught this).
12. **The X-ray kit is drawn 1.6× life size** and labelled as illustrative, because at true size a Pi is about 15 px on a projector.
13. **X-ray targets:** the ELM327 label opens stage `elm` (3). The OBD-II port opens `port` (2), the Pi opens `decode` (4), the antenna opens the `gps` branch, and the exit opens `backend` (7).
14. **Embedded layout:**
    - A projection view-offset frames the car right of the readout strip.
    - In X-ray the strip hides, because the car view already shows every number.
    - Keys work only while the 3D view is open.
15. **Picker:** a row of buttons, not a `<select>`, so it reads on a projector. Number keys 1–9 pick a car, and console cars get a **Live** tag.
16. **Frame-rate test path:** ANGLE on Direct3D 11 in headless Chromium, which uses the real GPU. SwiftShader (the brief's example flag) is also measured and reported. The adaptive quality step is visible in `__view3d.quality`.
17. **Debug object:** a frozen getter object (`window.__view3d`) plus `window.__view3dRegistry` for the context-release checks. Neither exposes setters.
18. **Run sheet placement:** Level 3 is optional, as a 30 s closer after live driving (4:00), or during it with the console car selected. X-ray then links back into /flow/.
19. **No questions were asked**, as instructed. The one pause, waiting for your go-ahead to restart the server after the memory-pressure stop, is noted in §10.
