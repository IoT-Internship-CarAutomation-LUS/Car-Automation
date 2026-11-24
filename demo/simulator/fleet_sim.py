# fleet_sim.py -- LUS Car Automation fleet demo simulator (schema v2.2.0)
#
# Five cars, 1 Hz each, one WebSocket connection per car to the real FastAPI
# backend. Only the CAR is simulated: every message is built by packing the
# car's values into the real 32-byte packet with backend/obd_decoder.py
# (pack_packet, CRC-8) and the tyres into the 16-byte TPMS packet with
# backend/tpms_codec.py, then unpacking both again. The JSON that leaves here
# is exactly what unpack_packet() produced, plus the v2.1.0 envelope keys.
#
#   python demo/simulator/fleet_sim.py
#   python demo/simulator/fleet_sim.py --ws ws://192.168.1.20:8000/ws
#   python demo/simulator/fleet_sim.py --fronx-mode simulated --cars fronx,omni
#
# Presenter scenarios arrive as `demo_control` messages relayed by the backend:
#   omni_overheat, corolla_puncture, car_offline (target, duration_s), mil_on, reset_all

import argparse
import asyncio
import bisect
import csv
import json
import math
import random
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from obd_decoder import pack_packet, unpack_packet, SCHEMA_VERSION  # noqa: E402
from tpms_codec import pack_tpms, unpack_tpms  # noqa: E402

try:
    from websockets.asyncio.client import connect as ws_connect
except ImportError:  # websockets < 13
    from websockets import connect as ws_connect  # type: ignore

DATA = ROOT / "demo" / "data"
TICK_S = 1.0
NULL_TYRES = {p: {"pressure_kpa": None, "temp_c": None} for p in ("fl", "fr", "rl", "rr")}

# Fronx defaults when the recording is replayed: parked on GST Road near Tambaram.
FRONX_PARKED = {"lat": 12.924940, "lng": 80.119930, "heading_deg": 38.0}
# The 31 July recording has real ambient readings (33-41 C) even though earlier
# sessions found PID 0x46 unsupported. True = replay what the car reported.
# Pass --fronx-ambient null to force the brief's "never found" null instead.
FRONX_RECORDED_KEEP_AMBIENT = True


def clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


def approach(cur, target, rate_up, rate_down, dt=TICK_S):
    if target > cur:
        return min(target, cur + rate_up * dt)
    return max(target, cur - rate_down * dt)


# ---------------------------------------------------------------------------
# Route geometry: a closed polyline the car follows at its reported speed.
# ---------------------------------------------------------------------------

def _hav_m(a, b):
    R = 6371000.0
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def _bearing(a, b):
    la1, la2 = math.radians(a[0]), math.radians(b[0])
    dlo = math.radians(b[1] - a[1])
    x = math.sin(dlo) * math.cos(la2)
    y = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dlo)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def _angle_diff(a, b):
    return abs((b - a + 180) % 360 - 180)


class Route:
    def __init__(self, coords):
        pts = [tuple(c) for c in coords]
        # drop duplicate consecutive points
        self.pts = [pts[0]] + [p for i, p in enumerate(pts[1:], 1) if _hav_m(pts[i - 1], p) > 0.5]
        if _hav_m(self.pts[0], self.pts[-1]) > 1:
            self.pts.append(self.pts[0])
        self.cum = [0.0]
        for a, b in zip(self.pts, self.pts[1:]):
            self.cum.append(self.cum[-1] + _hav_m(a, b))
        self.length = self.cum[-1]
        self.bearings = [_bearing(a, b) for a, b in zip(self.pts, self.pts[1:])]
        # corner severity at each vertex: heading change across ~30 m either side
        self.turn = []
        for i in range(len(self.pts)):
            s = self.cum[i]
            self.turn.append(_angle_diff(self.heading_at(s - 30), self.heading_at(s + 30)))

    def _seg(self, s):
        s %= self.length
        i = bisect.bisect_right(self.cum, s) - 1
        return clamp(i, 0, len(self.bearings) - 1), s

    def heading_at(self, s):
        i, _ = self._seg(s)
        return self.bearings[i]

    def position(self, s):
        i, s = self._seg(s)
        a, b = self.pts[i], self.pts[i + 1]
        seg = self.cum[i + 1] - self.cum[i]
        f = 0 if seg <= 0 else (s - self.cum[i]) / seg
        return a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, self.bearings[i]

    def max_turn_ahead(self, s, lookahead):
        """Largest heading change at any vertex within the next `lookahead` metres."""
        s0 = s % self.length
        i = bisect.bisect_right(self.cum, s0)
        n = len(self.pts)
        worst, dist, prev = 0.0, 0.0, s0
        for k in range(n):
            idx = (i + k) % n
            c = self.cum[idx]
            dist += (c - prev) if c >= prev else (self.length - prev) + c
            prev = c
            if dist > lookahead:
                break
            worst = max(worst, self.turn[idx])
        return worst


