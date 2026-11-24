---
name: Car Automation - Fleet Telemetry
description: A fleet console where the 32-byte packet on the wire is part of the interface.
colors:
  ground: "#eceff1"
  surface: "#ffffff"
  surface-2: "#f4f6f7"
  surface-3: "#e7ebee"
  ink: "#13202a"
  ink-2: "#41505c"
  ink-3: "#56636e"
  line: "#d5dbe0"
  line-strong: "#b4bec7"
  shell: "#0c5a43"
  shell-2: "#0a4c39"
  shell-ink: "#ffffff"
  shell-ink-2: "#c8e3d8"
  accent: "#0c6b4f"
  accent-soft: "#dcefe7"
  focus: "#1a8c69"
  good: "#0ca30c"
  good-ink: "#0a6f0a"
  good-soft: "#e1f3e1"
  warning: "#fab219"
  warning-ink: "#7d5300"
  warning-soft: "#fdf1d6"
  serious: "#ec835a"
  serious-ink: "#a8431b"
  serious-soft: "#fbe7de"
  critical: "#d03b3b"
  critical-ink: "#b02626"
  critical-soft: "#f8e0e0"
  muted-state: "#8a96a0"
  s0: "#56636e"
  s1: "#2a78d6"
  s2: "#eb6834"
  s3: "#1baf7a"
  s4: "#eda100"
  s5: "#e87ba4"
  s6: "#008300"
  s7: "#6250d6"
typography:
  headline:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "1.45rem"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "1.07rem"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "0.86rem"
    fontWeight: 400
    lineHeight: 1.4
  numeric-display:
    fontFamily: "Red Hat Mono, ui-monospace, Cascadia Mono, Consolas, monospace"
    fontSize: "1.6rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "0em"
    fontFeature: "tnum"
  numeric:
    fontFamily: "Red Hat Mono, ui-monospace, Cascadia Mono, Consolas, monospace"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0em"
    fontFeature: "tnum"
  byte:
    fontFamily: "Red Hat Mono, ui-monospace, Cascadia Mono, Consolas, monospace"
    fontSize: "0.86rem"
    fontWeight: 500
    lineHeight: 1.4
    fontFeature: "tnum"
rounded:
  xs: "6px"
  sm: "8px"
  md: "12px"
  pill: "999px"
spacing:
  gap: "0.75rem"
  tile-gap: "0.45rem"
  panel: "0.8rem 1rem 1rem"
  tile: "0.5rem 0.6rem"
components:
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0.8rem 1rem 1rem"
  field-tile:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 0.6rem"
  field-tile-alert:
    backgroundColor: "{colors.critical-soft}"
    textColor: "{colors.critical-ink}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "2.2rem"
    padding: "0 0.75rem 0 0.55rem"
  button-secondary-hover:
    backgroundColor: "{colors.surface-2}"
  button-presenter:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "2.4rem"
    padding: "0.35rem 0.75rem"
  button-presenter-hover:
    backgroundColor: "{colors.surface-3}"
  button-shell:
    backgroundColor: "{colors.shell}"
    textColor: "{colors.shell-ink}"
    rounded: "{rounded.sm}"
    height: "2.1rem"
    padding: "0 0.7rem"
  pill-on:
    backgroundColor: "{colors.good-soft}"
    textColor: "{colors.good-ink}"
    rounded: "{rounded.pill}"
    typography: "{typography.byte}"
    height: "1.6rem"
    padding: "0 0.6rem"
  pill-off:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    typography: "{typography.byte}"
    height: "1.6rem"
    padding: "0 0.6rem"
  pill-unknown:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.ink-3}"
    rounded: "{rounded.pill}"
    typography: "{typography.byte}"
    height: "1.6rem"
    padding: "0 0.6rem"
  pill-na:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-3}"
    rounded: "{rounded.pill}"
    typography: "{typography.label}"
    height: "1.6rem"
    padding: "0 0.6rem"
  vehicle-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    padding: "0.55rem 0.9rem 0.6rem 0.8rem"
  vehicle-row-hover:
    backgroundColor: "{colors.surface-2}"
  vehicle-row-selected:
    backgroundColor: "{colors.accent-soft}"
  tag:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.xs}"
    height: "1.35rem"
    padding: "0 0.45rem"
  tag-recorded:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
  tag-live:
    backgroundColor: "{colors.good-soft}"
    textColor: "{colors.good-ink}"
  alert-badge-warning:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning-ink}"
    height: "1.35rem"
    padding: "0 0.4rem"
  alert-badge-serious:
    backgroundColor: "{colors.serious-soft}"
    textColor: "{colors.serious-ink}"
    height: "1.35rem"
    padding: "0 0.4rem"
  alert-badge-critical:
    backgroundColor: "{colors.critical-soft}"
    textColor: "{colors.critical-ink}"
    height: "1.35rem"
    padding: "0 0.4rem"
  byte-cell:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.byte}"
    height: "2rem"
  byte-cell-sentinel:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-3}"
  byte-cell-crc:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.ink}"
