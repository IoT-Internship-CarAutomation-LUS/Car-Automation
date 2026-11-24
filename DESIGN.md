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

<!-- impeccable:design-map -->
Name: Car Automation - Fleet Telemetry
Colors: primary: shell #0c5a43; secondary: good #0ca30c; tertiary: s0 #56636e; neutral: ground #eceff1; primary: shell-2 #0a4c39; primary: shell-ink #ffffff; primary: shell-ink-2 #c8e3d8 (+30 more in the sidecar)
Fonts: Archivo (headline, title, body, label); Red Hat Mono (numeric-display, numeric, byte)
Spacing: gap 0.75rem, tile-gap 0.45rem, panel 0.8rem 1rem 1rem, tile 0.5rem 0.6rem
Radius: xs 6px, sm 8px, md 12px, pill 999px
North Star: "The Wire Under Glass"
Rules:
- The Slot Discipline Rule. Series slots s0 to s7 mean "which field group" or "which car" and nothing else.
- The Hatch Means Absent Rule. A sentinel byte, a not-supported field or a not-applicable field is drawn with the hatch (135deg, 1px ink-3 stripe at 38% every 4px) over Fog.
- The Green Roof Rule. Full-strength shell green belongs to the header band only.
- The Mono For Every Number Rule. Any number, byte, hex value, plate or timestamp is set in Red Hat Mono with tabular figures and zero tracking.
- The Unknown Is Quieter Rule. A null value drops out of mono into Archivo at 500, body size, in Muted Slate, with words ("Not supported", "No reading"), so it can never be mistaken for a measured zero.
- The Projector Floor Rule. No reading text below 0.82rem (11px inside SVG gauges).
- The One Lift Rule. Resting surfaces use the ambient card shadow and nothing stronger.
Elevation:
- Ambient card: 0 1px 2px rgba(19,32,42,0.06), 0 4px 14px rgba(19,32,42,0.05)
- Floating overlay: 0 12px 36px rgba(0,0,0,0.22)
- Tooltip: 0 6px 20px rgba(0,0,0,0.2)
Don't:
- Don't colour a sentinel or unsupported byte; hatch it over Fog.
- Don't render a null as 0, OFF or an empty cell; UNKNOWN gets the dashed pill, not-applicable gets the N/A pill, null values get words in Archivo.
- Don't use series slots for status, or status colours for car identity.
- Don't use shell green outside the header band.
- Don't add glow, neon, gradient fills or stronger shadows to data surfaces; this is not a dark command centre.
- Don't use car-brand logos; identity is the slot-coloured car silhouette, the name and the plate.
Level 2 additions (driver console at /drive/, same world, shared app.css):
- Driving readouts are the one place mono goes display-size: speed 4.2rem (3.2rem on phones), gear 2.8rem, inside an 8px Fog chip.
- Pedals are tall flat tracks (throttle = good tint, brake = critical tint, clutch = slot-1 tint) with a ribbed Surface knob; they spring back to 0 on release.
- The status banner reuses the status palette as a full-width strip (info / good / warning / critical), always with an icon and words; it never carries a number that changes several times a second.
- The primary action (Connect) uses the accent with Surface text, so it holds contrast in both themes. Shell green stays in the header.
- A live, person-driven car on the fleet view gets the next spare slot (s5, s6; freed when it leaves), a "Live" tag and the line "Driven live from the Control Console". Its car view adds a Driver inputs panel (three pedal bars, gear, ignition and switch pills).
- The Control Console route loop is drawn in neutral ink, not an identity slot, because every live car shares it.
Full: .impeccable/design-full.md (read a section when you need its detail)