def load_route(car_id):
    doc = json.loads((DATA / "routes" / f"{car_id}.json").read_text())
    return Route(doc["coords"])


# ---------------------------------------------------------------------------
# Car models
# ---------------------------------------------------------------------------

CAR_SPECS = {
    "fronx": dict(name="Maruti Suzuki Fronx", model_year=2024, reg_no="TN 11 AZ 4817", powertrain="petrol",
                  cruise=(38, 58), accel=1.6, decel=2.6, stop_every=(70, 140), stop_len=(8, 20),
                  ratios=[140, 80, 53, 37, 27], idle=(688, 850), rpm_max=3126, upshift=2800, disp_l=1.2),
    "corolla": dict(name="Toyota Corolla", model_year=2020, reg_no="TN 14 BK 2209", powertrain="petrol",
                    cruise=(45, 72), accel=1.8, decel=2.8, stop_every=(80, 160), stop_len=(10, 25),
                    ratios=[140, 80, 53, 37, 27, 20], idle=(700, 760), rpm_max=5200, upshift=2600, disp_l=1.8),
    "veyron": dict(name="Bugatti Veyron 16.4", model_year=2011, reg_no="TN 09 BV 1001", powertrain="petrol",
                   cruise=(170, 300), accel=4.5, decel=6.0, stop_every=None, stop_len=None,
                   ratios=[62, 43, 32, 25, 20, 17, 14.7], idle=(850, 950), rpm_max=6400, upshift=4300, disp_l=8.0),
    "omni": dict(name="Maruti Omni", model_year=2005, reg_no="TN 07 AC 1986", powertrain="petrol",
                 cruise=(22, 42), accel=1.0, decel=2.2, stop_every=(45, 90), stop_len=(10, 30),
                 ratios=[140, 80, 53, 37], idle=(820, 900), rpm_max=4500, upshift=2800, disp_l=0.8),
    "roadster": dict(name="Tesla Roadster", model_year=2008, reg_no="TN 10 EV 2008", powertrain="ev",
                     cruise=(40, 68), accel=2.6, decel=2.6, stop_every=(80, 150), stop_len=(10, 22),
                     motor_rpm_per_kmh=69.6, rpm_max=14000),
}


