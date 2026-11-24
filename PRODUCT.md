# Product

<!-- impeccable:product-schema 1 -->

> Written from the fleet-demo brief and the repository without an interview: the brief said to run
> unattended and not ask questions. Facts marked *(inferred)* come from the repo, not from a person.

## Platform

web

## Stack

Static HTML/CSS/JS with no build step, libraries vendored (brief). Served by the project's FastAPI
backend at `/fleet/`. Dashboard 1 (`dashboard-telemetry/`) is separate and must not be changed.

## Users

- Primary: the internship team presenting at a college internship review, on a 1366×768 laptop and
  a 1920×1080 projector, narrating to examiners who are not automotive specialists.
- Secondary: the examiners. They need to see that the pipeline is real and which numbers are real.
- Later *(inferred)*: a fleet operator persona the demo stands in for, watching many cars at once.

## Product Purpose

Real-vehicle telemetry: a Raspberry Pi reads a car over OBD-II plus GPS, packs each sample into a
32-byte CRC-8 packet, and streams it through a FastAPI backend to a dashboard. For the review, where
live cars are not allowed, the fleet dashboard shows five cars at once. Only the cars are simulated
or replayed; every message crosses the real packer, unpacker, backend and fan-out. Success means an
examiner can follow a value from the car to the screen, and can tell measured data from simulated
data and from "this car does not report it".

## Positioning

The difference is honesty about the wire. Each value shows where it came from: measured, simulated,
derived, not supported by this vehicle, or not applicable (EV). The raw packet is on screen with
every byte named, so the claim "this is our real pipeline" can be checked live.

## Operating Context

A presenter drives the demo in a lit seminar room. Projectors wash out light greys and thin lines.
A hidden presenter panel (P key) triggers scenarios (overheat, puncture, car offline, MIL on). There
may be no internet, so the dashboard has a standalone in-browser mode, but map tiles need a network.

## Capabilities and Constraints

- Schema v2.1.0 (`docs/MESSAGE_SCHEMA.md`) is the single source of truth.
- Null is never 0 or OFF. `brake`, `clutch` and `ac_on` are three-state: ON, OFF, UNKNOWN.
- Data is labelled measured / simulated / derived / not supported / not applicable / no reading.
- The real Fronx data is a 31 July 2026 stationary idle session with no GPS.
- OBD speed (PID 0x0D) tops out at 254 km/h on the wire.

## Brand Commitments

Project name "Car Automation - Fleet Telemetry", subtitle "LUS IoT Internship". No car-brand logos.
Light theme by default with a dark toggle; a monospace face for numbers and hex (brief).

## Evidence on Hand

- `demo/data/fronx_recorded.json`: 1,597 real samples from the team's Fronx.
- `demo/data/routes/*.json`: OSRM road geometry for five Chennai routes.
- Registration plates in the demo are fake Tamil Nadu-style plates. No real fleet, customers or
  benchmarks exist; do not invent any.

## Product Principles

1. Show the pipeline, not just the numbers: the packet is part of the interface.
2. Label every value honestly; an unknown is shown as unknown.
3. Readable at projector distance before it is dense.
4. One working tool, not a slide: the presenter can click anything and it holds up.

## Accessibility & Inclusion

Projector use means high contrast and no meaning carried by colour alone (status = icon + word).
