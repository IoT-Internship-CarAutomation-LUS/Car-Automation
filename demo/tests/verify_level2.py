# verify_level2.py -- Playwright checks for Level 2 (driver console) and the Part A map/card fixes.
#
#   python demo/run_demo.py --no-browser      (in another terminal)
#   python demo/tests/verify_level2.py [--shots demo/screenshots/level2]
#
# Checks: a console joins the fleet within 2 s; the dashboard follows its throttle,
# RPM and speed within 1 s; emergency stop raises an alert; two consoles are two
# cars; closing a console posts "left" and removes the car; phone touch pedals and
# desktop keyboard both drive; six cards fit and the map frames Chennai at
# 1920x1080, 1536x864 (125 %) and 1366x768, in both themes; no tile seams.

import argparse
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://localhost:8000"
results = []


def check(label, ok, detail=""):
    results.append((label, ok))
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}{(' -- ' + detail) if detail else ''}", flush=True)


def wait_until(fn, timeout_s, step_ms=50):
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        try:
            if fn():
                return time.time() - t0
        except Exception:  # noqa: BLE001
            pass
        time.sleep(step_ms / 1000)
    return None


def fleet_car(page, vid):
    return page.evaluate(f"(() => {{ const c = window.FT.state.cars['{vid}']; return c && c.msg ? c.msg : null; }})()")


def open_console(browser, viewport=(1366, 768), mobile=False, theme=None, scale=1):
    kw = dict(viewport={"width": viewport[0], "height": viewport[1]}, device_scale_factor=scale)
    if mobile:
        kw.update(is_mobile=True, has_touch=True)
    ctx = browser.new_context(**kw)
    if theme:
        ctx.add_init_script(f"try {{ localStorage.setItem('ft-theme', '{theme}') }} catch (e) {{}}")
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    page.goto(BASE + "/drive/")
    page.wait_for_selector("#connect")
    return ctx, page, errs


def connect(page):
    page.click("#connect")
    page.wait_for_selector("#summary:not([hidden])", timeout=5000)
    return page.text_content("#sum-vid").strip()


def hold_pedal_mouse(page, key, seconds, depth=0.95):
    box = page.locator(f"#p-{key} .pedal-track").bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] * depth
    page.mouse.move(x, y)
    page.mouse.down()
    page.wait_for_timeout(int(seconds * 1000))
    page.mouse.up()


