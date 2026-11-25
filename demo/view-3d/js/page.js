/* page.js -- the /3d/ page: car picker, URL (#car=<vehicle_id>), link state, theme. */
import { createView } from "./view3d.js";

const FT = window.FT;
const $ = (id) => document.getElementById(id);

function carFromHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  return h.get("car") || "fronx";
}
let current = carFromHash();

/* ---------- link + theme, same as the other pages ---------- */
const LINK = { connecting: "Connecting", live: "Live: backend WebSocket", reconnecting: "Reconnecting", standalone: "In-browser simulator" };
function themeUi() {
  const dark = FT.isDark();
  $("theme-toggle").innerHTML = `<svg class="icon"><use href="#${dark ? "i-sun" : "i-moon"}"/></svg><span>${dark ? "Light" : "Dark"}</span>`;
  $("theme-toggle").setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
}
$("theme-toggle").addEventListener("click", () => {
  const next = FT.isDark() ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("ft-theme", next); } catch (e) { /* storage blocked: lasts for this visit */ }
  themeUi();
  renderPicker();
});
themeUi();

/* ---------- picker ---------- */
function renderPicker() {
  const cars = FT.carList().filter((c) => c.msg);
  $("picker").innerHTML = cars.map((c, i) => {
    const live = FT.isLiveCar(c.msg);
    const st = FT.statusOf(c);
    return `<button class="v3p-car${st === "offline" ? " is-offline" : ""}" type="button" data-id="${FT.esc(c.id)}" aria-pressed="${c.id === current}"
      title="${FT.esc(c.msg.source.name)}${i < 9 ? ` (key ${i + 1})` : ""}">${FT.carGlyph(c.id)}<span>${FT.esc(shortName(c.msg.source.name))}</span>${live ? `<span class="tag tag-live">Live</span>` : ""}${i < 9 ? `<span class="kbd">${i + 1}</span>` : ""}</button>`;
  }).join("") || `<span class="bar-note" style="margin:0">Waiting for cars</span>`;
}
const shortName = (n) => n.replace(/^Maruti Suzuki /, "").replace(/^Maruti /, "").replace(/^Toyota /, "").replace(/^Bugatti /, "").replace(/^Tesla /, "");

$("picker").addEventListener("click", (e) => {
  const b = e.target.closest(".v3p-car");
  if (b) pick(b.dataset.id);
});
function pick(id) {
  if (!id) return;
  current = id;
  history.replaceState(null, "", "#car=" + encodeURIComponent(id));
  if (view && view.ok) view.setCar(id);
  const c = FT.state.cars[id];
  document.title = (c && c.msg ? c.msg.source.name + " - " : "") + "3D view - Car Automation";
  renderPicker();
}
window.addEventListener("hashchange", () => { const id = carFromHash(); if (id !== current) pick(id); });
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || (e.target.closest && e.target.closest("input, select, textarea"))) return;
  if (/^[1-9]$/.test(e.key)) {
    const cars = FT.carList().filter((c) => c.msg);
    const c = cars[+e.key - 1];
    if (c) { pick(c.id); e.preventDefault(); }
  }
});

FT.on((what, x) => {
  if (what === "mode") {
    $("link").dataset.state = x; $("link-text").textContent = LINK[x] || x;
    $("standalone-badge").hidden = x !== "standalone";
  }
  if (what === "newcar" || what === "removed") renderPicker();
  if (what === "newcar" && x.id === current) pick(current);
});
setInterval(renderPickerStatus, 1000);
function renderPickerStatus() {
  for (const b of $("picker").querySelectorAll(".v3p-car")) {
    const c = FT.state.cars[b.dataset.id];
    b.classList.toggle("is-offline", !c || FT.statusOf(c) === "offline");
  }
}

/* ---------- boot ---------- */
let view = null;
renderPicker();
FT.connect();
createView($("stage"), { carId: current, compact: false, flowBase: "../flow/" }).then((v) => {
  view = v;
  window.__view3dPage = { pick, get current() { return current; }, get view() { return view; } };
});