---

# Design System: Car Automation - Fleet Telemetry

## Overview

**Creative North Star: "The Wire Under Glass"**

A fleet console that puts the car's 32-byte packet on screen and colours every byte by the field it carries, so the pipeline can be checked live rather than taken on trust. A road-sign green roof sits over a cool grey ground and plain white work surfaces; everything readable at projector distance comes before anything dense. Data honesty is the visual subject: measured, simulated, derived, not supported and unknown each have their own mark, and a missing byte is hatched rather than coloured or zeroed.

The register is a working instrument in a lit seminar room, not a "command centre". Surfaces are flat white cards with a soft ambient lift, corners are gently rounded, and colour is spent on information: eight categorical slots for packet field groups and car identities, four status hues for alerts, and one green for the shell and for measured data. The light theme is the default; the dark theme is a full token remap, not an inversion.

The system explicitly rejects the dark glowing-tile command centre: no neon, no glow, no gradients on data surfaces.

**Key Characteristics:**
- Highway-sign green shell over cool grey ground and white surfaces.
- Archivo for words, Red Hat Mono (tabular) for every number, byte and hex value.
- Packet ribbon on every vehicle row, expanded to a labelled byte strip in the car view.
- Hatch texture is the single visual for "no value on the wire".
- Every value carries a provenance mark; every status colour carries an icon or word.
- Flat surfaces with one soft ambient shadow; 12px containers, 8px inner elements.

## Colors

A cool, low-chroma neutral field with one institutional green and a disciplined categorical palette that only ever means "which field" or "which car".

### Primary
- **Highway-Sign Green** (shell, `#0c5a43`): the sticky header band, and the ink of the standalone badge. It is the roof of the app and appears nowhere else at full strength. Its darker step **Sign Green Edge** (shell-2) is the header's bottom rule.
- **Measured Green** (accent): the colour of truth. Measured provenance marks, the recorded-data tag, presenter confirmations and text selection. **Measured Green Wash** (accent-soft) backs the recorded tag and tints the selected vehicle row.
- **Focus Green** (focus): the 2px focus outline everywhere (white on the shell).

### Secondary: Status
Each status has a signal hue (dots, gauge limits, borders), an `-ink` variant for text on light surfaces, and a `-soft` wash for badge and tile backgrounds.
- **Signal Green** (good / good-ink / good-soft): moving (solid dot), idle (hollow 2px ring: on, not moving), live link, ON pill, freshness dots, EV state of charge.
- **Amber Caution** (warning / -ink / -soft): stale data, warning alerts, the OBD-limit note, the new-alert flash.
- **Burnt Orange** (serious / -ink / -soft): serious alerts.
- **Brake Red** (critical / -ink / -soft): critical alerts, offline, CRC failure, alerted tiles (wash, red label, critical icon) and tyres, gauge red zones.
- **Slate State** (muted-state): stale freshness dots and the default status dot.

### Tertiary: Categorical Series Slots
Eight slots, s0 to s7, used only for packet field groups and car identities (car glyph, map trail, route line, ribbon and byte cells, byte-label underline, legend swatch, and the linked-byte ring). Each has a separate dark-theme value.
- **Neutral Slot** (s0): CRC byte group, and the fallback identity.
- **Route Blue** (s1): engine bytes and tyre pressure; the Fronx; the RPM gauge and trend.
- **Signal Orange** (s2): speed and gear; the Veyron; the speed gauge and trend.
- **Jade** (s3): GPS; the Corolla.
- **Marigold** (s4): temperatures and tyre temperature; the Omni.
- **Rose** (s5): fuel, battery, MIL; a spare identity for a joining car.
- **Field Green** (s6): CAN body and device; a spare identity.
- **Violet** (s7): frame and time; the Roadster.

