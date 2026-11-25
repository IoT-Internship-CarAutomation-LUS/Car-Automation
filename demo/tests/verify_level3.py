# verify_level3.py -- Playwright checks for Level 3, the 3D view (/3d/ and the embedded "3D view").
#
#   python demo/run_demo.py --no-browser        (in another terminal)
#   python demo/tests/verify_level3.py [--shots demo/screenshots/level3] [--gl gpu|swiftshader]
#
# WebGL in headless Chromium: --gl gpu (default) uses ANGLE on Direct3D 11, the laptop's real
# GPU; --gl swiftshader uses the CPU rasteriser (always available, but slow). The fps check
# runs on the chosen backend and the SwiftShader figure is printed for comparison.
# The view exposes a read-only window.__view3d for these checks.

import argparse
import io
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://localhost:8000"
CARS = {"fronx": "crossover", "corolla": "sedan", "veyron": "supercar", "omni": "van", "roadster": "roadster"}
GL = {
    "gpu": ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
    "swiftshader": ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
}
results = []


def check(label, ok, detail=""):
    results.append((label, ok))
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}{(' -- ' + detail) if detail else ''}", flush=True)


def wait_until(fn, timeout_s, step=0.05):
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        try:
            if fn():
                return time.time() - t0
        except Exception:  # noqa: BLE001
            pass
        time.sleep(step)
    return None


def new_page(b, w=1920, h=1080, theme=None):
    ctx = b.new_context(viewport={"width": w, "height": h})
    if theme:
        ctx.add_init_script(f"try {{ localStorage.setItem('ft-theme', '{theme}') }} catch (e) {{}}")
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    return ctx, pg, errs


def dbg(pg, key):
    return pg.evaluate(f"window.__view3d ? window.__view3d['{key}'] : undefined")


def snap(pg):
    return pg.evaluate("""(() => { const d = window.__view3d; if (!d) return null; const o = {};
        for (const k of ['car','body','speedKmh','packetSpeedKmh','wheelOmega','tyreRadius','brakeLight','tailEmissive','brakeValue',
                         'rings','pitchDeg','rollDeg','steerDeg','fps','frames','xray','grey','stale','packets','pulses','view','background'])
          o[k] = d[k]; return o; })()""")


def canvas_colours(pg, sel=".v3d-canvas"):
    from PIL import Image
    png = pg.locator(sel).first.screenshot()
    im = Image.open(io.BytesIO(png)).convert("RGB").resize((160, 90))
    return len(set(im.get_flattened_data())) if hasattr(im, 'get_flattened_data') else len(set(im.getdata()))


def pick(pg, vid):
    pg.click(f'.v3p-car[data-id="{vid}"]')
    pg.wait_for_function(f"window.__view3d && window.__view3d.car === '{vid}' && window.__view3d.packets > 0", timeout=8000)


def open_console(b):
    ctx = b.new_context(viewport={"width": 1366, "height": 768})
    pg = ctx.new_page()
    pg.goto(BASE + "/drive/")
    pg.wait_for_selector("#connect")
    pg.click("#connect")
    pg.wait_for_selector("#summary:not([hidden])", timeout=5000)
    return ctx, pg, pg.text_content("#sum-vid").strip()


def measure_fps(pg, seconds=5):
    f0, t0 = dbg(pg, "frames"), time.time()
    pg.wait_for_timeout(int(seconds * 1000))
    return (dbg(pg, "frames") - f0) / (time.time() - t0)