class Car:
    def __init__(self, car_id, args):
        self.id = car_id
        self.spec = CAR_SPECS[car_id]
        self.args = args
        self.rng = random.Random(sum(map(ord, car_id)) * 7919)
        self.route = load_route(car_id)
        self.s = self.rng.uniform(0, self.route.length)          # start somewhere on the loop
        self.v = self.rng.uniform(0.3, 0.7) * self.spec["cruise"][1] / 3.6   # m/s
        self.cruise = self.rng.uniform(*self.spec["cruise"])
        self.cruise_until = 0.0
        self.stop_until = 0.0
        self.next_stop = time.time() + (self.rng.uniform(*self.spec["stop_every"]) if self.spec["stop_every"] else 1e12)
        self.gear = 1
        self.prev_gear = 1
        self.heading = self.route.heading_at(self.s)
        self.seq = self.rng.randrange(256)
        self.t = 0
        self.coolant = 88.5
        self.intake = 38.0
        self.oil_like = 0.0
        self.tyre_temp = {p: 31.0 for p in NULL_TYRES}
        self.tyre_cold = {}
        self.cabin_t = 26.5
        self.cabin_h = 58.0
        self.rssi = -74.0
        self.soc = 78.0
        self.scen = {}            # active scenarios for this car
        self.offline_until = 0.0
        self.next_drop = time.time() + self.rng.uniform(30, 80)
        self.recorded = None
        self.recorded_idx = 0
        self.gps_track = None
        if car_id == "fronx":
            self._init_fronx()
        if car_id == "corolla":
            self.tyre_cold = {"fl": 230.0, "fr": 230.0, "rl": 225.0, "rr": 225.0}
        elif car_id == "veyron":
            self.tyre_cold = {"fl": 255.0, "fr": 255.0, "rl": 275.0, "rr": 275.0}
            self.tyre_temp = {p: 52.0 for p in NULL_TYRES}
        elif car_id == "roadster":
            self.tyre_cold = {"fl": 207.0, "fr": 207.0, "rl": 241.0, "rr": 241.0}
        if car_id == "omni":
            self.coolant = 97.0
            self.rssi = -99.0

    # ---- Fronx: replay the real recording, or simulate within its envelope
    def _init_fronx(self):
        self.mode = self.args.fronx_mode
        if self.mode != "recorded":
            self.coolant = 88.0
            return
        # A CSV with real lat/lng dropped into demo/data/ wins: replay it with measured GPS.
        for p in sorted(DATA.glob("*.csv")):
            with open(p, newline="", encoding="utf-8", errors="ignore") as f:
                rows = list(csv.DictReader(f))
            if rows and "lat" in rows[0] and ("lng" in rows[0] or "lon" in rows[0]):
                good = [r for r in rows if r.get("lat") not in ("", "None", None)]
                if len(good) > 10:
                    self.recorded = [self._csv_row(r) for r in good]
                    self.gps_track = True
                    print(f"[fronx] replaying {p.name} with measured GPS ({len(good)} rows)")
                    return
        doc = json.loads((DATA / "fronx_recorded.json").read_text())
        self.recorded = doc["samples"]
        self.recorded_idx = 0
        print(f"[fronx] replaying fronx_recorded.json ({len(self.recorded)} rows, recorded {doc.get('recorded_on')}), "
              "parked at a fixed simulated position")

    @staticmethod
    def _csv_row(r):
        def f(k, cast=float):
            v = r.get(k)
            if v in ("", "None", None):
                return None
            try:
                return cast(v)
            except ValueError:
                return None
        return {
            "rpm": f("rpm"), "speed_kmh": f("speed_kmh"), "coolant_c": f("coolant_c"),
            "engine_load_pct": f("engine_load_pct"), "throttle_pct": f("throttle_pct"),
            "fuel_level_pct": f("fuel_level_pct"), "maf_gps": f("maf_gps"), "intake_temp_c": f("intake_temp_c"),
            "ambient_temp_c": f("ambient_temp_c"), "map_kpa": f("map_kpa"),
            "mil_on": None if r.get("mil_on") in ("", None) else r.get("mil_on") == "True",
            "dtc_count": f("dtc_count", int), "battery_v": f("battery_v"),
            "lat": f("lat"), "lng": f("lng") if "lng" in r else f("lon"), "sats": f("sats", int),
        }

    # ---- motion along the route -------------------------------------------
    def _drive(self, now):
        sp = self.spec
        if now > self.cruise_until:
            self.cruise = self.rng.uniform(*sp["cruise"])
            self.cruise_until = now + self.rng.uniform(25, 60)
        target = self.cruise
        # traffic signal / congestion stop
        if sp["stop_every"] and now >= self.next_stop and self.stop_until < now:
            self.stop_until = now + self.rng.uniform(*sp["stop_len"])
            self.next_stop = self.stop_until + self.rng.uniform(*sp["stop_every"])
        if now < self.stop_until:
            target = 0.0
        # slow for corners ahead
        v = self.v
        lookahead = v * v / (2 * sp["decel"]) + 25
        turn = self.route.max_turn_ahead(self.s, lookahead)
        if turn > 8:
            corner = max(14.0, target * max(0.15, 1 - turn / 100.0))
            if sp is CAR_SPECS["veyron"]:
                corner = max(60.0, corner)
            target = min(target, corner)
        target_ms = target / 3.6
        noise = self.rng.uniform(-0.15, 0.15)
        new_v = approach(v, target_ms, sp["accel"] * (0.8 + 0.4 * self.rng.random()), sp["decel"])
        new_v = max(0.0, new_v + (noise if new_v > 1 else 0))
        accel = (new_v - v) / TICK_S
        self.s = (self.s + (v + new_v) / 2 * TICK_S) % self.route.length
        self.v = new_v
        lat, lng, seg_heading = self.route.position(self.s)
        # smooth heading so a 1 Hz sample never snaps through a vertex
        d = (seg_heading - self.heading + 540) % 360 - 180
        self.heading = (self.heading + d * (0.85 if new_v > 0.5 else 0.0)) % 360
        return lat, lng, accel

    def _gearbox(self, speed_kmh):
        sp = self.spec
        ratios = sp["ratios"]
        if speed_kmh < 2:
            return 0, self.rng.uniform(*sp["idle"])
        g = max(1, min(self.gear, len(ratios)))
        while g < len(ratios) and speed_kmh * ratios[g - 1] > sp["upshift"]:
            g += 1
        while g > 1 and speed_kmh * ratios[g - 1] < sp["idle"][1] + 350:
            g -= 1
        rpm = speed_kmh * ratios[g - 1]
        rpm = max(rpm, sp["idle"][0] + 150)
        return g, min(rpm, sp["rpm_max"])

    # ---- one 1 Hz sample ------------------------------------------------------
    def step(self, now):
        self.t += 1
        sp = self.spec
        if self.id == "fronx" and self.recorded is not None:
            return self._step_recorded(now)

        lat, lng, accel = self._drive(now)
        real_speed = self.v * 3.6
        pedal = clamp(0.12 + accel * 0.28 + (real_speed / 300.0) ** 1.5 * 0.9, 0, 1) if real_speed > 1 else 0.0
        if accel < -0.3:
            pedal = 0.0
        braking = accel < -0.7 or (real_speed < 1 and now < self.stop_until)

        v = {}  # decoded PID values (None = not supported)
        extras_can = {"brake": None, "clutch": None, "ac": None}
        gear_out = None

        if sp["powertrain"] == "ev":
            rpm = real_speed * sp["motor_rpm_per_kmh"]
            gear_out = None
            # SOC drains with distance and a little with time (HVAC, electronics)
            kwh_per_km = 0.135 + 0.0000105 * real_speed ** 2
            self.soc -= (kwh_per_km * (self.v * TICK_S / 1000.0) + 0.0004) / 53.0 * 100
            if self.soc < 18:
                self.soc = 80.0      # "recharged" between demo loops
            v = {0x0C: rpm, 0x0D: real_speed, 0x05: None, 0x04: None, 0x11: round(pedal * 100, 1),
                 0x2F: None, 0x10: None, 0x0F: None, 0x46: 30 + 2 * math.sin(self.t / 300), 0x0B: None,
                 0x01: (False, 0)}
            extras_can = {"brake": braking, "clutch": None, "ac": True}
            battery = 13.5 + 0.1 * math.sin(self.t / 40)
        else:
            gear, rpm = self._gearbox(real_speed)
            shifting = gear != self.prev_gear and gear > 0 and self.prev_gear > 0
            self.prev_gear, self.gear = gear, max(gear, 1)
            if rpm > sp["rpm_max"]:
                rpm = sp["rpm_max"]
            throttle_abs = 14.0 + pedal * 72.0             # absolute TPS: ~14% closed on the Fronx
            load = clamp(18 + pedal * 70 + self.rng.uniform(-2, 2), 10, 100)
            # air mass = revs/s * (displacement/2 per rev, 4-stroke) * air density * load (boost for the Veyron)
            maf = (rpm / 60.0) * (sp["disp_l"] / 2) * 1.18 * (load / 100.0) * (1.4 if self.id == "veyron" else 1.0)
            maf = max(maf, 1.4)
            map_kpa = clamp(26 + load * 0.72, 20, 101) if self.id != "veyron" else clamp(30 + load * 1.6, 20, 250)
            # temperatures drift slowly toward an operating point
            hot = 88.5 + 1.5 * math.sin(self.t / 180.0)
            if self.id == "omni":
                hot = 98.5 + 3.5 * math.sin(self.t / 150.0)
            if self.id == "veyron":
                hot = 92 + 3 * min(1, real_speed / 300)
            if self.scen.get("overheat"):
                hot = 116.0
                self.coolant = approach(self.coolant, hot, 0.7, 0.2)
            else:
                self.coolant = approach(self.coolant, hot, 0.15, 0.35)
            self.intake = approach(self.intake, 34 + load * 0.25 - real_speed * 0.05, 0.2, 0.2)
            ambient = 30 + 2 * math.sin(self.t / 300)
            mil = (True, 2) if self.scen.get("mil") else (False, 0)
            gear_out = gear
            battery = {"fronx": 13.8, "corolla": 14.2, "veyron": 13.9, "omni": None}[self.id]
            if battery is not None and self.id != "fronx":
                battery += 0.1 * math.sin(self.t / 37)
            v = {0x0C: rpm, 0x0D: real_speed, 0x05: self.coolant, 0x04: load, 0x11: throttle_abs,
                 0x2F: None, 0x10: maf, 0x0F: self.intake, 0x46: ambient, 0x0B: map_kpa, 0x01: mil}
            if self.id == "corolla":
                v[0x2F] = 62 - (self.t / 3600.0) * 4      # slow fuel burn
                extras_can = {"brake": braking, "clutch": bool(shifting) or (real_speed < 1 and now < self.stop_until),
                              "ac": True}
            elif self.id == "veyron":
                v[0x2F] = 71 - (self.t / 3600.0) * 30
                extras_can = {"brake": braking, "clutch": None, "ac": True}
            elif self.id == "fronx":    # simulated mode, inside the measured envelope
                v[0x2F] = None
                v[0x46] = None
                gear_out = None          # the real Pi sends no gear; the backend estimates it
            elif self.id == "omni":     # legacy ECU: RPM, speed, coolant only
                v = {0x0C: rpm, 0x0D: real_speed, 0x05: self.coolant}
                gear_out = None
        return self._emit(now, v, real_speed, lat, lng, gear_out, battery, extras_can, braking)

    def _step_recorded(self, now):
        row = self.recorded[self.recorded_idx]
        self.recorded_idx = (self.recorded_idx + 1) % len(self.recorded)
        v = {0x0C: row["rpm"], 0x0D: row["speed_kmh"], 0x05: row["coolant_c"], 0x04: row["engine_load_pct"],
             0x11: row["throttle_pct"], 0x2F: None, 0x10: row["maf_gps"], 0x0F: row["intake_temp_c"],
             0x46: row["ambient_temp_c"] if (FRONX_RECORDED_KEEP_AMBIENT and self.args.fronx_ambient == "recorded") else None,
             0x0B: row["map_kpa"],
             0x01: None if row["mil_on"] is None else (row["mil_on"], row["dtc_count"] or 0)}
        if self.gps_track:
            lat, lng = row["lat"], row["lng"]
            prev = self.recorded[self.recorded_idx - 2] if self.recorded_idx >= 2 else row
            if prev.get("lat") is not None and _hav_m((prev["lat"], prev["lng"]), (lat, lng)) > 2:
                self.heading = _bearing((prev["lat"], prev["lng"]), (lat, lng))
        else:
            lat, lng = FRONX_PARKED["lat"], FRONX_PARKED["lng"]
            self.heading = FRONX_PARKED["heading_deg"]
        self.v = (row["speed_kmh"] or 0) / 3.6
        return self._emit(now, v, row["speed_kmh"] or 0, lat, lng, None, row["battery_v"],
                          {"brake": None, "clutch": None, "ac": None}, False, sats=row.get("sats"))

    # ---- pack -> unpack -> JSON ----------------------------------------------
    def _emit(self, now, decoded, real_speed, lat, lng, gear, battery, can, braking, sats=None):
        sp = self.spec
        self.seq = (self.seq + 1) & 0xFF
        if sats is None:
            sats = self.rng.choice((6, 7, 7)) if self.id == "fronx" else self.rng.choice((7, 8, 9, 9, 10))
        gps = {"lat": lat, "lng": lng, "sats": sats, "fix": lat is not None}
        extras = {"battery_v": battery, "gear": gear, "seq": self.seq, "can": can,
                  "health": {"power_ok": True, "gps_ok": gps["fix"],
                             "can_ok": any(x is not None for x in can.values())}}
        pkt = pack_packet(decoded, gps, extras)
        u = unpack_packet(pkt)

        tyres, tpms_hex, tpms_crc = None, None, None
        if self.tyre_cold:
            temps = {}
            for p in NULL_TYRES:
                base = 31 + real_speed * (0.09 if self.id != "veyron" else 0.13) + (2 if p.startswith("r") else 0)
                if braking:
                    base += 1.5
                self.tyre_temp[p] = approach(self.tyre_temp[p], base, 0.06, 0.04)
                temps[p] = self.tyre_temp[p]
            pres = {}
            for p, cold in self.tyre_cold.items():
                pres[p] = cold * (temps[p] + 273.15) / (30 + 273.15)
            if self.scen.get("puncture"):
                self.scen["puncture_kpa"] = max(128.0, self.scen.get("puncture_kpa", pres["fl"]) - 3.2)
                pres["fl"] = self.scen["puncture_kpa"]
            raw_tyres = {p: {"pressure_kpa": pres[p] + self.rng.uniform(-0.4, 0.4), "temp_c": temps[p]} for p in NULL_TYRES}
            tp = pack_tpms(raw_tyres, self.seq)
            tu = unpack_tpms(tp)
            tyres, tpms_hex, tpms_crc = tu["tyres"], tp.hex(" ").upper(), tu["crc_valid"]

        vehicle = dict(u["vehicle"])
        # Derived km/L from MAF + speed (stoichiometric petrol, 745 g/L). Not in the packet.
        kmpl = None
        if sp["powertrain"] == "petrol" and vehicle["maf_gps"] and vehicle["speed_kmh"] and vehicle["speed_kmh"] >= 3:
            lph = vehicle["maf_gps"] * 3600 / (14.7 * 745)
            kmpl = round(vehicle["speed_kmh"] / lph, 1) if lph > 0 else None
        vehicle["fuel_mileage_kmpl"] = kmpl

        has_board = self.id in ("corolla", "veyron", "roadster")
        if has_board:
            target_t = 24.5 if can.get("ac") else 31
            self.cabin_t = approach(self.cabin_t, target_t + self.rng.uniform(-0.3, 0.3), 0.05, 0.05)
            self.cabin_h = clamp(self.cabin_h + self.rng.uniform(-0.4, 0.4), 48, 66)
        cabin = {"temp_c": round(self.cabin_t, 1) if has_board else None,
                 "humidity_pct": round(self.cabin_h) if has_board else None}
        if self.id == "omni":
            self.rssi = clamp(self.rssi + self.rng.uniform(-2.5, 2.5), -109, -93)
        else:
            self.rssi = clamp(self.rssi + self.rng.uniform(-1.5, 1.5), -86, -63)
        gsm = {"rssi_dbm": round(self.rssi) if (has_board or self.id == "omni") else None}
        ev = {"soc_pct": round(self.soc, 1), "range_km": round(self.soc * 3.93)} if sp["powertrain"] == "ev" \
            else {"soc_pct": None, "range_km": None}

        return {
            "type": "telemetry",
            "schema_version": u["schema_version"],
            "ts": int(now * 1000),
            "source": {"vehicle_id": self.id, "name": sp["name"], "model_year": sp["model_year"],
                       "reg_no": sp["reg_no"], "powertrain": sp["powertrain"],
                       "data_mode": "recorded" if (self.id == "fronx" and self.recorded is not None) else "simulated",
                       "control": "auto"},
            "driver": {"ignition": None, "throttle_pedal_pct": None, "brake_pedal_pct": None,
                       "clutch_pedal_pct": None, "transmission": None, "estop": None},
            "vehicle": vehicle,
            "tyres": tyres or {p: dict(x) for p, x in NULL_TYRES.items()},
            "gps": {**u["gps"], "heading_deg": round(self.heading, 1) if self.heading is not None else None},
            "device": u["device"],
            "cabin": cabin,
            "gsm": gsm,
            "ev": ev,
            "packet_hex": pkt.hex(" ").upper(),
            "tpms_hex": tpms_hex,
            "crc_valid": u["crc_valid"],
            "tpms_crc_valid": tpms_crc,
            "provenance": self.provenance(),
        }

    def provenance(self):
        recorded = self.id == "fronx" and self.recorded is not None
        base = "measured" if recorded else "simulated"
        p = {"vehicle": base, "tyres": "simulated" if self.tyre_cold else "not_supported",
             "gps": "measured" if (recorded and self.gps_track) else "simulated",
             "cabin": "simulated" if self.id in ("corolla", "veyron", "roadster") else "not_supported",
             "gsm": "simulated" if self.id in ("corolla", "veyron", "roadster", "omni") else "not_supported",
             "ev": "simulated" if self.spec["powertrain"] == "ev" else "not_applicable",
             "driver": "not_applicable",
             "fields": {"vehicle.fuel_mileage_kmpl": "derived"}}
        f = p["fields"]
        if self.id == "fronx":
            for k in ("fuel_level_pct", "brake", "clutch", "ac_on"):
                f[f"vehicle.{k}"] = "not_supported"
            f["vehicle.gear"] = "derived"
            if recorded:
                f["vehicle.coolant_c"] = "no_data"          # empty in every row of this session
                if not (FRONX_RECORDED_KEEP_AMBIENT and self.args.fronx_ambient == "recorded"):
                    f["vehicle.ambient_temp_c"] = "not_supported"
            else:
                f["vehicle.ambient_temp_c"] = "not_supported"
        elif self.id == "omni":
            for k in ("throttle_pct", "engine_load_pct", "fuel_level_pct", "maf_gps", "intake_temp_c",
                      "ambient_temp_c", "map_kpa", "battery_v", "mil_on", "dtc_count", "brake", "clutch",
                      "ac_on", "fuel_mileage_kmpl"):
                f[f"vehicle.{k}"] = "not_supported"
            f["vehicle.gear"] = "derived"
        elif self.id == "veyron":
            f["vehicle.clutch"] = "not_supported"           # dual-clutch gearbox, no clutch pedal
        elif self.id == "roadster":
            for k in ("coolant_c", "maf_gps", "map_kpa", "intake_temp_c", "fuel_level_pct", "engine_load_pct",
                      "gear", "clutch", "fuel_mileage_kmpl"):
                f[f"vehicle.{k}"] = "not_applicable"
        return p

    # ---- presenter scenarios ---------------------------------------------------
    def reset(self):
        self.scen = {}
        self.offline_until = 0.0


