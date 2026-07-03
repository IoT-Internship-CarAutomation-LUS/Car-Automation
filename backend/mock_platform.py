# mock_platform.py — LUS Car Automation
# Pretends to be the autonomous robot platform (Track B).
# Sends a platform_status message 5 times per second to the backend WebSocket.
# Simulates the platform driving 100 m, then resetting.
#
# Run with:
#   python mock_platform.py
#
# Make sure the backend is running first.

import asyncio
import json
import time
import random
import websockets

BACKEND_WS_URL = "ws://localhost:8000/ws"

TARGET_DISTANCE_M = 100.0
TICK_RATE = 0.2          # seconds between messages (5/sec)
SPEED_KMH = 4.5          # simulated platform speed
DISTANCE_PER_TICK = (SPEED_KMH / 3.6) * TICK_RATE  # metres gained per tick


def get_avoidance_state(obstacle_cm: int) -> str:
    """Derive collision avoidance state from obstacle distance."""
    if obstacle_cm < 30:
        return "BRAKING"
    elif obstacle_cm < 80:
        return "SLOWING"
    return "CLEAR"


async def run():
    print(f"[MOCK PLATFORM] Connecting to {BACKEND_WS_URL} ...")
    async with websockets.connect(BACKEND_WS_URL) as ws:
        print("[MOCK PLATFORM] Connected. Sending platform_status at 5/sec. Press Ctrl+C to stop.")

        distance_m = 0.0
        heading_deg = 270.0  # heading west, for demo

        while True:
            now_ms = int(time.time() * 1000)

            # Simulate obstacle distance — mostly clear with occasional close readings
            obstacle_cm = random.choices(
                [random.randint(150, 250), random.randint(60, 100), random.randint(20, 40)],
                weights=[85, 12, 3]
            )[0]

            avoidance_state = get_avoidance_state(obstacle_cm)

            # Slow down near obstacles
            current_speed = SPEED_KMH if avoidance_state == "CLEAR" else SPEED_KMH * 0.4

            # Determine drive state
            if avoidance_state == "BRAKING":
                drive_state = "BRAKING"
            elif distance_m >= TARGET_DISTANCE_M:
                drive_state = "STOPPED"
            else:
                drive_state = "FORWARD"

            # Advance distance if moving
            if drive_state == "FORWARD":
                distance_m = min(distance_m + DISTANCE_PER_TICK, TARGET_DISTANCE_M)

            # Reset after reaching target (simulates next run)
            if distance_m >= TARGET_DISTANCE_M:
                await asyncio.sleep(2)  # pause at finish
                distance_m = 0.0
                print("[MOCK PLATFORM] Run complete — resetting to 0 m.")
                continue

            message = {
                "type":             "platform_status",
                "ts":               now_ms,
                "drive_state":      drive_state,
                "avoidance_state":  avoidance_state,
                "distance_m":       round(distance_m, 2),
                "target_distance_m": TARGET_DISTANCE_M,
                "speed_kmh":        round(current_speed, 1),
                "target_speed_kmh": SPEED_KMH,
                "obstacle_cm":      obstacle_cm,
                "heading_deg":      round(heading_deg + random.uniform(-0.5, 0.5), 1),
                "battery_mv":       random.randint(11200, 12000)
            }

            await ws.send(json.dumps(message))
            print(f"[MOCK PLATFORM] {drive_state} | {distance_m:.1f}/{TARGET_DISTANCE_M} m | "
                  f"obstacle: {obstacle_cm} cm | {avoidance_state}")

            await asyncio.sleep(TICK_RATE)


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        print("\n[MOCK PLATFORM] Stopped.")
