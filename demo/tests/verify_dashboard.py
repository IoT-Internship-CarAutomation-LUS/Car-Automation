# verify_dashboard.py -- Playwright checks for the fleet dashboard.
#
#   python demo/run_demo.py --no-browser      (in another terminal)
#   python demo/tests/verify_dashboard.py [--shots demo/screenshots]
#
# Checks: five cars within 5 s, no console errors, every car view renders,
# every presenter scenario raises its alert, standalone mode works.
# Optionally saves the review screenshots (fleet + two car views, light and
# dark, 1366x768 and 1920x1080).

import argparse
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://localhost:8000/fleet/"
CARS = ["fronx", "corolla", "veyron", "omni", "roadster"]
results = []


def check(label, ok, detail=""):
    results.append((label, ok))
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}{(' -- ' + detail) if detail else ''}", flush=True)


def feed_has(page, text, timeout_s):
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        if page.evaluate("(t) => [...document.querySelectorAll('#feed li')].some(li => li.textContent.includes(t))", text):
            return round(time.time() - t0, 1)
        page.wait_for_timeout(500)
    return None


def scenario(page, name, select=None):
    if page.locator("#presenter").is_hidden():
        page.keyboard.press("p")
    if select:
        page.select_option("#p-offline-car", select)
    page.click(f'#presenter .pbtn[data-scenario="{name}"]')


def run_checks(page, errors, mode_label):
    t0 = time.time()
    page.goto(BASE + ("?mode=standalone" if mode_label == "standalone" else ""))
    page.wait_for_function("document.querySelectorAll('#vlist .vcard').length >= 5", timeout=15000)
    dt = time.time() - t0
    check(f"[{mode_label}] all five cars appear within 5 s", dt <= 5.0, f"{dt:.2f} s")
    names = page.eval_on_selector_all("#vlist .vcard-name", "els => els.map(e => e.textContent)")
    check(f"[{mode_label}] cards: {', '.join(names)}", len(names) == 5)
    badge = page.text_content("#demo-badge")
    check(f"[{mode_label}] demo badge computed from data_mode", "1 recorded + 4 simulated" in badge, badge)
    if mode_label == "standalone":
        check("[standalone] 'Standalone mode' badge visible", page.is_visible("#standalone-badge"))
    else:
        check("[live] link shows the backend WebSocket", "Live" in page.text_content("#link-text"))
    page.wait_for_timeout(2500)
    crc = page.text_content("#kpi-crc")
    check(f"[{mode_label}] CRC-8 pass KPI is 100%", crc.strip() == "100%", crc)

    # every car view
    for cid in CARS:
        page.goto(BASE + ("?mode=standalone" if mode_label == "standalone" else "") + "#car/" + cid)
        page.wait_for_function("document.querySelectorAll('#bytes32 .byte').length === 32", timeout=10000)
        name = page.text_content("#car-name")
        tiles = page.locator("#tiles .tile").count()
        unknown = page.locator('#tri .pill[data-v="unknown"]').count()
        nulls_as_zero = page.evaluate("""() => [...document.querySelectorAll('#tiles .tile.is-null .tile-value')]
              .filter(e => /^\\s*(0|OFF|)\\s*$/.test(e.textContent)).length""")
        check(f"[{mode_label}] car view #{cid}: '{name}', {tiles} tiles, {unknown} UNKNOWN pills, no null shown as 0/OFF/blank",
              tiles >= 15 and nulls_as_zero == 0)
        if cid == "fronx":
            check(f"[{mode_label}] Fronx brake/clutch/AC render UNKNOWN (null is never OFF)", unknown == 3)
            check(f"[{mode_label}] Fronx has no TPMS packet", page.locator("#bytes16 .wire-empty").count() == 1)
        if cid == "roadster":
            na = page.locator('#tiles .prov[data-p="not_applicable"]').count()
            check(f"[{mode_label}] Roadster engine fields labelled 'Not applicable (EV)' ({na} tiles)", na >= 6)
            check(f"[{mode_label}] Roadster shows battery charge instead of fuel",
                  page.locator('#tiles [data-k="ev.soc_pct"]').count() == 1 and page.locator('#tiles [data-k="fuel_level_pct"]').count() == 0)
        if cid == "omni":
            ns = page.locator('#tiles .prov[data-p="not_supported"]').count()
            check(f"[{mode_label}] Omni unsupported PIDs labelled 'Not supported' ({ns} tiles)", ns >= 10)
        # byte tooltip
        page.hover("#bytes32 .byte >> nth=4")
        tip = page.text_content("#tooltip") or ""
        check(f"[{mode_label}] #{cid} byte tooltip names the field", "RPM" in tip and "Encoding" in tip, tip[:60].replace("\n", " "))
        page.mouse.move(5, 5)
    page.goto(BASE + ("?mode=standalone" if mode_label == "standalone" else "") + "#car/veyron")
    page.wait_for_function("document.querySelectorAll('#bytes32 .byte').length === 32", timeout=10000)
    # The simulated Veyron reaches 254 km/h only in some cruise phases, so wait up to 3 minutes and,
    # on every sample, check the note matches the speed shown (never shown below 254, never missing at 254).
    t0 = time.time()
    seen, mismatch = False, 0
    while time.time() - t0 < 180 and not seen:
        st = page.evaluate("""(() => { const c = window.FT.state.cars.veyron; const s = c && c.msg ? c.msg.vehicle.speed_kmh : null;
              return { s, shown: !document.getElementById('obd-limit').hidden }; })()""")
        if st["s"] is not None and (st["s"] >= 254) != st["shown"]:
            mismatch += 1
        seen = st["shown"]
        page.wait_for_timeout(500)
    check(f"[{mode_label}] Veyron 'OBD limit' note appears when speed clamps at 254 (and only then)", seen and mismatch <= 1,
          f"after {time.time() - t0:.0f} s, {mismatch} mismatched samples")

    # scenarios
    page.goto(BASE + ("?mode=standalone" if mode_label == "standalone" else "") + "#fleet")
    page.wait_for_function("document.querySelectorAll('#vlist .vcard').length >= 5", timeout=15000)
    page.wait_for_timeout(1500)
    scenario(page, "reset_all")
    page.wait_for_timeout(1500)
    scenario(page, "mil_on")
    check(f"[{mode_label}] scenario mil_on -> Corolla MIL alert", feed_has(page, "Check-engine lamp on, 2 fault codes", 10) is not None)
    scenario(page, "omni_overheat")
    t = feed_has(page, "Coolant", 45)
    check(f"[{mode_label}] scenario omni_overheat -> coolant alert", t is not None, f"{t} s")
    scenario(page, "corolla_puncture")
    t = feed_has(page, "Front-left tyre", 45)
    check(f"[{mode_label}] scenario corolla_puncture -> tyre pressure alert", t is not None, f"{t} s")
    scenario(page, "car_offline", select="roadster")
    t1 = feed_has(page, "Data stale", 12)
    t2 = feed_has(page, "Offline: no packet", 20)
    check(f"[{mode_label}] scenario car_offline -> stale then offline", t1 is not None and t2 is not None, f"stale {t1} s, offline {t2} s")
    t3 = feed_has(page, "Back online", 20)
    t4 = feed_has(page, "packets missing", 5)
    check(f"[{mode_label}] car comes back -> 'Back online' and a seq-gap alert", t3 is not None and t4 is not None)
    return page


