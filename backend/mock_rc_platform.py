# mock_rc_platform.py -- LUS Car Automation
import os; os.environ.setdefault('PYTHONIOENCODING', 'utf-8')
# Simulates the autonomous RC platform hardware (Track B).
#
# This script plays the role of the ESP32 on the robot car:
#   - Connects to the backend WebSocket
#   - Sends platform_status at 5/sec (like the real RC car would)
#   - Listens for command messages relayed by the backend from Dashboard 2
#   - Updates its internal state in response to commands
#
# Flow:
#   Dashboard 2 → (command) → Backend → (fan-out) → THIS SCRIPT
#                                                 → Dashboard 2 (echoed back)
#
# Run with:
#   python mock_rc_platform.py
#
# Make sure the backend is running first.

import asyncio
import json
import time
import random
import websockets

BACKEND_WS_URL = "ws://localhost:8000/ws"
TICK_RATE = 0.2          # seconds between status messages (5/sec)
TARGET_DISTANCE_M = 100.0

# ── Internal platform state ────────────────────────────────────────────────────
# This mirrors what a real RC car's firmware would track internally.

state = {
    "drive_state":      "IDLE",       # IDLE | FORWARD | BRAKING | STOPPED | ESTOP
    "target_speed_kmh": 0.0,
    "speed_kmh":        0.0,
    "distance_m":       0.0,
    "heading_deg":      270.0,
    "battery_mv":       11800,
    "estop_active":     False,
}


def handle_command(cmd: dict):
    """Update internal state in response to a command from Dashboard 2."""
    action = cmd.get("action")

    if state["estop_active"] and action != "forward":
        # Schema rule: after estop, platform stays stopped until a fresh forward
        print(f"[RC] XX Ignoring '{action}' - ESTOP active. Send 'forward' to resume.")
        return

    if action == "forward":
        speed = cmd.get("target_speed_kmh", 3.0)
        state["drive_state"]      = "FORWARD"
        state["target_speed_kmh"] = speed
        state["estop_active"]     = False
        print(f"[RC] >> FORWARD at {speed} km/h")

    elif action == "set_speed":
        speed = cmd.get("target_speed_kmh", state["target_speed_kmh"])
        state["target_speed_kmh"] = speed
        print(f"[RC] ~~ Speed set to {speed} km/h")

    elif action == "stop":
        state["drive_state"]      = "STOPPED"
        state["target_speed_kmh"] = 0.0
        print(f"[RC] [] STOP - coasting to halt")

    elif action == "brake":
        state["drive_state"]      = "BRAKING"
        state["target_speed_kmh"] = 0.0
        print(f"[RC] || BRAKE - active braking")

    elif action == "estop":
        state["drive_state"]      = "ESTOP"
        state["target_speed_kmh"] = 0.0
        state["speed_kmh"]        = 0.0
        state["estop_active"]     = True
        print(f"[RC] !! EMERGENCY STOP")

    else:
        print(f"[RC] ?? Unknown action: '{action}' - ignored")


def build_status() -> dict:
    """Build the next platform_status message based on current state."""

    # Simulate speed ramping toward target
    if state["drive_state"] == "FORWARD":
        state["speed_kmh"] = min(
            state["target_speed_kmh"],
            state["speed_kmh"] + 0.2   # accelerate gradually
        )
        state["distance_m"] = min(
            TARGET_DISTANCE_M,
            state["distance_m"] + (state["speed_kmh"] / 3.6) * TICK_RATE
        )
        if state["distance_m"] >= TARGET_DISTANCE_M:
            state["drive_state"] = "STOPPED"
            state["speed_kmh"]   = 0.0
            print("[RC] == Reached target distance - STOPPED")

    elif state["drive_state"] in ("BRAKING", "STOPPED", "ESTOP", "IDLE"):
        state["speed_kmh"] = max(0.0, state["speed_kmh"] - 0.5)

    # Simulate obstacle sensor (mostly clear, occasional readings)
    obstacle_cm = random.choices(
        [random.randint(150, 250), random.randint(60, 100), random.randint(20, 40)],
        weights=[85, 12, 3]
    )[0]

    # Derive avoidance state from obstacle
    if obstacle_cm < 30 and state["drive_state"] == "FORWARD":
        avoidance_state = "BRAKING"
        state["drive_state"] = "BRAKING"
    elif obstacle_cm < 80 and state["drive_state"] == "FORWARD":
        avoidance_state = "SLOWING"
        state["speed_kmh"] = min(state["speed_kmh"], 1.5)
    else:
        avoidance_state = "CLEAR"

    # Slight heading drift
    state["heading_deg"] = (state["heading_deg"] + random.uniform(-0.3, 0.3)) % 360

    # Slowly drain battery
    state["battery_mv"] = max(10000, state["battery_mv"] - random.randint(0, 1))

    return {
        "type":              "platform_status",
        "ts":                int(time.time() * 1000),
        "drive_state":       state["drive_state"],
        "avoidance_state":   avoidance_state,
        "distance_m":        round(state["distance_m"], 2),
        "target_distance_m": TARGET_DISTANCE_M,
        "speed_kmh":         round(state["speed_kmh"], 2),
        "target_speed_kmh":  state["target_speed_kmh"],
        "obstacle_cm":       obstacle_cm,
        "heading_deg":       round(state["heading_deg"], 1),
        "battery_mv":        state["battery_mv"],
    }


async def run():
    while True:
        try:
            print(f"[RC] Connecting to backend at {BACKEND_WS_URL} ...")
            async with websockets.connect(BACKEND_WS_URL, ping_interval=None) as ws:
                print("[RC] Connected. Simulating RC platform.")
                print("[RC] Sending platform_status at 5/sec.")
                print("[RC] Waiting for commands from Dashboard 2...\n")

                async def send_status_loop():
                    """Send platform_status every TICK_RATE seconds."""
                    while True:
                        msg = build_status()
                        await ws.send(json.dumps(msg))
                        await asyncio.sleep(TICK_RATE)

                async def receive_commands():
                    """Listen for messages from the backend — act on commands."""
                    async for raw in ws:
                        try:
                            msg = json.loads(raw)
                        except json.JSONDecodeError:
                            continue

                        if msg.get("type") == "command":
                            handle_command(msg)

                await asyncio.gather(send_status_loop(), receive_commands())
        except Exception as e:
            print(f"[RC] Connection dropped ({e}). Reconnecting in 3 seconds...")
            await asyncio.sleep(3)


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        print("\n[RC] Mock RC platform stopped.")
