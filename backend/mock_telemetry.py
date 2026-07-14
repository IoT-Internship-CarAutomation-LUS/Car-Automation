# mock_telemetry.py — LUS Car Automation
# Pretends to be the real car (ESP32 + ELM327 + GPS + TPMS).
# Sends a telemetry message every 1 second to the backend WebSocket.
#
# Run with:
#   python mock_telemetry.py
#
# Make sure the backend is running first.

import asyncio
import json
import time
import random
import websockets

BACKEND_WS_URL = "ws://localhost:8000/ws"
SCHEMA_VERSION = "1.0.0"

# Base GPS position (Chennai area, from schema example)
BASE_LAT = 12.920364
BASE_LNG = 80.131663


def make_telemetry():
    """Generate a realistic fake telemetry message."""
    now_ms = int(time.time() * 1000)

    # GPS drift large enough (>0.002km/step) to trigger the trip odometer
    lat_drift = random.uniform(-0.0004, 0.0004)
    lng_drift = random.uniform(-0.0004, 0.0004)

    # RPM: mostly normal, ~15% of ticks spike past redline (6500) to
    # exercise the red badge and pulsing animation on the dashboard
    rpm_profile = random.choices(
        [random.randint(800, 5000), random.randint(6501, 7500)],
        weights=[85, 15]
    )[0]

    # Fuel level: mostly OK, occasionally LOW/CRITICAL to test alert badges
    fuel_profile = random.choices(
        [random.randint(30, 90),  # OK  (green badge)
         random.randint(11, 25), # LOW (amber badge)
         random.randint(1, 10)], # CRITICAL (rose badge, pulsing)
        weights=[70, 20, 10]
    )[0]

    # Brake: boolean for whether pedal is pressed + percentage depth.
    # brake_pct feeds the new bar-brake progress bar and txt-brake-pct
    # in the updated HTML ("Digital until hardware sends brake_pct").
    # Correlated: pct is 0 when not braking, non-zero when braking.
    brake_active = random.choice([False, False, False, True])
    brake_pct = random.randint(20, 100) if brake_active else 0

    return {
        "type": "telemetry",
        "schema_version": SCHEMA_VERSION,
        "ts": now_ms,
        "vehicle": {
            "rpm":                rpm_profile,
            "speed_kmh":          random.randint(0, 80),
            "gear":               random.randint(1, 5),
            "clutch_pct":         random.choice([0, 0, 0, 50, 100]),  # mostly released
            "brake":              brake_active,
            "brake_pct":          brake_pct,
            "throttle_pct":       random.randint(10, 60),
            "engine_load_pct":    random.randint(20, 70),
            "fuel_level_pct":     fuel_profile,
            "fuel_mileage_kmpl":  round(random.uniform(10.0, 20.0), 1),
            "coolant_c":          random.randint(80, 100),
            "intake_temp_c":      random.randint(25, 45),
            "maf_gps":            round(random.uniform(5.0, 20.0), 1),
            "ac_on":              random.choice([True, False]),
            "dtc_count":          0,
            "battery_mv":         random.randint(13500, 14200)
        },
        "tyres": {
            "fl": {"pressure_kpa": round(random.uniform(210.0, 230.0), 1), "temp_c": round(random.uniform(35.0, 45.0), 1)},
            "fr": {"pressure_kpa": round(random.uniform(210.0, 230.0), 1), "temp_c": round(random.uniform(35.0, 45.0), 1)},
            "rl": {"pressure_kpa": round(random.uniform(210.0, 230.0), 1), "temp_c": round(random.uniform(35.0, 45.0), 1)},
            "rr": {"pressure_kpa": round(random.uniform(210.0, 230.0), 1), "temp_c": round(random.uniform(35.0, 45.0), 1)},
        },
        "gps": {
            "lat":       round(BASE_LAT + lat_drift, 6),
            "lng":       round(BASE_LNG + lng_drift, 6),
            "speed_kmh": random.randint(0, 80),
            "sats":      random.randint(5, 10),
            "fix":       True
        }
    }


async def run():
    while True:
        try:
            print(f"[MOCK TELEMETRY] Connecting to {BACKEND_WS_URL} ...")
            async with websockets.connect(BACKEND_WS_URL, ping_interval=None) as ws:
                print("[MOCK TELEMETRY] Connected. Sending telemetry every 1 second. Press Ctrl+C to stop.")
                while True:
                    message = make_telemetry()
                    await ws.send(json.dumps(message))
                    print(f"[MOCK TELEMETRY] Sent — speed: {message['vehicle']['speed_kmh']} km/h | "
                          f"rpm: {message['vehicle']['rpm']} | "
                          f"lat: {message['gps']['lat']}")
                    await asyncio.sleep(1)
        except Exception as e:
            print(f"[MOCK TELEMETRY] Connection dropped ({e}). Reconnecting in 3 seconds...")
            await asyncio.sleep(3)


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        print("\n[MOCK TELEMETRY] Stopped.")
