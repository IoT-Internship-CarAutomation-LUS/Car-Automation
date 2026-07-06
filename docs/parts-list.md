# Parts List — Phase 1 (SUPERSEDED / historical)

> **This is a past decision, kept for the record.** This parts list describes
> the early **Phase 1 cheap servo-based proof-of-concept car** (~₹2,000),
> which was the plan *before* the Day-6 project reframe.
>
> **It no longer reflects the current direction.** The self-driving work
> (now "Track 2") was re-scoped: it is a capability-first build with **budget
> no longer a constraint**, targeting a model car with A\* pathfinding,
> collision detection/avoidance, and a proper compute brain
> (Raspberry Pi + ESP32 motor/CAN controller, or an offboard-processing
> alternative), with encoder motors (not servos), likely LiDAR for
> localization + obstacle detection, IMU, and a camera.
>
> Use this file only as a record of the earlier thinking. The current Track 2
> parts direction will be captured in a new parts document. The Phase 1
> servo approach below is **not** what to buy for the self-driving build.

---

## Summary (Phase 1 — historical)

**Phase 1 — CAN-controlled proof-of-concept car (do first)** — approx ₹2,000 new parts, reusing the 2× ESP32, 2× MCP2515 CAN modules, and NEO-6M GPS we already own.
- 2× continuous-rotation servos (drive), wheels + castor
- Chassis, wheel encoder (distance), HC-SR04 ultrasonic (obstacle)
- 2S battery + buck converter, wiring
- Two-node CAN bus (brain node → CAN → motor node → servos)

**Later phases** — approx ₹14,000: full encoder-motor car, autonomy sensors (ToF, IMU), and real-car sensing (ELM327 + TPMS + 433 MHz receiver).

See the Word doc for the itemised breakdown, options, and prices.
