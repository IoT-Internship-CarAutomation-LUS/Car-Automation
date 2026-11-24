/* main.js -- boot, router, theme, clock, presenter panel. */
(function () {
  "use strict";
  const FT = window.FT;
  const $ = (id) => document.getElementById(id);

  /* ---------- theme ---------- */
  function applyThemeUi() {
    const dark = FT.isDark();
    $("theme-toggle").innerHTML = `<svg class="icon"><use href="#${dark ? "i-sun" : "i-moon"}"/></svg><span>${dark ? "Light" : "Dark"}</span>`;
    $("theme-toggle").setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  }
  $("theme-toggle").addEventListener("click", () => {
    const next = FT.isDark() ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("ft-theme", next); } catch (e) { /* storage blocked: theme lasts for this visit */ }
    applyThemeUi();
    FT.recolorFleetMap();
    FT.Car.retheme();
  });

  /* ---------- link status ---------- */
  const LINK_WORD = { connecting: "Connecting", live: "Live: backend WebSocket", reconnecting: "Reconnecting", standalone: "In-browser simulator" };
  FT.on((what, m) => {
    if (what !== "mode") return;
    $("link").dataset.state = m;
    $("link-text").textContent = LINK_WORD[m] || m;
    $("link").title = m === "live" ? "Connected to the FastAPI backend at /ws" : m === "standalone" ? "No backend: " + (FT.standaloneReason || "") : "";
    $("standalone-badge").hidden = m !== "standalone";
    if (m === "standalone") $("standalone-badge").title = "Standalone mode (" + FT.standaloneReason + "). An in-browser simulator produces the same JSON, through a JavaScript port of pack_packet and CRC-8.";
  });

  /* ---------- clock ---------- */
  const tickClock = () => { $("clock").textContent = new Date().toLocaleTimeString("en-GB", { hour12: false }); };
  setInterval(tickClock, 1000); tickClock();

  /* ---------- router ---------- */
  function route() {
    const m = location.hash.match(/^#car\/(.+)$/);
    const fleet = $("view-fleet"), car = $("view-car");
    if (m) {
      const id = decodeURIComponent(m[1]);
      fleet.hidden = true; car.hidden = false;
      FT.Car.open(id);
      FT.Fleet.setSelected(id);
      window.scrollTo(0, 0);
    } else {
      FT.Car.close();
      car.hidden = true; fleet.hidden = false;
      document.title = "Car Automation - Fleet Telemetry";
      FT.Fleet.invalidate();
    }
  }
  window.addEventListener("hashchange", route);

  /* ---------- presenter panel (P) ---------- */
  const panel = $("presenter");
  const toggle = (show) => { panel.hidden = show == null ? !panel.hidden : !show; if (!panel.hidden) panel.querySelector(".pbtn").focus(); };
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, select, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "p" || e.key === "P") { toggle(); e.preventDefault(); }
    if (e.key === "Escape" && !panel.hidden) toggle(false);
  });
  $("p-close").addEventListener("click", () => toggle(false));
  FT.refreshPresenterCars = function () {
    const sel = $("p-offline-car");
    const cur = sel.value;
    sel.innerHTML = FT.carList().filter((c) => c.msg).map((c) =>
      `<option value="${FT.esc(c.id)}">${FT.esc(c.msg.source.name)}</option>`).join("");
    if (cur) sel.value = cur; else if ([...sel.options].some((o) => o.value === "veyron")) sel.value = "veyron";
  };
  const LABEL = { omni_overheat: "Omni overheat", corolla_puncture: "Corolla puncture", mil_on: "Corolla check-engine lamp", car_offline: "Car offline", reset_all: "Reset all" };
  panel.addEventListener("click", (e) => {
    const b = e.target.closest(".pbtn");
    if (!b) return;
    const sc = b.dataset.scenario;
    const target = sc === "car_offline" ? $("p-offline-car").value : null;
    const ok = FT.sendControl(sc, target);
    const who = target && FT.state.cars[target] ? FT.state.cars[target].msg.source.name : null;
    $("p-sent").textContent = ok ? `Sent: ${LABEL[sc]}${who ? " (" + who + ")" : ""}` : "Not sent: the backend link is down";
    if (ok) FT.postInfo(null, `Presenter scenario: ${LABEL[sc]}${who ? " for " + who : ""}`);
  });

  /* ---------- boot ---------- */
  applyThemeUi();
  FT.Fleet.init();
  FT.Car.init();
  route();
  FT.connect();
})();
