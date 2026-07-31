# mock_telemetry.py — LUS Car Automation
# Pretends to be the real car (ESP32 + ELM327 + GPS + TPMS).
# Sends a telemetry message every 1 second to the backend WebSocket.
#
# Matches schema v2.0.0 exactly, including its central point: several
# fields are frequently `null` because the signal hasn't been found on
# the CAN bus yet (fuel_level_pct, ac_on, brake, clutch each go null on
# roughly 1 in 5 messages) — a dashboard that isn't tested against that
# will look fine here and then break on the real car.
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
SCHEMA_VERSION = "2.0.0"

# Base GPS position (Chennai area, from schema example)
BASE_LAT = 12.920364
BASE_LNG = 80.131663

# Roughly 1 in 5 messages: fuel_level_pct / ac_on / brake / clutch go null,
# simulating "not found on the CAN bus yet" rather than "off".
UNKNOWN_CHANCE = 0.2

_seq = 0


def make_telemetry():
    """Generate a realistic fake telemetry message."""
    global _seq
    now_ms = int(time.time() * 1000)
    _seq = (_seq + 1) & 0xFF

    # GPS drift large enough (>0.002km/step) to trigger the trip odometer
    lat_drift = random.uniform(-0.0004, 0.0004)
    lng_drift = random.uniform(-0.0004, 0.0004)

    # RPM: mostly normal, ~15% of ticks spike past redline (6500) to
    # exercise the red badge and pulsing animation on the dashboard
    rpm_profile = random.choices(
        [random.randint(800, 5000), random.randint(6501, 7500)],
        weights=[85, 15]
    )[0]

    # Fuel level: mostly OK, occasionally LOW/CRITICAL to test alert badges.
    # Null on ~1 in 5 messages (signal not found yet) -- must render as
    # "--", never as an empty tank.
    if random.random() < UNKNOWN_CHANCE:
        fuel_level_pct = None
    else:
        fuel_level_pct = random.choices(
            [random.randint(30, 90),  # OK  (green badge)
             random.randint(11, 25), # LOW (amber badge)
             random.randint(1, 10)], # CRITICAL (rose badge, pulsing)
            weights=[70, 20, 10]
        )[0]

    # Brake: three-state boolean. None = not found on the CAN bus yet,
    # must never be shown as "released".
    if random.random() < UNKNOWN_CHANCE:
        brake = None
    else:
        brake = random.choice([False, False, False, True])

    # Clutch: three-state boolean (no longer a percentage in v2).
    if random.random() < UNKNOWN_CHANCE:
        clutch = None
    else:
        clutch = random.choice([False, False, False, True])  # mostly released

    # AC: three-state boolean.
    if random.random() < UNKNOWN_CHANCE:
        ac_on = None
    else:
        ac_on = random.choice([True, False])

    return {
        "type": "telemetry",
        "schema_version": SCHEMA_VERSION,
        "ts": now_ms,
        "vehicle": {
            "rpm":                rpm_profile,
            "speed_kmh":          random.randint(0, 80),
            "gear":               random.randint(1, 5),
            "clutch":             clutch,
            "brake":              brake,
            "throttle_pct":       random.randint(10, 60),
            "engine_load_pct":    random.randint(20, 70),
            "fuel_level_pct":     fuel_level_pct,
            "fuel_mileage_kmpl":  round(random.uniform(10.0, 20.0), 1),
            "coolant_c":          random.randint(80, 100),
            "intake_temp_c":      random.randint(25, 45),
            "ambient_temp_c":     random.randint(15, 40),
            "map_kpa":            random.randint(30, 105),
            "maf_gps":            round(random.uniform(5.0, 20.0), 1),
            "ac_on":              ac_on,
            "mil_on":             random.random() < 0.03,
            "dtc_count":          0,
            "battery_v":          round(random.uniform(11.8, 14.4), 1)
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
        },
        "device": {
            "power_ok": True,
            "gps_ok":   True,
            "can_ok":   False,
            "seq":      _seq
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
