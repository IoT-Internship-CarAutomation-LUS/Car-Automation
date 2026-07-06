# Dashboard 2 — Vehicle Control Console

**Owner: Sathish** · Deployed: dashboard2.nalusa.space

Two-way console for the built platform (Track B). Sends `command` messages and shows `platform_status` feedback — distance to 100 m, speed, obstacle distance, collision-avoidance banner, drive state, battery, heading.

- Schema-defined actions (see `../docs/MESSAGE_SCHEMA.md` §4): `forward`, `set_speed`, `stop`, `brake`, `estop`.
- Also sends `left`, `right`, `backward`, `start` (D-pad/start button) — **not yet in the schema**, see MESSAGE_SCHEMA.md §8 "Known drift."

- Matches Dashboard 1's visual style. **JSON only — never raw bytes.**
- Safety rule: emergency stop always wins; stays stopped until a fresh `forward`.
- See `../docs/MESSAGE_SCHEMA.md`.