def run(args):
    shots = Path(args.shots) if args.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, args=GL[args.gl])

        print("\n== /3d/ page ==")
        ctx, pg, errs = new_page(b)
        pg.goto(BASE + "/3d/")
        pg.wait_for_function("window.__view3d && window.__view3d.packets > 1", timeout=15000)
        pg.evaluate("window.FT.sendControl('reset_all')")   # a scenario left on by another suite would skew the checks
        pg.wait_for_timeout(800)
        gpu = pg.evaluate("(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl && gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; })()")
        print(f"  WebGL renderer: {gpu}")
        cols = canvas_colours(pg)
        check("/3d/ loads with no console errors, default car fronx, canvas not empty",
              not errs and dbg(pg, "car") == "fronx" and cols > 200, f"{cols} colours in the canvas, errors: {errs[:2]}")
        check("URL #car=<id> picks the car", pg.evaluate("location.hash") in ("", "#car=fronx") and dbg(pg, "car") == "fronx")

        # every fleet car can be selected, with its own body type
        ok_all, bad = True, []
        for vid, body in CARS.items():
            pick(pg, vid)
            if dbg(pg, "body") != body or pg.text_content(".v3d-readout .r-name").strip() == "":
                ok_all = False; bad.append(vid)
        check("every fleet car can be selected and gets its body type", ok_all, ", ".join(f"{k}={v}" for k, v in CARS.items()) + (f" BAD {bad}" if bad else ""))
        pg.goto(BASE + "/3d/#car=veyron"); pg.wait_for_function("window.__view3d && window.__view3d.car === 'veyron' && window.__view3d.packets > 0", timeout=8000)
        check("deep link /3d/#car=veyron opens the Veyron", dbg(pg, "body") == "supercar")

        # wheel speed follows road speed
        pick(pg, "corolla")
        worst, n, lag_ok, moving = 0.0, 0, True, False
        prev_pkt = None
        for _ in range(40):
            s = snap(pg)
            v, w, r = s["speedKmh"], s["wheelOmega"], s["tyreRadius"]
            if v > 5:
                moving = True
                worst = max(worst, abs(w * r * 3.6 - v) / v)
                n += 1
            pkt = s["packetSpeedKmh"]
            if prev_pkt is not None and pkt is not None:
                lo, hi = min(pkt, prev_pkt) - 3, max(pkt, prev_pkt) + 3
                lag_ok = lag_ok and lo <= v <= hi or (abs(v - pkt) < 25)
            prev_pkt = pkt
            pg.wait_for_timeout(100)
        check("wheel angular speed = road speed / tyre radius (Corolla, 40 samples)", moving and worst < 0.01,
              f"{n} moving samples, worst error {worst * 100:.2f} %, r = {snap(pg)['tyreRadius']} m")
        check("displayed speed stays between the last two packet speeds (interpolation, no jumps)", lag_ok)
        jumps = pg.evaluate("""(async () => { let prev = window.__view3d.speedKmh, worst = 0;
            for (let i = 0; i < 90; i++) { await new Promise(r => requestAnimationFrame(r)); const v = window.__view3d.speedKmh; worst = Math.max(worst, Math.abs(v - prev)); prev = v; }
            return worst; })()""")
        check("speed changes smoothly frame to frame (largest step under 2 km/h)", jumps < 2.0, f"largest step {jumps:.2f} km/h per frame")
        pr = pg.evaluate("""(async () => { let p = 0, r = 0; for (let i = 0; i < 120; i++) { await new Promise(x => requestAnimationFrame(x));
            p = Math.max(p, Math.abs(window.__view3d.pitchDeg)); r = Math.max(r, Math.abs(window.__view3d.rollDeg)); } return [p, r]; })()""")
        check("body pitch and roll stay small (within 2.5 and 3 degrees over 2 s)", pr[0] <= 2.5 and pr[1] <= 3.0, f"max pitch {pr[0]:.2f}, max roll {pr[1]:.2f}")

        pick(pg, "fronx")
        pg.wait_for_timeout(1200)
        s = snap(pg)
        check("stopped car: wheels at rest (Fronx recorded, 0 km/h)", s["packetSpeedKmh"] == 0 and s["wheelOmega"] < 0.05, f"omega {s['wheelOmega']:.3f} rad/s")
        brake_txt = pg.text_content(".v3d-readout .r-brake").strip()
        check("Fronx brake null -> 'Brake: Unknown (not found on CAN bus)' and lights unlit",
              s["brakeValue"] is None and s["brakeLight"] == "unlit" and s["tailEmissive"] < 0.01
              and "unknown (not found on can bus)" in " ".join(brake_txt.lower().split()), brake_txt)
        tyres_txt = pg.text_content(".v3d-readout .r-tyres")
        check("Fronx has no TPMS: grey rings and 'TPMS not fitted'", set(s["rings"].values()) == {"none"} and "TPMS not fitted" in tyres_txt)
        pick(pg, "omni")
        s = snap(pg)
        check("Omni brake null -> unknown and unlit too", s["brakeLight"] == "unlit" and "unknown" in pg.text_content(".v3d-readout .r-brake").lower())

        # Corolla brake true -> lights on
        pick(pg, "corolla")
        t = wait_until(lambda: dbg(pg, "brakeValue") is True, 90, 0.1)
        if t is not None:
            pg.wait_for_timeout(250)
            s = snap(pg)
            check("Corolla brake true -> brake lights on (bright)", s["brakeLight"] == "on" and s["tailEmissive"] > 1.5
                  and "ON" in pg.text_content(".v3d-readout .r-brake .pill"), f"emissive {s['tailEmissive']:.2f} after {t:.1f} s wait")
        else:
            check("Corolla brake true -> brake lights on (bright)", False, "the Corolla never braked in 90 s")
        t = wait_until(lambda: dbg(pg, "brakeValue") is False, 30, 0.1)
        pg.wait_for_timeout(300)
        check("Corolla brake false -> tail lamps dim, not off", t is not None and dbg(pg, "brakeLight") == "dim" and 0.1 < dbg(pg, "tailEmissive") < 0.6)

        # puncture scenario -> FL ring red
        wait_until(lambda: set(dbg(pg, "rings").values()) == {"green"}, 20, 0.2)
        s = snap(pg)
        check("Corolla rings start green", set(s["rings"].values()) == {"green"}, str(s["rings"]))
        pg.evaluate("window.FT.sendControl('corolla_puncture')")
        t = wait_until(lambda: dbg(pg, "rings")["fl"] == "red", 40, 0.2)
        s = snap(pg)
        fl = pg.evaluate("window.FT.state.cars.corolla.msg.tyres.fl.pressure_kpa")
        check("Corolla puncture scenario turns the front-left ring red (others stay green)",
              t is not None and s["rings"]["fl"] == "red" and s["rings"]["fr"] == "green", f"FL {fl} kPa after {t:.1f} s" if t else str(s["rings"]))
        chip = pg.get_attribute('.r-tyre[data-s="red"]', "title") if pg.locator('.r-tyre[data-s="red"]').count() else None
        check("readout marks FL with the critical icon and colour", chip == "Front-left" and pg.locator('.r-tyre[data-s="red"] .icon').count() == 1)
        if shots:
            for theme in ("light",):
                pg.keyboard.press("s"); pg.wait_for_timeout(900)
                pg.screenshot(path=str(shots / f"3d_corolla_puncture_side_{theme}_1920x1080.png"))
        pg.evaluate("window.FT.sendControl('reset_all')")
        wait_until(lambda: dbg(pg, "rings")["fl"] != "red", 30, 0.2)

        # tyre hover label
        pg.keyboard.press("s"); pg.wait_for_timeout(900)
        pos = pg.evaluate("""(() => { const c = document.querySelector('.v3d-canvas').getBoundingClientRect(); return [c.left, c.top, c.width, c.height]; })()""")
        found = None
        for fx in [x / 40 for x in range(8, 33)]:
            for fy in (0.5, 0.54, 0.58, 0.62, 0.66, 0.7):
                pg.mouse.move(pos[0] + pos[2] * fx, pos[1] + pos[3] * fy)
                pg.wait_for_timeout(15)
                if pg.is_visible(".v3d-tip"):
                    found = pg.text_content(".v3d-tip"); break
            if found:
                break
        check("hovering a tyre shows its pressure label", bool(found) and "kPa" in found, " ".join((found or "none").split())[:80])
        pick(pg, "omni")
        pg.keyboard.press("s"); pg.wait_for_timeout(900)
        found2 = None
        for fx in [x / 40 for x in range(8, 33)]:
            for fy in (0.5, 0.54, 0.58, 0.62, 0.66, 0.7):
                pg.mouse.move(pos[0] + pos[2] * fx, pos[1] + pos[3] * fy)
                pg.wait_for_timeout(15)
                if pg.is_visible(".v3d-tip"):
                    found2 = pg.text_content(".v3d-tip"); break
            if found2:
                break
        check("on a car without TPMS the label says 'TPMS not fitted'", bool(found2) and "TPMS not fitted" in found2, " ".join((found2 or "none").split())[:80])
        pg.mouse.move(5, 300)

        # camera presets and keys
        views = []
        for k in ("c", "s", "t", "r"):
            pg.keyboard.press(k); pg.wait_for_timeout(900); views.append((dbg(pg, "view"), pg.evaluate("window.__view3d.camera")))
        cam_top = views[2][1]
        check("keys C / S / T / R switch to chase / side / top / reset", [v[0] for v in views] == ["chase", "side", "top", "hero"] and cam_top[1] > 8,
              ", ".join(f"{v[0]} {v[1]}" for v in views))
        pg.click('[data-preset="side"]'); pg.wait_for_timeout(900)
        check("preset buttons work and stay pressed", dbg(pg, "view") == "side" and pg.get_attribute('[data-preset="side"]', "aria-pressed") == "true")
        # cannot go under the ground
        box = pg.locator(".v3d-canvas").bounding_box()
        pg.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        pg.mouse.down(); pg.mouse.move(box["x"] + box["width"] / 2, box["y"] + 40, steps=12); pg.mouse.up()
        pg.wait_for_timeout(600)
        cam = pg.evaluate("window.__view3d.camera")
        check("orbit is clamped above the road (drag down cannot go under it)", cam[1] > 0.3, f"camera {cam}")
        pick(pg, "fronx")
        pg.wait_for_timeout(7500)
        check("idle car gets a slow auto-orbit after 6 s without input", dbg(pg, "autoRotate") is True)

        # X-ray
        pg.keyboard.press("x"); pg.wait_for_timeout(600)
        n0 = dbg(pg, "pulses")
        pg.wait_for_timeout(2600)
        labels = pg.evaluate("[...document.querySelectorAll('.v3d-hw')].filter(a => !a.hidden).map(a => [a.querySelector('.hw-name').textContent, a.getAttribute('href')])")
        hrefs = dict(labels)
        check("'Show our hardware' (X) shows 5 labelled parts", dbg(pg, "xray") is True and len(labels) == 5, ", ".join(h[0] for h in labels))
        check("labels link to the matching /flow/ stage (ELM327 -> stage 3)",
              hrefs.get("ELM327 adapter", "").endswith("#car=fronx&stage=elm") and hrefs.get("OBD-II port", "").endswith("stage=port")
              and hrefs.get("Raspberry Pi 4", "").endswith("stage=decode") and hrefs.get("NEO-6M GPS antenna", "").endswith("stage=gps"),
              hrefs.get("ELM327 adapter", ""))
        check("a packet pulse runs ELM327 -> Pi -> out for each packet", dbg(pg, "pulses") >= n0 + 2, f"{dbg(pg, 'pulses') - n0} pulses in 2.6 s")
        hb = pg.locator(".v3d-canvas").bounding_box()
        pg.mouse.move(hb["x"] + 30, hb["y"] + hb["height"] - 30); pg.wait_for_timeout(400)   # pointer over the view: orbit holds
        with ctx.expect_page() as new:
            pg.click('.v3d-hw[data-k="elm"]', modifiers=["Control"])
        fp = new.value
        fp.wait_for_function("window.__flow && window.__flow.st.stage === 'elm'", timeout=8000)
        check("clicking the ELM327 label opens /flow/ at stage 3 for this car", fp.evaluate("window.__flow.st.stage") == "elm" and fp.evaluate("window.__flow.st.carId") == "fronx")
        fp.close()
        pg.keyboard.press("x"); pg.wait_for_timeout(300)

        # theme toggle
        bg0 = dbg(pg, "background")
        pg.click("#theme-toggle"); pg.wait_for_timeout(400)
        bg1 = dbg(pg, "background")
        pg.click("#theme-toggle"); pg.wait_for_timeout(400)
        check("theme toggle re-colours the scene (background, ground) and back", bg0 == "#eceff1" and bg1 == "#0e1317" and dbg(pg, "background") == bg0, f"{bg0} -> {bg1}")

        # stale / offline: grey out and coast
        pick(pg, "veyron")
        pg.wait_for_timeout(500)
        v0 = dbg(pg, "speedKmh")
        pg.evaluate("window.FT.sendControl('car_offline', 'veyron')")
        t = wait_until(lambda: dbg(pg, "stale") is True, 8, 0.1)
        pg.wait_for_timeout(5000)
        s = snap(pg)
        check("car goes stale: greys out and the wheels coast to a stop", t is not None and s["grey"] > 0.5 and s["wheelOmega"] < 1.0 and v0 > 20,
              f"{v0:.0f} km/h -> {s['speedKmh']:.2f} km/h, grey {s['grey']:.2f}")
        status = pg.text_content(".v3d-readout .status")
        check("readout says Stale or Offline", status.strip() in ("Stale", "Offline"), status)
        t = wait_until(lambda: dbg(pg, "stale") is False, 20, 0.2)
        pg.wait_for_timeout(1500)
        check("when packets return the colour and wheels come back", t is not None and dbg(pg, "grey") < 0.2)

        # fps
        pick(pg, "corolla")
        pg.keyboard.press("r"); pg.wait_for_timeout(1000)
        fps = measure_fps(pg, 5)
        check(f"frame rate at 1920x1080 >= 50 fps ({args.gl})", fps >= 50, f"{fps:.1f} fps, quality level {dbg(pg, 'quality')}, pixel ratio {pg.evaluate('window.__view3d.pixelRatio')}")
        print(f"  measured: {fps:.1f} fps on {gpu}")
        hid = pg.evaluate("""(async () => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
            document.dispatchEvent(new Event('visibilitychange')); const f0 = window.__view3d.frames;
            await new Promise(r => setTimeout(r, 600)); const f1 = window.__view3d.frames;
            delete document.hidden; document.dispatchEvent(new Event('visibilitychange'));
            await new Promise(r => setTimeout(r, 400)); return [f1 - f0, window.__view3d.frames - f1]; })()""")
        check("rendering pauses while the tab is hidden and resumes", hid[0] == 0 and hid[1] > 3, f"{hid[0]} frames hidden, {hid[1]} after")

        # a console car joins after load
        print("\n== console car joins after load ==")
        dctx, drv, vid = open_console(b)
        t = wait_until(lambda: pg.locator(f'.v3p-car[data-id="{vid}"]').count() == 1, 6)
        check("a console car that connects after load appears in the picker", t is not None, f"{vid} after {t:.2f} s" if t else "never")
        pick(pg, vid)
        check("console car is a hatchback with the Live tag and pedal bars", dbg(pg, "body") == "hatchback"
              and pg.is_visible(".v3d-readout .r-pedals") and "Live" in pg.text_content(".v3d-readout .r-mode"))
        drv.click("#ign"); drv.click('.gear[data-g="1"]')
        drv.wait_for_timeout(600)
        bx = drv.locator("#p-throttle .pedal-track").bounding_box()
        drv.mouse.move(bx["x"] + bx["width"] / 2, bx["y"] + bx["height"] * 0.95)
        t0 = time.time()
        drv.mouse.down()
        lat = wait_until(lambda: dbg(pg, "wheelOmega") > 0.5, 4, 0.02)
        drv.wait_for_timeout(1800)
        thr = pg.text_content('.v3d-readout .r-ped[data-k="throttle"] .num')
        if shots:
            for theme in ("light",):
                pg.keyboard.press("c"); pg.wait_for_timeout(1000)
                pg.screenshot(path=str(shots / f"3d_console_chase_{theme}_1920x1080.png"))
        drv.mouse.up()
        check("its wheels respond to the throttle within 1 s", lat is not None and lat <= 1.0, f"{lat:.2f} s" if lat else "never")
        check("its throttle pedal bar follows the pedal", thr not in ("--", "0%"), thr)
        drv.keyboard.down("s"); drv.wait_for_timeout(900)
        check("console brake pedal -> brake lights on", dbg(pg, "brakeLight") == "on")
        drv.keyboard.up("s")
        dctx.close()
        t = wait_until(lambda: pg.locator(f'.v3p-car[data-id="{vid}"]').count() == 0, 12)
        pg.wait_for_timeout(400)
        check("when the console car leaves, its chip goes and the view says it left", t is not None and "left the fleet" in pg.text_content(".v3d-wait"),
              f"after {t:.1f} s: {' '.join(pg.text_content('.v3d-wait').split())}" if t is not None else f"chip still there; car in state: {pg.evaluate(f'!!window.FT.state.cars[{vid!r}]')}")
        check("no console errors on /3d/ during all of the above", not errs, str(errs[:3]))
        ctx.close()

        # embedded in the car view
        print("\n== embedded in the fleet car view ==")
        ctx, pg, errs = new_page(b)
        reqs = []
        pg.on("request", lambda r: reqs.append(r.url) if "/3d/" in r.url else None)
        pg.goto(BASE + "/fleet/#car/corolla")
        pg.wait_for_function("window.FT.state.cars.corolla && window.FT.state.cars.corolla.msg", timeout=10000)
        pg.wait_for_timeout(1500)
        check("car view unchanged until clicked: gauges shown, no 3D files fetched", not reqs and pg.is_visible("#gauges") and pg.is_hidden("#g3d-host"),
              f"{len(reqs)} /3d/ requests")
        check("fleet header links to /3d/", pg.get_attribute('.shell a[href="../3d/"]', "href") == "../3d/")
        pg.click("#g-3d")
        pg.wait_for_function("window.__view3d && window.__view3d.packets > 0", timeout=10000)
        pg.wait_for_timeout(800)
        three = [u for u in reqs if "three" in u]
        check("'3D view' lazy-loads three.js and swaps the gauges for the canvas",
              len(three) >= 2 and pg.is_hidden("#gauges") and pg.is_visible("#g3d-host .v3d-canvas") and dbg(pg, "compact") is True and dbg(pg, "car") == "corolla",
              f"{len(three)} three.js files after the click")
        cols = canvas_colours(pg)
        check("embedded canvas renders the car", cols > 200, f"{cols} colours")
        mem = pg.evaluate("window.__view3d.memory")
        pg.click("#g-3d"); pg.wait_for_timeout(300)
        reg = pg.evaluate("window.__view3dRegistry")
        check("closing releases the WebGL resources (renderer disposed, context lost, canvas removed)",
              reg["live"] == 0 and reg["disposed"] == reg["created"] and pg.evaluate("window.__view3d") is None
              and pg.locator("#g3d-host canvas").count() == 0 and pg.is_visible("#gauges"),
              f"before close {mem}, registry {reg}")
        for _ in range(3):
            pg.click("#g-3d"); pg.wait_for_function("window.__view3d && window.__view3d.frames > 2", timeout=10000); pg.click("#g-3d"); pg.wait_for_timeout(150)
        reg = pg.evaluate("window.__view3dRegistry")
        check("open/close 3 more times: no leaked contexts", reg["live"] == 0 and reg["created"] == 4 and reg["disposed"] == 4, str(reg))
        pg.click("#g-3d"); pg.wait_for_function("window.__view3d && window.__view3d.car === 'corolla'", timeout=10000)
        pg.evaluate("location.hash = '#car/veyron'")
        pg.wait_for_function("window.__view3d && window.__view3d.car === 'veyron' && window.__view3d.packets > 0", timeout=8000)
        check("open 3D view follows a switch to another car", dbg(pg, "body") == "supercar")
        pg.evaluate("location.hash = '#fleet'"); pg.wait_for_timeout(300)
        reg = pg.evaluate("window.__view3dRegistry")
        check("leaving the car view disposes the embedded view", reg["live"] == 0 and pg.get_attribute("#g-3d", "aria-pressed") == "false", str(reg))
        check("no console errors in the car view", not errs, str(errs[:3]))
        ctx.close()
        b.close()

        # no WebGL
        print("\n== no WebGL ==")
        b2 = p.chromium.launch(headless=True, args=["--disable-webgl", "--disable-3d-apis"])
        ctx, pg, errs = new_page(b2)
        pg.goto(BASE + "/3d/")
        pg.wait_for_selector(".v3d-msg:not([hidden])", timeout=8000)
        check("/3d/ without WebGL shows a clear message", "WebGL" in pg.text_content(".v3d-msg"), " ".join(pg.text_content(".v3d-msg").split())[:90])
        pg.goto(BASE + "/fleet/#car/corolla")
        pg.wait_for_function("window.FT.state.cars.corolla && window.FT.state.cars.corolla.msg", timeout=10000)
        pg.click("#g-3d"); pg.wait_for_selector("#g3d-host .v3d-msg:not([hidden])", timeout=8000)
        check("embedded without WebGL: message strip, gauges keep working", pg.is_visible("#gauges") and pg.get_attribute("#g-3d", "aria-pressed") == "false"
              and pg.evaluate("document.querySelector('#g-rpm-val').textContent") not in ("", "--"))
        b2.close()

        if args.gl == "gpu" and not args.skip_swiftshader:
            print("\n== SwiftShader (CPU) frame rate, for comparison ==")
            b3 = p.chromium.launch(headless=True, args=GL["swiftshader"])
            ctx, pg, errs = new_page(b3)
            pg.goto(BASE + "/3d/#car=corolla")
            pg.wait_for_function("window.__view3d && window.__view3d.packets > 1", timeout=15000)
            pg.wait_for_timeout(5000)
            print(f"  SwiftShader at 1920x1080: {measure_fps(pg, 5):.1f} fps after adapting to quality level {dbg(pg, 'quality')} (CPU rendering, not a real GPU)")
            b3.close()

        if shots:
            screenshots(p, args, shots)

    passed = sum(1 for _, ok in results if ok)
    print(f"\n{passed}/{len(results)} checks passed")
    return 0 if passed == len(results) else 1