# ---------------------------------------------------------------------------
# Networking: one socket per car, a shared control handler
# ---------------------------------------------------------------------------

class Fleet:
    def __init__(self, args):
        self.args = args
        self.cars = {c: Car(c, args) for c in args.cars}
        self.seen_controls = set()
        self.stats = {c: 0 for c in self.cars}

    def handle_control(self, msg):
        cid = msg.get("id") or f"{msg.get('scenario')}-{msg.get('ts')}"
        if cid in self.seen_controls:
            return
        self.seen_controls.add(cid)
        sc, target = msg.get("scenario"), msg.get("target")
        print(f"[control] {sc} target={target}")
        if sc == "omni_overheat" and "omni" in self.cars:
            self.cars["omni"].scen["overheat"] = True
        elif sc == "corolla_puncture" and "corolla" in self.cars:
            self.cars["corolla"].scen["puncture"] = True
        elif sc == "mil_on" and "corolla" in self.cars:
            self.cars["corolla"].scen["mil"] = True
        elif sc == "car_offline":
            car = self.cars.get(target) or self.cars.get("veyron") or next(iter(self.cars.values()))
            car.offline_until = time.time() + float(msg.get("duration_s") or 15)
        elif sc == "reset_all":
            for car in self.cars.values():
                car.reset()
                if car.id == "omni":
                    car.coolant = 99.0

    async def reader(self, ws):
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except (TypeError, ValueError):
                continue
            if isinstance(msg, dict) and msg.get("type") == "demo_control":
                self.handle_control(msg)

    async def run_car(self, car, offset):
        await asyncio.sleep(offset)
        backoff = 1.0
        next_tick = time.time()
        while True:
            try:
                async with ws_connect(self.args.ws, open_timeout=5, max_size=2 ** 20) as ws:
                    print(f"[{car.id}] connected to {self.args.ws}")
                    backoff = 1.0
                    reader = asyncio.create_task(self.reader(ws))
                    try:
                        while True:
                            now = time.time()
                            msg = car.step(now)
                            dropped = False
                            if car.id == "omni" and now >= car.next_drop:
                                dropped = True          # simulated packet loss: seq advances, nothing sent
                                car.next_drop = now + car.rng.uniform(35, 90)
                            if now < car.offline_until:
                                dropped = True          # presenter "car offline"
                            if not dropped:
                                await ws.send(json.dumps(msg))
                                self.stats[car.id] += 1
                            if reader.done():
                                reader.result()
                            next_tick += TICK_S
                            await asyncio.sleep(max(0.0, next_tick - time.time()))
                    finally:
                        reader.cancel()
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                print(f"[{car.id}] connection problem ({type(e).__name__}: {e}); retrying in {backoff:.0f}s")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 10)
                next_tick = time.time()

    async def status(self):
        while True:
            await asyncio.sleep(30)
            print("[sim] packets sent: " + ", ".join(f"{k}={v}" for k, v in self.stats.items()))

    async def run(self):
        n = len(self.cars)
        tasks = [asyncio.create_task(self.run_car(car, i * TICK_S / max(n, 1)))
                 for i, car in enumerate(self.cars.values())]
        tasks.append(asyncio.create_task(self.status()))
        await asyncio.gather(*tasks)