def screenshots(browser, out):
    out.mkdir(parents=True, exist_ok=True)
    for (w, h) in ((1366, 768), (1920, 1080)):
        for theme in ("light", "dark"):
            ctx = browser.new_context(viewport={"width": w, "height": h})
            ctx.add_init_script(f"try {{ localStorage.setItem('ft-theme', '{theme}') }} catch (e) {{}}")
            pg = ctx.new_page()
            pg.goto(BASE)
            pg.wait_for_function("document.querySelectorAll('#vlist .vcard').length >= 5", timeout=15000)
            pg.wait_for_timeout(6000)
            pg.screenshot(path=str(out / f"fleet_{theme}_{w}x{h}.png"))
            for cid in ("corolla", "roadster"):
                pg.goto(BASE + "#car/" + cid)
                pg.wait_for_function("document.querySelectorAll('#bytes32 .byte').length === 32", timeout=10000)
                pg.wait_for_timeout(3500)
                pg.screenshot(path=str(out / f"car_{cid}_{theme}_{w}x{h}.png"), full_page=True)
            ctx.close()
    print(f"  screenshots saved to {out}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shots", default=None, help="directory to save review screenshots")
    ap.add_argument("--skip-live", action="store_true")
    ap.add_argument("--skip-standalone", action="store_true")
    args = ap.parse_args()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for mode in ([] if args.skip_live else ["live"]) + ([] if args.skip_standalone else ["standalone"]):
            ctx = browser.new_context(viewport={"width": 1366, "height": 768})
            page = ctx.new_page()
            errors = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            print(f"\n== {mode} ==")
            run_checks(page, errors, mode)
            real = [e for e in errors if "tile" not in e.lower() and "ERR_" not in e]
            check(f"[{mode}] browser console has no errors", not real, "; ".join(real[:3]))
            ctx.close()
        if args.shots:
            screenshots(browser, Path(args.shots))
        browser.close()
    failed = [l for l, ok in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
