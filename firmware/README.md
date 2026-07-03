# Firmware (ESP32)

ESP32 sketches for the project.

- `board2-bringup/` — GPS (NEO-6M) + CAN (MCP2515) + SIM800L bring-up test. GPS working (live Chennai fix), CAN loopback passing. SIM800L parked.
- `platform-motor-node/` — (to build) the Track B two-node CAN setup: brain node sends CAN frames, motor node drives the servos.

Serial Monitor baud: 115200. Libraries: TinyGPSPlus, mcp_can (coryjfowler).