def main():
    ap = argparse.ArgumentParser(description="Fleet demo simulator: 5 cars through the real 32-byte packet pipeline.")
    ap.add_argument("--ws", default="ws://localhost:8000/ws", help="backend WebSocket URL")
    ap.add_argument("--fronx-mode", choices=("recorded", "simulated"), default="recorded")
    ap.add_argument("--fronx-ambient", choices=("recorded", "null"), default="recorded",
                    help="recorded mode: replay the logged ambient temperature, or force null")
    ap.add_argument("--cars", default=",".join(CAR_SPECS), help="comma-separated subset, e.g. fronx,omni")
    ap.add_argument("--once", action="store_true", help="print one message per car and exit (no network)")
    args = ap.parse_args()
    args.cars = [c.strip() for c in args.cars.split(",") if c.strip() in CAR_SPECS]
    if args.once:
        fleet = Fleet(args)
        for car in fleet.cars.values():
            print(json.dumps(car.step(time.time()), indent=1))
        return
    print(f"[sim] schema {SCHEMA_VERSION}, cars: {', '.join(args.cars)}, backend {args.ws}, fronx {args.fronx_mode}")
    try:
        asyncio.run(Fleet(args).run())
    except KeyboardInterrupt:
        print("\n[sim] stopped")


if __name__ == "__main__":
    main()