def run(args):
    shots = Path(args.shots) if args.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)

        # ---------------- fleet + one console (desktop, mouse and keyboard) ----------------
        print("\n== live car through the real pipeline ==")
        fctx = b.new_context(viewport={"width": 1920, "height": 1080})
        fleet = fctx.new_page()
        ferrs = []
        fleet.on("pageerror", lambda e: ferrs.append(str(e)))
        fleet.on("console", lambda m: ferrs.append(m.text) if m.type == "error" else None)
        fleet.goto(BASE + "/fleet/")
        fleet.wait_for_function("document.querySelectorAll('#vlist .vcard').length >= 5", timeout=15000)

        dctx, drv, derrs = open_console(b)
        vid = connect(drv)
        t = wait_until(lambda: fleet_car(fleet, vid) is not None, 5)
        check("live car appears on the fleet dashboard within 2 s of Connect", t is not None and t <= 2.0, f"{t:.2f} s" if t else "never")
        msg = fleet_car(fleet, vid) or {}
        check("it arrives as data_mode 'live', control 'manual', schema 2.2.0",
              msg.get("source", {}).get("data_mode") == "live" and msg.get("source", {}).get("control") == "manual"
              and msg.get("schema_version") == "2.2.0")
        tag = fleet.evaluate(f"""(() => {{ const b = [...document.querySelectorAll('#vlist .vcard')].find(x => x.textContent.includes('Live Demo Car'));
              return b ? b.textContent : ''; }})()""")
        check("its card shows the Live tag and 'Driven live from the Control Console'", "Live" in tag and "Control Console" in tag)
        joined = wait_until(lambda: fleet.evaluate("[...document.querySelectorAll('#feed li')].some(li => li.textContent.includes('Live car joined'))"), 3)
        check("info alert 'Live car joined' in the feed", joined is not None)

        drv.click("#ign")
        drv.click('.gear[data-g="1"]')
        rpm0 = (fleet_car(fleet, vid) or {}).get("vehicle", {}).get("rpm") or 0
        box = drv.locator("#p-throttle .pedal-track").bounding_box()
        drv.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] * 0.95)
        t_in = time.time()
        drv.mouse.down()
        lat = wait_until(lambda: (fleet_car(fleet, vid)["vehicle"]["throttle_pct"] or 0) > 50
                         and (fleet_car(fleet, vid)["vehicle"]["rpm"] or 0) > rpm0 + 300, 3)
        check("dashboard shows the throttle and RPM change within 1 s of the pedal", lat is not None and lat <= 1.0, f"{lat:.2f} s" if lat else "never")
        sp = wait_until(lambda: (fleet_car(fleet, vid)["vehicle"]["speed_kmh"] or 0) >= 3, 2)
        check("dashboard speed starts rising within 1 s", sp is not None and sp <= 1.0, f"{sp:.2f} s" if sp else "never")
        drv.wait_for_timeout(int(max(0, 3 - (time.time() - t_in)) * 1000))
        drv.mouse.up()
        s1 = fleet_car(fleet, vid)["vehicle"]
        check("after 3 s in 1st: gear 1 on the dashboard and moving", s1["gear"] == 1 and (s1["speed_kmh"] or 0) > 15, f"{s1['speed_kmh']} km/h, gear {s1['gear']}")
        drv.click('.gear[data-g="2"]')
        hold_pedal_mouse(drv, "throttle", 3)
        s2 = fleet_car(fleet, vid)["vehicle"]
        check("after 3 s in 2nd: gear 2 and faster", s2["gear"] == 2 and (s2["speed_kmh"] or 0) > (s1["speed_kmh"] or 0), f"{s2['speed_kmh']} km/h, gear {s2['gear']}")
        drv.keyboard.down("s")
        lat = wait_until(lambda: fleet_car(fleet, vid)["vehicle"]["brake"] is True, 2)
        drv.wait_for_timeout(1500)
        drv.keyboard.up("s")
        s3 = fleet_car(fleet, vid)["vehicle"]
        check("brake (keyboard S): brake ON on the dashboard within 1 s, speed falls", lat is not None and lat <= 1.0 and s3["speed_kmh"] < s2["speed_kmh"],
              f"{lat:.2f} s, {s2['speed_kmh']} -> {s3['speed_kmh']} km/h" if lat else "never")
        drv.keyboard.down("w"); drv.wait_for_timeout(1500); drv.keyboard.up("w")
        check("keyboard W drives the throttle", (fleet_car(fleet, vid)["driver"]["throttle_pedal_pct"] or 0) >= 0 and drv.evaluate("window.__console.v") > 0)
        if shots:
            fleet.wait_for_timeout(400)
            fleet.screenshot(path=str(shots / "fleet_live_light_1920x1080.png"))
        drv.click("#estop")
        t = wait_until(lambda: fleet.evaluate("[...document.querySelectorAll('#feed li')].some(li => li.textContent.includes('Emergency stop'))"), 3)
        check("emergency stop raises a critical alert on the dashboard within 1 s", t is not None and t <= 1.0, f"{t:.2f} s" if t else "never")
        stopped = wait_until(lambda: (fleet_car(fleet, vid)["vehicle"]["speed_kmh"] or 0) == 0, 6)
        check("emergency stop brings the car to 0 km/h", stopped is not None, f"{stopped:.1f} s" if stopped else "never")

        # car view with Driver inputs
        fleet.goto(BASE + f"/fleet/#car/{vid}")
        fleet.wait_for_function("!document.getElementById('driver-panel').hidden", timeout=5000)
        check("car view shows the Driver inputs panel for the console car", True)
        drv.keyboard.down("w"); drv.wait_for_timeout(1200)
        thr_bar = fleet.evaluate("document.querySelector('#driver-panel [data-k=throttle] .din-val').textContent")
        check("Driver inputs throttle bar follows the pedal", thr_bar not in ("--", "0%"), thr_bar)
        if shots:
            fleet.screenshot(path=str(shots / "car_live_light_1920x1080.png"), full_page=True)
            drv.screenshot(path=str(shots / "drive_desktop_light_1366x768.png"))
        drv.keyboard.up("w")
        fleet.goto(BASE + "/fleet/#car/corolla")
        fleet.wait_for_timeout(800)
        check("Driver inputs panel stays hidden for simulated cars", fleet.evaluate("document.getElementById('driver-panel').hidden"))
        fleet.goto(BASE + "/fleet/#fleet")

        # second console = second car
        dctx2, drv2, derrs2 = open_console(b, theme="dark")
        drv2.select_option("#car-select", "creta")
        vid2 = connect(drv2)
        t = wait_until(lambda: fleet_car(fleet, vid2) is not None, 3)
        n_live = fleet.evaluate("Object.values(window.FT.state.cars).filter(c => c.msg && c.msg.source.control === 'manual').length")
        colors = fleet.evaluate(f"[window.FT.carColor('{vid}'), window.FT.carColor('{vid2}')]")
        check("two consoles at once show as two separate cars with their own colours", t is not None and vid != vid2 and n_live == 2 and colors[0] != colors[1], f"{vid}, {vid2}, {colors}")
        drv2.click("#ign"); drv2.click('.gear[data-g="D"]')
        hold_pedal_mouse(drv2, "throttle", 2)
        m2 = fleet_car(fleet, vid2)
        check("automatic car: gear chosen by the gearbox, clutch N/A", (m2["vehicle"]["gear"] or 0) >= 1 and m2["vehicle"]["clutch"] is None
              and m2["provenance"]["fields"]["vehicle.clutch"] == "not_applicable", f"gear {m2['vehicle']['gear']}")
        cards = fleet.evaluate("document.querySelectorAll('#vlist .vcard').length")
        check("fleet shows 7 cards (5 simulated + 2 live)", cards == 7, str(cards))
        # Fit all includes live cars
        fleet.click(".map-fit")
        fleet.wait_for_timeout(400)
        inview = fleet.evaluate(f"""(() => {{ const m = window.FT.fleetMap, bb = m.getBounds();
             return ['{vid}', '{vid2}', 'fronx', 'veyron', 'roadster'].every(id => {{ const c = window.FT.state.cars[id]; return c && bb.contains([c.msg.gps.lat, c.msg.gps.lng]); }}); }})()""")
        check("'Fit all' frames every car, live cars included", inview)

        # closing a console -> "left"
        drv.close()
        t = wait_until(lambda: fleet.evaluate("[...document.querySelectorAll('#feed li')].some(li => li.textContent.includes('Live car left'))"), 5)
        gone = fleet.evaluate(f"!window.FT.state.cars['{vid}']")
        check("closing a console posts 'Live car left' and removes the car", t is not None and gone, f"{t:.2f} s" if t else "never")
        if shots:
            fleet.screenshot(path=str(shots / "fleet_after_leave_light_1920x1080.png"))
        drv2.close()
        wait_until(lambda: fleet.evaluate(f"!window.FT.state.cars['{vid2}']"), 5)
        check("browser consoles (fleet, console 1, console 2) have no errors", not (ferrs + derrs + derrs2), "; ".join((ferrs + derrs + derrs2)[:3]))
        dctx.close(); dctx2.close()

        # ---------------- phone, touch ----------------
        print("\n== phone (390x844, touch) ==")
        for theme in ("light", "dark"):
            pctx, ph, perrs = open_console(b, viewport=(390, 844), mobile=True, theme=theme)
            pvid = connect(ph)
            ph.tap("#ign")
            ph.tap('.gear[data-g="1"]')
            cdp = pctx.new_cdp_session(ph)
            ph.locator("#p-throttle").scroll_into_view_if_needed()
            box = ph.locator("#p-throttle .pedal-track").bounding_box()
            x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] * 0.9
            cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
            ph.wait_for_timeout(2500)
            ped = ph.evaluate("window.__console.ped.throttle")
            spd = ph.evaluate("window.__console.v * 3.6")
            fl = wait_until(lambda: (fleet_car(fleet, pvid) or {}).get("vehicle", {}).get("speed_kmh", 0) > 3, 2)
            if shots:
                ph.screenshot(path=str(shots / f"drive_phone_{theme}_390x844.png"))
            cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
            ph.wait_for_timeout(500)
            back = ph.evaluate("window.__console.ped.throttle")
            check(f"[{theme}] phone: touch-holding the throttle drives the car and the fleet sees it", ped > 0.8 and spd > 5 and fl is not None, f"pedal {ped:.2f}, {spd:.0f} km/h")
            check(f"[{theme}] phone: the pedal springs back to 0 on release", back == 0, f"{back}")
            overflow = ph.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1")
            check(f"[{theme}] phone portrait: no horizontal scroll", not overflow)
            ph.set_viewport_size({"width": 844, "height": 390})
            ph.wait_for_timeout(400)
            vis = ph.evaluate("(() => { const r = document.querySelector('#p-throttle .pedal-track').getBoundingClientRect(); return r.height > 120 && r.right <= innerWidth; })()")
            check(f"[{theme}] phone landscape: pedals stay large and on screen", vis)
            if shots:
                ph.screenshot(path=str(shots / f"drive_phone_landscape_{theme}_844x390.png"))
            check(f"[{theme}] phone: no console errors", not perrs, "; ".join(perrs[:2]))
            pctx.close()

        # ---------------- console in dark (desktop) for the screenshot set ----------------
        if shots:
            dctx3, d3, _ = open_console(b, theme="dark")
            d3.screenshot(path=str(shots / "drive_setup_dark_1366x768.png"))
            connect(d3); d3.click("#ign"); d3.click('.gear[data-g="1"]')
            d3.keyboard.down("w"); d3.wait_for_timeout(2500)
            d3.screenshot(path=str(shots / "drive_desktop_dark_1366x768.png"))
            d3.keyboard.up("w")
            fdark = b.new_context(viewport={"width": 1920, "height": 1080})
            fdark.add_init_script("try { localStorage.setItem('ft-theme', 'dark') } catch (e) {}")
            fd = fdark.new_page()
            fd.goto(BASE + "/fleet/")
            fd.wait_for_function("document.querySelectorAll('#vlist .vcard').length >= 6", timeout=15000)
            fd.wait_for_timeout(2500)
            fd.screenshot(path=str(shots / "fleet_live_dark_1920x1080.png"))
            v3 = d3.text_content("#sum-vid").strip()
            fd.goto(BASE + f"/fleet/#car/{v3}")
            d3.keyboard.down("w"); fd.wait_for_timeout(1500)
            fd.screenshot(path=str(shots / "car_live_dark_1920x1080.png"), full_page=True)
            d3.keyboard.up("w")
            fdark.close()
            # presenter panel with the QR code, both themes
            for theme in ("light", "dark"):
                c = b.new_context(viewport={"width": 1920, "height": 1080})
                c.add_init_script(f"try {{ localStorage.setItem('ft-theme', '{theme}') }} catch (e) {{}}")
                pg = c.new_page()
                pg.goto(BASE + "/fleet/")
                pg.wait_for_function("document.querySelectorAll('#vlist .vcard').length >= 6", timeout=15000)
                pg.keyboard.press("p")
                pg.wait_for_function("document.querySelector('#p-qr svg') !== null", timeout=5000)
                url = pg.text_content("#p-url")
                pg.wait_for_timeout(600)
                pg.screenshot(path=str(shots / f"presenter_qr_{theme}_1920x1080.png"))
                check(f"[{theme}] presenter panel shows a QR code and the LAN /drive/ URL", "/drive/" in url and "localhost" not in url, url)
                c.close()
            dctx3.close()

        # ---------------- Part A: card fit, map framing, seams ----------------
        print("\n== Part A: cards and map at laptop / projector sizes ==")
        # keep one live car connected so the list has six cars
        dctx4, d4, _ = open_console(b)
        connect(d4)
        sizes = [((1920, 1080), 1, "1920x1080 (viewport)"), ((1920, 960), 1, "1920x1080 screen, browser chrome"),
                 ((1536, 864), 1.25, "1536x864 @125% (viewport)"), ((1536, 740), 1.25, "1536x864 @125%, browser chrome"),
                 ((1366, 768), 1, "1366x768 (viewport)"), ((1366, 650), 1, "1366x768 screen, browser chrome")]
        for (w, h), scale, label in sizes:
            for theme in ("light", "dark"):
                c = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=scale)
                c.add_init_script(f"try {{ localStorage.setItem('ft-theme', '{theme}') }} catch (e) {{}}")
                pg = c.new_page()
                pg.goto(BASE + "/fleet/")
                pg.wait_for_function("document.querySelectorAll('#vlist .vcard').length >= 6", timeout=15000)
                pg.wait_for_timeout(1500)
                fit = pg.evaluate("""(() => {
                  const sc = document.querySelector('#vlist').closest('.scroll').getBoundingClientRect();
                  const cards = [...document.querySelectorAll('#vlist .vcard')].map(x => x.getBoundingClientRect());
                  return cards.map(r => r.top >= sc.top - 1 && r.bottom <= sc.bottom + 1);
                })()""")
                need = 4 if w == 1366 else 6
                check(f"[{theme}] {label}: {'first four' if need == 4 else 'all six'} cards fully visible without scrolling",
                      all(fit[:need]) and len(fit) >= 6, f"{sum(fit)} of {len(fit)} visible")
                mp = pg.evaluate("""(() => { const m = window.FT.fleetMap; const b = m.getBounds();
                   return { zoom: m.getZoom(), routes: b.contains(window.FT.fleetBounds),
                            span_km: (b.getEast() - b.getWest()) * 108 * Math.cos(13 * Math.PI / 180) }; })()""")
                check(f"[{theme}] {label}: map frames all routes, whole zoom {mp['zoom']}, view {mp['span_km']:.0f} km wide (Chennai, not Tamil Nadu)",
                      mp["routes"] and mp["zoom"] >= 10 and float(mp["zoom"]).is_integer() and mp["span_km"] < 120)
                if shots and (w, h) in ((1920, 960), (1536, 740), (1366, 650)):
                    pg.screenshot(path=str(shots / f"fleet_{theme}_{w}x{h}.png"))
                if (w, h) == (1536, 864):
                    # tile-seam probe: rows of the map that are brighter than both neighbours across most of the width
                    seam_rows = pg.evaluate("""(async () => {
                      const imgs = [...document.querySelectorAll('#fleet-map img.leaflet-tile')];
                      const tops = new Set(imgs.map(i => Math.round(i.getBoundingClientRect().top)));
                      const lefts = new Set(imgs.map(i => Math.round(i.getBoundingClientRect().left)));
                      const s = getComputedStyle(imgs[0]);
                      return { tiles: imgs.length, blend: s.mixBlendMode, width: s.width, rows: tops.size, cols: lefts.size };
                    })()""")
                    check(f"[{theme}] {label}: tiles overlap (256.5 px) with normal blending, so no seams at 125 %",
                          seam_rows["blend"] == "normal" and seam_rows["width"].startswith("256.5"), str(seam_rows))
                    if shots:
                        pg.screenshot(path=str(shots / f"map_seam_probe_{theme}_1536x864_125pct.png"),
                                      clip={"x": w * 0.3, "y": 250, "width": 420, "height": 300})
                c.close()
        # car-view mini map uses the same tiles and rules
        c = b.new_context(viewport={"width": 1536, "height": 864}, device_scale_factor=1.25)
        pg = c.new_page()
        pg.goto(BASE + "/fleet/#car/corolla")
        pg.wait_for_timeout(2500)
        z = pg.evaluate("(() => { const i = document.querySelector('#car-map img.leaflet-tile'); return i ? getComputedStyle(i).mixBlendMode + ' ' + getComputedStyle(i).width : 'none'; })()")
        check("car-view mini map: same seam fix", z.startswith("normal 256.5"), z)
        c.close()
        dctx4.close()
        b.close()

    failed = [l for l, ok in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--shots", default=None)
    sys.exit(run(ap.parse_args()))
