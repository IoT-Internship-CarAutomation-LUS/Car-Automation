# Real-Car Sensing (ELM327 / TPMS)

**Owner: Pavan**

Reading live data from a real car and packing it into the project payloads.

**Current direction (Day 5):** do it **in-house / wired directly** — connect the ELM327 (or OBD line) to the ESP32 and decode the data ourselves, rather than using the third-party Bluetooth app (which won't get approval — everything must be in-house).

- `../docs/MESSAGE_SCHEMA.md` §6 has the 32-byte vehicle and 16-byte tyre packet layouts.
- Early research stage.
