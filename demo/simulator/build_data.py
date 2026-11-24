# build_data.py -- one-time data preparation for the fleet demo.
#
#   python demo/simulator/build_data.py            # build what is missing
#   python demo/simulator/build_data.py --refresh  # re-fetch routes from OSRM
#
# 1. Finds the largest real decoded session CSV under logs/ and extracts the
#    engine fields only into demo/data/fronx_recorded.json. Timestamps are
#    re-based to start at 0. No session id, no wall-clock time, no packet hex.
# 2. Fetches road-following route geometry ONCE from the public OSRM server and
#    saves it to demo/data/routes/<car>.json, so the demo never needs OSRM
#    (or the internet) at runtime. If OSRM fails, hand-written waypoints that
#    follow the same roads are saved instead, marked "source": "hand-written".
# 3. Writes demo/fleet-dashboard/js/demo-data.js, the same data as a JS global,
#    for the dashboard's standalone mode (works even when opened as a file).

import csv
import json
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from obd_decoder import unpack_packet  # noqa: E402

DATA = ROOT / "demo" / "data"
ROUTES = DATA / "routes"
BUNDLE = ROOT / "demo" / "fleet-dashboard" / "js" / "demo-data.js"
LIVE_BUNDLE = ROOT / "demo" / "driver-console" / "js" / "live-route.js"

# (lat, lng) waypoints. OSRM is asked for A -> ... -> B and then B -> ... -> A
# so every route is a closed loop the car can drive forever.
ROUTE_SPECS = {
    "fronx": {
        "label": "GST Road, Tambaram to Chromepet",
        "points": [(12.92330, 80.11820), (12.93620, 80.12930), (12.95160, 80.14080)],
    },
    "corolla": {
        "label": "OMR, Sholinganallur to Thoraipakkam",
        "points": [(12.90080, 80.22780), (12.92120, 80.23060), (12.94100, 80.23540)],
    },
    "veyron": {
        "label": "ECR, Thiruvanmiyur to Muttukadu",
        "points": [(12.98400, 80.25850), (12.94920, 80.25470), (12.90600, 80.24900),
                   (12.86200, 80.24500), (12.81450, 80.24300)],
    },
    "omni": {
        "label": "Anna Salai and T. Nagar loop",
        "points": [(13.05950, 80.25120), (13.04420, 80.24880), (13.04080, 80.23610),
                   (13.04130, 80.23380), (13.05300, 80.24350)],
        "closed": True,
    },
    "roadster": {
        "label": "Kamarajar Salai, along Marina Beach",
        "points": [(13.07150, 80.28620), (13.05650, 80.28220), (13.04050, 80.27960)],
    },
    # Level 2 driver console. Start: BS Abdur Rahman Crescent Institute of Science and
    # Technology, Vandalur (Nominatim, looked up once: 12.8748935, 80.0848035).
    "live": {
        "label": "Crescent campus, Vandalur, and GST Road",
        "points": [(12.87489, 80.08480), (12.89050, 80.08100), (12.86450, 80.09000)],
        "closed": True,
    },
}

# Fallback: hand-traced points along the same roads (used only if OSRM fails).
FALLBACK = {
    "fronx": [(12.92330, 80.11820), (12.92650, 80.12050), (12.93050, 80.12380), (12.93620, 80.12930),
              (12.94100, 80.13300), (12.94600, 80.13660), (12.95160, 80.14080)],
    "corolla": [(12.90080, 80.22780), (12.90700, 80.22860), (12.91400, 80.22950), (12.92120, 80.23060),
                (12.92900, 80.23250), (12.93500, 80.23380), (12.94100, 80.23540)],
    "veyron": [(12.98400, 80.25850), (12.97000, 80.25700), (12.94920, 80.25470), (12.92800, 80.25200),
               (12.90600, 80.24900), (12.88400, 80.24700), (12.86200, 80.24500), (12.83800, 80.24400),
               (12.81450, 80.24300)],
    "omni": [(13.05950, 80.25120), (13.05200, 80.25000), (13.04420, 80.24880), (13.04250, 80.24250),
             (13.04080, 80.23610), (13.04130, 80.23380), (13.04700, 80.23900), (13.05300, 80.24350)],
    "roadster": [(13.07150, 80.28620), (13.06400, 80.28420), (13.05650, 80.28220), (13.04850, 80.28080),
                 (13.04050, 80.27960)],
    "live": [(12.87489, 80.08480), (12.87900, 80.08380), (12.88500, 80.08230), (12.89050, 80.08100),
             (12.88000, 80.08400), (12.87000, 80.08700), (12.86450, 80.09000)],
}

