/* embed3d.js -- Level 3: the "3D view" toggle in the car view's "Engine and speed" panel.
 * Nothing 3D loads until the button is first pressed: then ../3d/css/view3d.css and the
 * ../3d/js/view3d.js module (with three.js) are fetched, and the gauges are swapped for an
 * embedded canvas. Closing the view, leaving the car view, or pressing "Gauges" disposes
 * the renderer and releases its WebGL context. */
(function () {
  "use strict";
  const FT = window.FT;
  const $ = (id) => document.getElementById(id);
  const btn = $("g-3d"), host = $("g3d-host");
  if (!btn || !host) return;
  const panel = btn.closest(".panel");
  let view = null, open = false, mod = null, cssReady = null, gen = 0;

  const abs = (rel) => new URL(rel, document.baseURI).href;
  function loadCss() {
    if (cssReady) return cssReady;
    cssReady = new Promise((resolve) => {
      const l = document.createElement("link");
      l.rel = "stylesheet"; l.href = abs("../3d/css/view3d.css");
      l.onload = resolve; l.onerror = resolve;
      document.head.appendChild(l);
    });
    return cssReady;
  }
  function setBtn() {
    btn.setAttribute("aria-pressed", String(open));
    btn.textContent = open ? "Gauges" : "3D view";
    btn.title = open ? "Back to the gauges" : "Swap the gauges for a live 3D view of this car";
  }
  function message(title, body) {
    host.hidden = false;
    host.classList.add("is-msg");
    // inline styles: this message must read even when ../3d/css/ cannot be fetched (file://)
    host.innerHTML = `<div class="g3d-msg" style="display:flex;flex-direction:column;gap:.2rem;padding:.6rem .8rem;border-radius:8px;background:var(--surface-2);color:var(--ink-2);font-size:.93rem;margin-bottom:.6rem">
      <strong style="color:var(--ink)">${FT.esc(title)}</strong><span>${FT.esc(body)}</span></div>`;
  }

  async function openView(id) {
    const my = ++gen;
    open = true; setBtn();
    if (location.protocol === "file:") {
      message("The 3D view needs the backend.", "Run python demo/run_demo.py and open http://localhost:8000/fleet/. The gauges below still work.");
      open = false; setBtn(); return;
    }
    try {
      await loadCss();
      mod = mod || (await import(abs("../3d/js/view3d.js")));
    } catch (e) {
      console.warn("3D view did not load:", e);
      message("The 3D view could not load.", "The gauges below still work.");
      open = false; setBtn(); return;
    }
    if (my !== gen || !open) return;
    host.classList.remove("is-msg");
    host.innerHTML = "";
    host.hidden = false;
    panel.classList.add("is-3d");
    const v = await mod.createView(host, { carId: id, compact: true, flowBase: "../flow/" });
    if (my !== gen || !open) { v.dispose(); return; }
    if (!v.ok) {
      // no WebGL: say so in a short strip and keep the gauges
      panel.classList.remove("is-3d");
      host.classList.add("is-msg");
      open = false; setBtn();
      return;
    }
    view = v;
  }
  function close() {
    gen++;
    open = false;
    if (view) { view.dispose(); view = null; }
    host.innerHTML = ""; host.hidden = true; host.classList.remove("is-msg");
    if (panel) panel.classList.remove("is-3d");
    setBtn();
  }

  btn.addEventListener("click", () => {
    if (open) close();
    else {
      const m = location.hash.match(/^#car\/(.+)$/);
      if (m) openView(decodeURIComponent(m[1]));
    }
  });

  FT.Embed3D = {
    follow(id) { if (view) view.setCar(id); },
    close() { if (open || view || !host.hidden) close(); },
    get isOpen() { return open; },
    get view() { return view; },
  };
})();
