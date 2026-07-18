# config.py — LUS Car Automation Backend
# Change these values when deploying to the server.

HOST = "0.0.0.0"       # 0.0.0.0 = accessible on the network, not just localhost
PORT = 8000
DB_PATH = "telemetry.db"
SCHEMA_VERSION = "2.0.0"

# -- Gear Estimation Ratio Thresholds (RPM / speed_kmh) ------------------------
# Used by obd_decoder.calculate_gear(rpm, speed_kmh) to assume transmission gear.
# Formula: ratio = rpm / speed_kmh
# Adjust these min/max ratio bands if road-testing a vehicle with different gearing.
# NOTE: unvalidated against a moving car as of 2026-07-18 -- same open item as GPS.
GEAR_RATIO_THRESHOLDS = [
    {"gear": 1, "min_ratio": 115.0, "max_ratio": 180.0},  # 1st Gear (~140 RPM/kmh)
    {"gear": 2, "min_ratio": 65.0,  "max_ratio": 114.9},  # 2nd Gear (~80 RPM/kmh)
    {"gear": 3, "min_ratio": 45.0,  "max_ratio": 64.9},   # 3rd Gear (~53 RPM/kmh)
    {"gear": 4, "min_ratio": 32.0,  "max_ratio": 44.9},   # 4th Gear (~37 RPM/kmh)
    {"gear": 5, "min_ratio": 24.0,  "max_ratio": 31.9},   # 5th Gear (~27 RPM/kmh)
    {"gear": 6, "min_ratio": 15.0,  "max_ratio": 23.9},   # 6th Gear (~20 RPM/kmh)
]