OSRM = "https://router.project-osrm.org/route/v1/driving/{coords}?overview=full&geometries=geojson&steps=false"


def osrm_leg(points):
    coords = ";".join(f"{lng:.5f},{lat:.5f}" for lat, lng in points)
    req = urllib.request.Request(OSRM.format(coords=coords), headers={"User-Agent": "fleet-demo-route-builder/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.loads(r.read())
    if data.get("code") != "Ok":
        raise RuntimeError(data.get("code"))
    route = data["routes"][0]
    return [(round(lat, 6), round(lng, 6)) for lng, lat in route["geometry"]["coordinates"]], route["distance"]


def build_routes(refresh=False):
    ROUTES.mkdir(parents=True, exist_ok=True)
    for car, spec in ROUTE_SPECS.items():
        out = ROUTES / f"{car}.json"
        if out.exists() and not refresh:
            print(f"[routes] {car}: kept existing {out.name}")
            continue
        try:
            if spec.get("closed"):
                coords, dist = osrm_leg(spec["points"] + [spec["points"][0]])
            else:
                there, d1 = osrm_leg(spec["points"])
                time.sleep(1.0)
                back, d2 = osrm_leg(list(reversed(spec["points"])))
                coords, dist = there + back[1:], d1 + d2
            source = "OSRM (router.project-osrm.org), fetched " + time.strftime("%Y-%m-%d")
        except Exception as e:  # noqa: BLE001
            print(f"[routes] {car}: OSRM failed ({e}) -- using hand-written waypoints")
            pts = FALLBACK[car]
            coords = pts + list(reversed(pts))[1:] if not spec.get("closed") else pts + [pts[0]]
            dist = None
            source = "hand-written"
        out.write_text(json.dumps({
            "vehicle_id": car, "label": spec["label"], "source": source,
            "loop": True, "distance_m": round(dist) if dist else None,
            "attribution": "Route geometry (c) OpenStreetMap contributors, via OSRM" if dist else None,
            "coords": coords,
        }, indent=None, separators=(",", ":")))
        print(f"[routes] {car}: {len(coords)} points, {round(dist or 0)} m, {source}")
        time.sleep(1.0)


def find_largest_decoded_csv():
    best, best_rows = None, -1
    for p in (ROOT / "logs").rglob("decoded*.csv"):
        with open(p, newline="", encoding="utf-8", errors="ignore") as f:
            n = sum(1 for _ in f) - 1
        if n > best_rows:
            best, best_rows = p, n
    return best, best_rows


def _num(s, cast=float):
    if s in ("", "None", None):
        return None
    try:
        return cast(s)
    except ValueError:
        return None


def build_fronx_recorded():
    out = DATA / "fronx_recorded.json"
    src, n = find_largest_decoded_csv()
    if src is None:
        if out.exists():
            print("[fronx] no CSV under logs/, keeping existing fronx_recorded.json")
            return
        raise SystemExit("[fronx] no decoded CSV under logs/ and no fronx_recorded.json")
    rows = []
    t0 = None
    with open(src, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            ts = _num(r.get("ts_ms"), int)
            if ts is None:
                continue
            t0 = ts if t0 is None else t0
            # battery_v is not a CSV column; it is in the logged 32-byte packet (ATRV).
            battery = None
            try:
                battery = unpack_packet(bytes.fromhex(r["packet_hex"].replace(" ", "")))["vehicle"]["battery_v"]
            except Exception:  # noqa: BLE001
                pass
            mil = r.get("mil_on")
            rows.append({
                "t_ms": ts - t0,
                "rpm": _num(r.get("rpm")),
                "speed_kmh": _num(r.get("speed_kmh"), lambda v: int(float(v))),
                "coolant_c": _num(r.get("coolant_c")),
                "engine_load_pct": _num(r.get("engine_load_pct")),
                "throttle_pct": _num(r.get("throttle_pct")),
                "fuel_level_pct": _num(r.get("fuel_level_pct")),
                "maf_gps": _num(r.get("maf_gps")),
                "intake_temp_c": _num(r.get("intake_temp_c")),
                "ambient_temp_c": _num(r.get("ambient_temp_c")),
                "map_kpa": _num(r.get("map_kpa")),
                "mil_on": None if mil in ("", "None", None) else mil == "True",
                "dtc_count": _num(r.get("dtc_count"), int),
                "battery_v": battery,
            })
    fields = [k for k in rows[0] if k != "t_ms"]
    present = {k: sum(1 for x in rows if x[k] is not None) for k in fields}
    doc = {
        "description": "Real OBD-II session from the team's Maruti Suzuki Fronx, engine fields only. "
                       "Timestamps re-based to start at 0 ms. Extracted by demo/simulator/build_data.py.",
        "recorded_on": src.parent.parent.name,
        "rows": len(rows),
        "duration_s": round(rows[-1]["t_ms"] / 1000),
        "has_gps": False,
        "notes": [
            "Stationary session: speed_kmh is 0 in every row (engine idling, car parked).",
            "coolant_c and fuel_level_pct are empty in every row of this session.",
            "battery_v comes from the logged 32-byte packet (ELM327 ATRV), not a CSV column.",
            "There is no GPS in this log; the demo parks the car at a fixed, simulated position.",
        ],
        "fields_present": present,
        "samples": rows,
    }
    DATA.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, separators=(",", ":")))
    print(f"[fronx] {src.relative_to(ROOT)} ({n} rows) -> {out.relative_to(ROOT)}; present: {present}")


def build_bundle():
    routes = {p.stem: json.loads(p.read_text()) for p in sorted(ROUTES.glob("*.json"))}
    fronx = json.loads((DATA / "fronx_recorded.json").read_text())
    BUNDLE.parent.mkdir(parents=True, exist_ok=True)
    BUNDLE.write_text(
        "// Generated by demo/simulator/build_data.py -- do not edit by hand.\n"
        "// Same data as demo/data/, for the dashboard's standalone mode.\n"
        "window.DEMO_DATA = " + json.dumps({"routes": routes, "fronx_recorded": fronx}, separators=(",", ":")) + ";\n",
        encoding="utf-8")
    print(f"[bundle] {BUNDLE.relative_to(ROOT)} ({BUNDLE.stat().st_size // 1024} KB)")
    # Level 2 driver console: only the live loop, so a phone on a hotspot loads ~15 KB, not the bundle.
    live = routes.get("live")
    if live:
        LIVE_BUNDLE.parent.mkdir(parents=True, exist_ok=True)
        LIVE_BUNDLE.write_text(
            "// Generated by demo/simulator/build_data.py -- do not edit by hand.\n"
            "window.LIVE_ROUTE = " + json.dumps(live, separators=(",", ":")) + ";\n", encoding="utf-8")
        print(f"[bundle] {LIVE_BUNDLE.relative_to(ROOT)} ({LIVE_BUNDLE.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    build_fronx_recorded()
    build_routes(refresh="--refresh" in sys.argv)
    build_bundle()
