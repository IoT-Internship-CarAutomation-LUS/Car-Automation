---
version: 1
slug: "demo-driver-console"
primary_target: "demo/driver-console"
related_targets: []
---

# Driver console (demo/driver-console, served at /drive/)

Mode: Operate. Audience: a student or examiner holding a phone or a second laptop during the review, plus the examiners watching the fleet screen react.
Job: connect as a live car in two taps, then drive with pedals, a gear lever and an emergency stop while the fleet dashboard follows.
Constraints: same design system as the fleet dashboard (DESIGN.md, shared app.css, codec.js, ui.js, light/dark toggle); vanilla JS; works on a phone in portrait and landscape with touch, and on a laptop with keyboard keys.
Build path: code-led (Operate surface; no image generation). Extends the established world; no new identity.

## Direction contract

THESIS: The old Control Console reborn as a driving surface: three tall pedals you press with a thumb, a lever, a big red stop, and a status strip that always says what the car is doing. It refuses the game-HUD look of glowing dials and dark chrome.

OWN-WORLD: The fleet world unchanged: road-sign green shell over cool grey, white panels, Archivo words, Red Hat Mono numbers. Pedals are flat tinted tracks (green throttle, red brake, slot-1 blue clutch) with a ribbed knob; the e-stop uses the critical red; the packet strip uses the shared field-group slots and hatch.

STORY: Pick a car, Connect, turn the ignition on, choose a gear and press the throttle. The banner confirms every state in words. The fleet dashboard shows the car joining, its numbers moving, and an alert when the e-stop is pressed.

FIRST VIEWPORT: Shell header with the title "Control Console - Driver Simulator", link state and theme toggle; full-width status banner with the sending dot; then the setup card (car, plate, powertrain, WebSocket, Connect). Once connected: instruments on the left (speed, gear, rpm bar with limiter, coolant, fuel, battery) above the live packet strip; controls on the right (ignition, horn, e-stop, gear lever, three pedals). On a phone: instruments, then controls, then the wire.

FORM: extension of the established fleet world, brief-pinned. seed: none (pinned): "the old Control Console reborn as a driver console ... big clear controls, status banner, emergency stop, feed-freshness dot".

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
