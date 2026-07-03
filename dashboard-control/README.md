# Dashboard 2 — Vehicle Control Console

**Owner: Sathish** · Deployed: dashboard2.nalusa.space

Two-way console for the built platform (Track B). Sends `command` messages (forward / stop / brake / set_speed / estop) and shows `platform_status` feedback — distance to 100 m, speed, obstacle distance, collision-avoidance banner, drive state, battery, heading.

- Matches Dashboard 1's visual style. **JSON only — never raw bytes.**
- Safety rule: emergency stop always wins; stays stopped until a fresh `forward`.
- See `../docs/MESSAGE_SCHEMA.md`.