### Neutral
- **Cool Ground** (ground): the page behind every card.
- **Paper White** (surface): cards, panels, columns, the KPI strip, off pills.
- **Mist** (surface-2): field tiles, tri-state cells, tyre cells, hover states, map backdrop.
- **Fog** (surface-3): unknown pills, CRC bytes, empty ribbon cells, gauge tracks; the base under the hatch.
- **Deep Slate Ink** (ink): primary text and values. **Slate Ink** (ink-2): labels and secondary text. **Muted Slate** (ink-3): units, timestamps, null text, provenance text.
- **Hairline** (line) and **Strong Hairline** (line-strong): dividers, card borders, ticks; the strong step for hover and off/unknown pill borders.

### Named Rules
**The Slot Discipline Rule.** Series slots s0 to s7 mean "which field group" or "which car" and nothing else. A slot is never used to signal good or bad, and a status colour is never used as an identity.

**The Hatch Means Absent Rule.** A sentinel byte, a not-supported field or a not-applicable field is drawn with the hatch (135deg, 1px ink-3 stripe at 38% every 4px) over Fog. Never a series colour, never zero, never blank.

**The Green Roof Rule.** Full-strength shell green belongs to the header band only. Elsewhere green is either Measured Green (provenance) or Signal Green (status), and those two never trade places.

## Typography

**Display Font:** Archivo (with Segoe UI, system-ui)
**Body Font:** Archivo (with Segoe UI, system-ui)
**Label/Mono Font:** Red Hat Mono (with ui-monospace, Cascadia Mono, Consolas)

**Character:** A sturdy grotesque at weight 650 for names and headings, paired with a calm, slightly technical mono for every number, so values line up and read as data, not prose. Both fonts are self-hosted variable woff2. The root is 14px, rising to 16px at 1700px wide, so the whole ramp scales for the projector.

### Hierarchy
- **Headline** (650, 1.45rem, -0.01em): the car name in the car-view header.
- **Title** (650, 1.07rem, -0.01em): panel, column and presenter headings; the brand name.
- **Body** (400, 1rem, 1.4): vehicle names (at 650), messages, empty-state text.
- **Label** (400 to 600, 0.82 to 0.93rem): field labels, KPI labels, status words, alert messages, provenance words (0.86rem), byte-strip field labels (0.82rem at 1700px and wider, 0.76rem below so each label stays centred under its byte at 1366); tags at 0.8rem/550.
- **Numeric Display** (mono 600, 1.6rem, 1.1): KPI values; card speed at 1.35rem; gauge readouts in the SVG.
- **Numeric** (mono 600, 1.25rem, 1.2): field-tile values, tyre pressures, gear. Units beside a value are words: Archivo 500 at 0.86rem in Muted Slate.
- **Byte** (mono 500, 0.86rem): hex cells in the packet strip, tri-state pill words (at 650), plates.

### Named Rules
**The Mono For Every Number Rule.** Any number, byte, hex value, plate or timestamp is set in Red Hat Mono with tabular figures and zero tracking. Words, including the unit beside a number, are set in Archivo; the one exception is the ON / OFF / UNKNOWN pill value, which is a wire state.

**The Unknown Is Quieter Rule.** A null value drops out of mono into Archivo at 500, body size, in Muted Slate, with words ("Not supported", "No reading"), so it can never be mistaken for a measured zero.

**The Projector Floor Rule.** No reading text below 0.82rem (11px inside SVG gauges). Provenance words sit at 0.86rem; byte-strip labels at 0.82rem on the projector (0.76rem below 1700px, the one deliberate exception, because the 32 labels must stay under their bytes); gauge tick labels at 11px, gauge readout 25px.

## Layout

A fixed-height application frame: a 3.6rem sticky shell, then the fleet view fills the remaining viewport height with a 0.75rem gap on every side and between every block. Fleet view: a KPI strip of five equal cells divided by hairlines, then three columns (the vehicle list at 19.5rem, map filling the centre, alert feed at 19.5rem; 22rem at 1700px and up, 17rem below 1180px). Each column scrolls internally; the page does not.