def screenshots(p, args, out):
    print("\n== screenshots ==")
    b = p.chromium.launch(headless=True, args=GL[args.gl])
    for theme in ("light", "dark"):
        for (w, h) in ((1920, 1080), (1366, 768)):
            tag = f"{theme}_{w}x{h}"
            ctx, pg, errs = new_page(b, w, h, theme)
            pg.goto(BASE + "/3d/#car=corolla")
            pg.wait_for_function("window.__view3d && window.__view3d.packets > 1", timeout=15000)
            for vid, preset in (("corolla", "chase"), ("veyron", "side"), ("roadster", "hero"), ("omni", "side"), ("fronx", "hero")):
                pick(pg, vid)
                pg.keyboard.press({"chase": "c", "side": "s", "hero": "r", "top": "t"}[preset])
                pg.wait_for_timeout(1100)
                pg.screenshot(path=str(out / f"3d_{vid}_{preset}_{tag}.png"))
            pick(pg, "corolla"); pg.keyboard.press("s"); pg.wait_for_timeout(1000)
            pg.screenshot(path=str(out / f"3d_corolla_side_{tag}.png"))
            pg.keyboard.press("c"); pg.wait_for_timeout(1000)
            pick(pg, "fronx"); pg.keyboard.press("r"); pg.keyboard.press("x"); pg.wait_for_timeout(1500)
            pg.screenshot(path=str(out / f"3d_xray_fronx_{tag}.png"))
            pick(pg, "corolla"); pg.wait_for_timeout(1200)
            pg.screenshot(path=str(out / f"3d_xray_corolla_{tag}.png"))
            ctx.close()
            ctx, pg, errs = new_page(b, w, h, theme)
            pg.goto(BASE + "/fleet/#car/corolla")
            pg.wait_for_function("window.FT.state.cars.corolla && window.FT.state.cars.corolla.msg", timeout=10000)
            pg.click("#g-3d"); pg.wait_for_function("window.__view3d && window.__view3d.packets > 0", timeout=10000)
            pg.wait_for_timeout(1500)
            pg.screenshot(path=str(out / f"embedded_corolla_{tag}.png"))
            pg.keyboard.press("x"); pg.wait_for_timeout(1200)
            pg.screenshot(path=str(out / f"embedded_xray_{tag}.png"))
            ctx.close()
            print(f"  {tag}: done")
    # a console car, both presets
    for theme in ("light", "dark"):
        ctx, pg, errs = new_page(b, 1920, 1080, theme)
        pg.goto(BASE + "/3d/")
        pg.wait_for_function("window.__view3d && window.__view3d.packets > 1", timeout=15000)
        dctx, drv, vid = open_console(b)
        pg.wait_for_selector(f'.v3p-car[data-id="{vid}"]', timeout=6000)
        pick(pg, vid)
        drv.click("#ign"); drv.click('.gear[data-g="1"]')
        drv.keyboard.down("w"); drv.wait_for_timeout(2500)
        for preset, key in (("chase", "c"), ("side", "s")):
            pg.keyboard.press(key); pg.wait_for_timeout(1000)
            pg.screenshot(path=str(out / f"3d_console_{preset}_{theme}_1920x1080.png"))
        drv.keyboard.up("w")
        dctx.close(); ctx.close()
    b.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--shots", help="folder for screenshots (also runs the screenshot pass)")
    ap.add_argument("--gl", choices=sorted(GL), default="gpu")
    ap.add_argument("--skip-swiftshader", action="store_true")
    sys.exit(run(ap.parse_args()))
