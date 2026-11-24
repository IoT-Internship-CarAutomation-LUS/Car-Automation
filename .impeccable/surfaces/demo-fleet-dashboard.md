---
version: 1
slug: "demo-fleet-dashboard"
primary_target: "demo/fleet-dashboard"
related_targets: []
---

# Fleet dashboard (demo/fleet-dashboard)

Mode: Operate. Audience: internship review examiners watching a presenter on laptop and projector.
Job: watch five cars at once, open one, follow a value from the packet to the screen.
Constraints: vanilla HTML/CSS/JS, vendored Leaflet + uPlot, light default + dark toggle, 1366×768 and 1920×1080.
Build path: code-led (Operate surface; no image generation available).

## Direction contract

THESIS: The wire is part of the interface. A fleet console that shows each car's 32-byte packet as a coloured byte ribbon, so honesty about measured, simulated and missing data is visible at a glance. It refuses the generic dark "command centre" of glowing tiles.

OWN-WORLD: Indian road-sign green shell (header) over a cool grey ground and white work surfaces. Archivo for UI, Red Hat Mono for every number and hex byte. Validated categorical slots colour packet fields and car identities. Status colours (good, warning, serious, critical) always carry an icon and a word. Sentinel bytes are hatched, never coloured.

STORY: The visitor sees five cars on a Chennai map and understands one is real and four are simulated. They open a car, see every field labelled with its provenance, hover a byte to see which field it is, and watch alerts raised by presenter scenarios.

FIRST VIEWPORT: Green header (name, link state, demo-data badge, clock, theme). KPI strip. Three columns: vehicle cards, each with a mini packet ribbon (left, 300px), map with car icons and trails (centre, fill), alert feed (right, 300px). The primary action is clicking a card or marker.

FORM: brief-pinned layout. seed: none (pinned): "Left: vehicle cards ... Centre: big map with all cars and short trails. Right: live alert feed". Signature move: the packet ribbon (32 cells, field-coloured, hatched where the byte is a sentinel) on every card, expanded to a labelled byte strip in the car view.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