The car view is a header card, a full-width "On the wire" panel (32-byte strip at 2fr beside the 16-byte TPMS strip at 1fr), then a 34/38/28 three-stack grid of panels. Inside panels, tiles sit in 3-column grids with a 0.45rem gap. Below 1180px the car grid goes to two columns and the wire strips stack; below 860px everything is one column, the fleet frame becomes scrolling, the map takes 60vh and the 32-byte strip wraps to two rows of 16.

## Elevation & Depth

Flat with one soft ambient lift. Cards, columns, the KPI strip, the car header, the map legend and map car labels share a single two-layer shadow that separates white from the grey ground without suggesting interactivity. Hierarchy inside a card is carried by tonal steps (surface to Mist to Fog) and hairlines, not by more shadow. Only floating overlays get a heavier shadow.

### Shadow Vocabulary
- **Ambient card** (`box-shadow: 0 1px 2px rgba(19,32,42,0.06), 0 4px 14px rgba(19,32,42,0.05)`; dark `0 1px 2px rgba(0,0,0,0.3), 0 6px 18px rgba(0,0,0,0.25)`): every resting surface on the ground.
- **Floating overlay** (`box-shadow: 0 12px 36px rgba(0,0,0,0.22)`): the presenter panel only.
- **Tooltip** (`box-shadow: 0 6px 20px rgba(0,0,0,0.2)`): the inverted byte tooltip.

### Named Rules
**The One Lift Rule.** Resting surfaces use the ambient card shadow and nothing stronger. Depth inside a card is tonal. No glow, no coloured shadow, no hover lift on cards.

## Shapes

Gently rounded and consistent: 12px on every top-level container (cards, columns, panels, KPI strip, presenter panel), 8px on everything nested inside them (tiles, tri-state cells, tyre cells, buttons, map legend, tooltip, GPS mini-map). Small inline marks (tags, alert badges, map car labels, feed severity tiles) step down to 6px. List rows inside a column (vehicle rows, alert feed rows) are square and divided by hairlines; the column carries the radius. Fully round (999px) is reserved for pills, the demo and standalone badges, and the state-of-charge bar. Ribbon cells use a near-square 1.5px radius and byte cells 4px, so the packet reads as a strip of discrete bytes. Car identity is a top-down car silhouette filled with its series colour, never a dot or a brand logo. The registration plate keeps a real plate's shape: white with a dark rule, green for EVs.

## Components

### Buttons
Quiet, bordered and tonal; there is no filled primary button because the primary action is clicking a card or a map marker.
- **Shape:** gently rounded (8px).
- **Secondary (Back):** Paper White, hairline border, label weight 550, chevron icon; hover goes to Mist with the strong hairline.
- **Presenter scenario button:** Mist fill, hairline border, full-width, label left and Muted Slate hint right; hover to Fog, press nudges down 1px, disabled at 50% opacity.
- **Shell (theme toggle):** 10% white over the shell green with a 28% white border; hover 18% white; white focus ring.
- **Focus:** 2px Focus Green outline, 2px offset, on every interactive element.

### Chips
- **Tag:** 6px radius, Mist fill, hairline border, Slate Ink text at 0.8rem/550; used for fuel type and "Simulated". The recorded variant is Measured Green on its wash; the live variant is Signal Green ink on its soft wash, both with a 45% colour border.
- **Alert badge:** soft status wash, status ink, an SVG severity icon plus the count or word.
- **Status:** a 0.55rem dot plus the state word (moving, idle, parked, stale, offline, waiting). Moving is a solid green dot, idle a 2px green ring, parked solid Muted Slate, stale amber, offline red with red text, waiting a dashed empty ring.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** Paper White on Cool Ground.
- **Shadow Strategy:** ambient card shadow only (see Elevation).
- **Border:** none on panels; hairline internal dividers under column heads and between feed rows and KPI cells.
- **Internal Padding:** 0.8rem 1rem 1rem; column heads 0.75rem 1rem 0.55rem.
- **Vehicle row:** a full-width button row inside the Vehicles column, no border or radius, divided from its neighbours by a hairline. Car glyph, name, plate, provenance tag, status, speed in Numeric Display (1.35rem, 1.6rem at 1700px), RPM, alert badges, and the mini packet ribbon with its note. Hover tints to Mist; the selected row tints to Measured Green Wash. Focus ring is inset 3px.
- **Field tile:** Mist cell at 8px holding label, Numeric value with unit, and a provenance mark. An alerted tile takes the Brake Red wash, a critical icon before its label, and critical ink on both label and value.

