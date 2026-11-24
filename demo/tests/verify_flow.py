# verify_flow.py -- Playwright checks for the "How data flows" page (/flow/).
#
#   python demo/run_demo.py --no-browser       (in another terminal)
#   python demo/tests/verify_flow.py [--shots demo/screenshots/flow]

import argparse
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
BASE = "http://localhost:8000"
ORDER = ["ecu", "port", "elm", "decode", "gps", "pack", "unpack", "backend", "dash"]
PIDS = ["0x0C", "0x0D", "0x05", "0x11", "0x2F"]
results = []


def check(label, ok, detail=""):
    results.append((label, ok))
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}{(' -- ' + detail) if detail else ''}", flush=True)


def wait_until(fn, timeout_s, step=0.1):
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


def go(pg, stage):
    pg.evaluate(f"window.__flow.go('{stage}')")
    pg.wait_for_timeout(150)


def run(args):
    shots = Path(args.shots) if args.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    file_cache = {}

    def file_lines(rel):
        if rel not in file_cache:
            file_cache[rel] = (ROOT / rel).read_text(encoding="utf-8").splitlines()
        return file_cache[rel]

    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        ctx, pg, errs = new_page(b)
        pg.goto(BASE + "/flow/")
        t = wait_until(lambda: pg.evaluate("!!(window.FT.state.cars.fronx && window.FT.state.cars.fronx.msg)"), 8)
        check("page loads and the default source (Fronx, recorded) is live", t is not None and pg.input_value("#source") == "fronx")
        pg.wait_for_function("!!window.hljs", timeout=5000)
        n = pg.evaluate("document.querySelectorAll('#stages .node').length")
        gps = pg.evaluate("!!document.querySelector('.node-gps')")
        check("pipeline renders 8 stage nodes plus the GPS side branch", n == 8 and gps, f"{n} nodes")

        # every stage renders all four panes; code panes equal the real source lines
        mismatches, empty, checked = [], [], 0
        for pid in PIDS:
            pg.select_option("#pid", pid)
            for stage in ORDER:
                go(pg, stage)
                panes = pg.evaluate("['p-what','p-data','p-evidence','p-code'].map(id => document.getElementById(id).textContent.trim().length)")
                if min(panes) == 0:
                    empty.append(f"{pid} {stage} {panes}")
                snips = pg.evaluate("""[...document.querySelectorAll('#p-code .snip')].map(s => ({
                    file: s.dataset.file, start: +s.dataset.start, end: +s.dataset.end,
                    lines: [...s.querySelectorAll('tr.cl')].map(tr => ({ ln: +tr.dataset.ln, text: tr.querySelector('td.lc').textContent })) }))""")
                if stage not in ("ecu", "port") and not snips:
                    empty.append(f"{pid} {stage}: no code")
                for s in snips:
                    real = file_lines(s["file"])[s["start"] - 1:s["end"]]
                    shown = [x["text"] for x in sorted(s["lines"], key=lambda x: x["ln"])]
                    checked += 1
                    if shown != real:
                        mismatches.append(f"{pid} {stage} {s['file']}:{s['start']}")
        check("all 9 stages render What / Data / Evidence / Code for every traced PID", not empty, "; ".join(empty[:3]))
        check(f"every code pane equals the real source lines ({checked} snippet renders compared)", not mismatches, "; ".join(mismatches[:3]))

        # highlighted lines are present and long functions are collapsed, not cut
        go(pg, "pack")
        hl = pg.evaluate("document.querySelectorAll('#p-code tr.hl').length")
        folds = pg.evaluate("document.querySelectorAll('#p-code .fold-btn').length")
        pg.click("#p-code .snip-all")
        hidden_after = pg.evaluate("document.querySelectorAll('#p-code .snip')[0].querySelectorAll('tr[hidden]').length")
        check("long functions are collapsed around highlighted lines and expand fully", hl > 0 and folds > 0 and hidden_after == 0,
              f"{hl} highlighted, {folds} folds")

        # evidence images
        figs = pg.evaluate("""Promise.all(Object.values(window.FLOW_FIGURES).map(f => fetch(f.file).then(r => [f.figure, r.status, r.headers.get('content-type')])))""")
        bad = [f for f in figs if f[1] != 200 or not (f[2] or "").startswith("image/")]
        check(f"all {len(figs)} report figures load", not bad, str(bad))
        shown_ok = True
        for stage in ORDER:
            go(pg, stage)
            pg.evaluate("document.querySelectorAll('#p-evidence img').forEach(i => i.loading = 'eager')")
            ok = wait_until(lambda: pg.evaluate("[...document.querySelectorAll('#p-evidence img')].every(i => i.complete && i.naturalWidth > 0)"), 5)
            shown_ok = shown_ok and ok is not None
        check("each stage's evidence image renders", shown_ok)
        go(pg, "elm")
        pg.click("#p-evidence .ev-img >> nth=0")
        lb = pg.evaluate("document.getElementById('lightbox').open && document.getElementById('lb-cap').textContent")
        pg.keyboard.press("Escape")
        check("clicking a figure opens the in-page lightbox with its caption", bool(lb) and "Figure 5.13" in lb, lb or "")

        # keyboard + auto-walk
        pg.select_option("#pid", "0x0C")
        pg.locator("body").click(position={"x": 5, "y": 400})
        pg.keyboard.press("1")
        s1 = pg.evaluate("window.__flow.st.stage")
        pg.keyboard.press("ArrowRight")
        s2 = pg.evaluate("window.__flow.st.stage")
        pg.keyboard.press("8")
        s8 = pg.evaluate("window.__flow.st.stage")
        pg.keyboard.press("ArrowLeft")
        s7 = pg.evaluate("window.__flow.st.stage")
        check("keyboard: 1 / Right / 8 / Left move between stages", (s1, s2, s8, s7) == ("ecu", "port", "dash", "backend"), f"{s1} {s2} {s8} {s7}")
        pg.keyboard.press("4")
        pg.keyboard.press(" ")
        t = wait_until(lambda: pg.evaluate("window.__flow.st.stage") != "decode", 8)
        pg.keyboard.press(" ")
        after = pg.evaluate("window.__flow.st.stage")
        check("Space starts the walk-through (about 6 s per stage) and stops it", t is not None and 5 <= t <= 7.5 and after == "gps", f"advanced after {t:.1f} s to {after}" if t else "never")

        # report example
        pg.click("#report")
        go(pg, "elm")
        elm = pg.text_content("#p-data")
        go(pg, "decode")
        dec = pg.text_content("#p-data")
        pg.click("#summary")
        summ = pg.text_content("#sum-list")
        pg.click("#summary")
        pg.click("#report")
        check("Report example shows 41 0C 0D 2E -> 843.5 rpm through the stages", "41 0C 0D 2E" in elm and "843.5" in dec and "843.5" in summ and "41 0C 0D 2E" in summ)

        # reconstruction round trip in the browser, every car currently on the fleet
        dctx, drv, _ = new_page(b, 1366, 768)
        drv.goto(BASE + "/drive/")
        drv.click("#connect")
        drv.wait_for_selector("#summary:not([hidden])")
        vid = drv.text_content("#sum-vid").strip()
        t = wait_until(lambda: pg.evaluate(f"[...document.querySelectorAll('#source option')].some(o => o.value === '{vid}')"), 5)
        check("Source picker picks up a console car that connects after the page loaded", t is not None, f"{vid} after {t:.1f} s" if t else "never")
        drv.click("#ign"); drv.click('.gear[data-g="1"]')
        drv.keyboard.down("w")
        pg.select_option("#source", vid)
        go(pg, "decode")
        pg.wait_for_timeout(1500)
        follows = "Live Demo Car" in pg.text_content("#sv-car")
        check("the page follows the console car's real packets", follows, pg.text_content("#sv-car"))
        rt = pg.evaluate("""new Promise(res => {
            const M = window.FlowModel, tally = { ok: 0, fail: 0, cars: new Set() };
            const t0 = Date.now();
            window.FT.on((w, car) => {
              if (w !== 'telemetry' && w !== 'newcar') return;
              for (const k of Object.keys(M.PIDS)) { const r = M.roundTrip(k, car.msg); r.ok ? tally.ok++ : tally.fail++; }
              tally.cars.add(car.id);
            });
            setTimeout(() => res({ ok: tally.ok, fail: tally.fail, cars: [...tally.cars] }), 12000);
        })""")
        drv.keyboard.up("w")
        check(f"in-browser round trip over live packets: {rt['ok']} exact, {rt['fail']} failed, cars {', '.join(sorted(rt['cars']))}",
              rt["fail"] == 0 and rt["ok"] > 100 and vid in rt["cars"] and len(rt["cars"]) >= 6)
        dctx.close()

        # not-supported paths
        def path_for(car, pid, expect_word):
            pg.select_option("#source", car)
            pg.select_option("#pid", pid)
            out = {}
            for stage in ("elm", "decode", "pack", "unpack", "dash"):
                go(pg, stage)
                out[stage] = pg.text_content("#p-data")
            traced = pg.evaluate("(() => { window.__flow.go('pack'); return [...document.querySelectorAll('#p-data .byte.traced')].map(x => x.textContent); })()")
            ok = ("NO DATA" in out["elm"] and "None" in out["decode"] and traced[:1] == ["FF"]
                  and "null" in out["unpack"] and expect_word in out["dash"])
            return ok, traced
        ok, tr = path_for("fronx", "0x2F", "Not supported")
        check("not supported: Fronx fuel (NO DATA -> None -> FF -> null -> 'Not supported')", ok, str(tr))
        ok, tr = path_for("omni", "0x11", "Not supported")
        check("not supported: Omni throttle (legacy ECU)", ok, str(tr))
        ok, tr = path_for("roadster", "0x05", "Not applicable (EV)")
        check("not applicable: Roadster coolant shows 'Not applicable (EV)'", ok, str(tr))
        ok, tr = path_for("roadster", "0x0C", "rpm")
        check("Roadster motor RPM is supported and traced (control case)", not ok and tr[:1] != ["FF"])

        # pause freezes the packet
        pg.select_option("#source", "corolla")
        pg.select_option("#pid", "0x0C")
        go(pg, "pack")
        pg.click("#pause")
        a = pg.text_content("#p-data")
        pg.wait_for_timeout(2500)
        b2 = pg.text_content("#p-data")
        pg.click("#pause")
        pg.wait_for_timeout(2500)
        c2 = pg.text_content("#p-data")
        check("Pause holds the packet; Live follows new packets again", a == b2 and c2 != b2)
        check("no console errors on /flow/", not errs, "; ".join(errs[:3]))
        ctx.close()

        # links from Levels 1 and 2
        ctx, fl, ferrs = new_page(b)
        fl.goto(BASE + "/fleet/")
        fl.wait_for_function("document.querySelectorAll('#vlist .vcard').length >= 5", timeout=15000)
        href = fl.get_attribute(".shell .shell-link", "href")
        fl.goto(BASE + "/fleet/#car/corolla")
        fl.wait_for_function("document.querySelectorAll('#bytes32 .byte').length === 32", timeout=10000)
        trace = fl.get_attribute("#trace", "href")
        fl.click("#trace")
        fl.wait_for_url("**/flow/**")
        fl.wait_for_function("document.getElementById('source').value === 'corolla'", timeout=8000)
        check("fleet header links to /flow/ and 'Trace this packet' opens /flow/#car=corolla", href == "../flow/" and trace.endswith("#car=corolla"), f"{href} {trace}")
        ctx.close()

        # layout at projector / laptop sizes, both themes, plus screenshots
        for (w, h) in ((1920, 1080), (1536, 864), (1366, 768)):
            for theme in ("light", "dark"):
                ctx, pv, perrs = new_page(b, w, h, theme)
                pv.goto(BASE + "/flow/#car=fronx&pid=0x0C&stage=decode")
                pv.wait_for_function("!!window.hljs && !!(window.FT.state.cars.fronx && window.FT.state.cars.fronx.msg)", timeout=10000)
                pv.wait_for_timeout(600)
                over = pv.evaluate("document.documentElement.scrollWidth > innerWidth + 1")
                check(f"[{theme}] {w}x{h}: no horizontal scroll", not over)
                if shots and (w, h) != (1536, 864):
                    for stage, tag in (("port", "stage2"), ("decode", "stage4"), ("pack", "stage5"), ("backend", "stage7")):
                        go(pv, stage)
                        pv.wait_for_timeout(500)
                        pv.screenshot(path=str(shots / f"{tag}_{stage}_{theme}_{w}x{h}.png"), full_page=True)
                    pv.click("#report"); pv.click("#summary"); pv.wait_for_timeout(500)
                    pv.screenshot(path=str(shots / f"summary_report_{theme}_{w}x{h}.png"), full_page=True)
                ctx.close()
        b.close()
    failed = [l for l, ok in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--shots", default=None)
    sys.exit(run(ap.parse_args()))