### Inputs / Fields
- **Select (presenter):** 8px radius, hairline border, Paper White, 2.4rem tall, inherits the UI font. Focus uses the global Focus Green ring.

### Navigation
- **Shell:** sticky 3.6rem green band. Left: brand mark and two-line name (title weight 650, subtitle in shell-ink-2). Right: demo-data badge (outlined pill), link state as a coloured dot plus words, a mono clock, and the theme toggle. Between views the only navigation is the Back button and clicking a card or marker. Below 860px the clock and link words hide; below 1180px the demo badge hides.

### Packet Ribbon (signature)
The wire made visible. On every vehicle row, a 0.6rem-tall strip (0.75rem at 1700px) of 32 cells (16 for TPMS), 1px gaps, 1.5px corners, each filled with its field group's series slot; sentinel bytes are hatched over Fog, the CRC byte is Slate Ink, and an empty packet is all Fog. In the car view it expands to the byte strip: 2rem mono hex cells tinted 20% of the slot over the surface with a 55% slot border, a 2px slot-coloured underline label under each field span, a legend of every group plus the hatch, and a CRC state line with an icon and word. Hovering a byte deepens its tint to 45% and shows an inverted tooltip (ink background, surface text) naming the field and its decoded value. Byte and tile are linked both ways: hovering either rings the bytes and the field tile with a 2px ring in the field group's slot colour. A failed CRC turns the CRC cell border and text Brake Red.

### Provenance Mark
A 0.45rem shape plus a word under every value. Measured: solid Measured Green square, green text. Simulated: hollow square. Derived: dotted circle. Not supported / not applicable: hatched square. No reading: dashed square. Words are 0.86rem Archivo, Muted Slate except for measured.

### Tri-State Pill
For brake, clutch and A/C. ON: Signal Green wash with green ink. OFF: Paper White with a strong hairline, ink text. UNKNOWN: Fog with a dashed strong hairline and Muted Slate text. These three are mono at 650 inside a 999px pill. N/A (for example on an EV) is a fourth, separate state: Mist with a solid strong hairline and Muted Slate text in Archivo 600, reading "N/A (EV)".

### Alert Feed
Rows with a 1.6rem severity icon tile on its soft wash, car name, mono timestamp, message and severity word. New rows flash an amber wash for 900ms; cleared rows fade to Muted Slate with a Mist icon tile.

### Fleet Map
Toned grayscale tiles sit quietly under the data. Each car is its slot-coloured silhouette, rotated to heading, with a white 6px-radius name label (red border when alerted, red text and 45% grayscale body when offline). Each car's planned route loop is a 3px dotted line (round dots, 30% opacity) in its slot colour; the live trail it has driven is a 6px solid line at 90%. Dotted means planned, solid means driven.

### Gauges
Open 270-degree arcs: Fog track, a 35% Brake Red band for the red zone, a round-capped fill in the metric's field-group slot (s1 RPM, s2 speed) that turns critical above the red line, 11px mono tick labels and a large mono readout. Fill moves on a 700ms ease-out curve.

## Do's and Don'ts

### Do:
- **Do** put the packet ribbon on every surface that represents a car, coloured by the field-group slot map (frame s7, engine s1, speed and gear s2, GPS s3, temperatures s4, fuel/battery/MIL s5, CAN body s6, CRC s0).
- **Do** give every value a provenance mark: measured, simulated, derived, not supported, not applicable or no reading.
- **Do** pair every status colour with an icon or a word (status dot plus word, alert badge plus icon, alerted tile plus critical icon, CRC state plus icon and text).
- **Do** use Red Hat Mono with tabular figures for every number, byte, plate and time.
- **Do** keep containers at 12px and nested elements at 8px, separated by the 0.75rem gap.
- **Do** remap every token for dark theme rather than inverting; series slots and status inks have their own dark values.

### Don't:
- **Don't** colour a sentinel or unsupported byte; hatch it over Fog.
- **Don't** render a null as 0, OFF or an empty cell; UNKNOWN gets the dashed pill, not-applicable gets the N/A pill, null values get words in Archivo.
- **Don't** use series slots for status, or status colours for car identity.
- **Don't** use shell green outside the header band.
- **Don't** add glow, neon, gradient fills or stronger shadows to data surfaces; this is not a dark command centre.
- **Don't** use car-brand logos; identity is the slot-coloured car silhouette, the name and the plate.
