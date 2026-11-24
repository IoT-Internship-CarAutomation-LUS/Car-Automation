/* ui.js -- small shared helpers: identities, formatting, provenance labels, tooltip. */
(function () {
  "use strict";
  const FT = (window.FT = window.FT || {});

  // Fixed identity colours (validated categorical slots). Unknown cars (e.g. a
  // second-laptop simulator) take the remaining slots in arrival order.
  const FIXED = { fronx: 1, veyron: 2, corolla: 3, omni: 4, roadster: 7 };
  const spare = [5, 6];
  const assigned = {};
  FT.slotFor = function (id) {
    if (FIXED[id]) return FIXED[id];
    if (!assigned[id]) assigned[id] = spare.length ? spare.shift() : 0;
    return assigned[id];
  };
  FT.carColor = (id) => `var(--s${FT.slotFor(id)})`;
  FT.ORDER = ["fronx", "corolla", "veyron", "omni", "roadster"];

  FT.carGlyph = (id, cls) =>
    `<svg class="car-glyph ${cls || ""}" style="--car:${FT.carColor(id)}" viewBox="0 0 22 36" aria-hidden="true"><use href="#car-top"/></svg>`;

  FT.esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  FT.fmt = function (v, d) {
    if (v == null || Number.isNaN(v)) return null;
    if (typeof v === "boolean") return v ? "Yes" : "No";
    return d == null ? String(v) : Number(v).toFixed(d);
  };

  /* ---- provenance ---- */
  FT.prov = function (msg, group, leaf) {
    const p = (msg && msg.provenance) || {};
    const f = p.fields || {};
    if (leaf && f[group + "." + leaf]) return f[group + "." + leaf];
    return p[group] || "no_data";
  };
  FT.provText = function (state, msg) {
    const ev = msg && msg.source && msg.source.powertrain === "ev";
    switch (state) {
      case "measured": return "Measured";
      case "simulated": return "Simulated";
      case "derived": return "Derived";
      case "not_supported": return "Not supported by this vehicle";
      case "not_applicable": return ev ? "Not applicable (EV)" : "Not applicable";
      case "no_data": return "No reading";
      default: return "No reading";
    }
  };
  /** What to show instead of a null value. Never 0, never OFF, never blank. */
  FT.nullText = function (state, msg) {
    const ev = msg && msg.source && msg.source.powertrain === "ev";
    if (state === "not_supported") return "Not supported";
    if (state === "not_applicable") return ev ? "N/A (EV)" : "N/A";
    return "No reading";
  };
  FT.provTag = (state, msg) => `<span class="prov" data-p="${state}" title="${FT.esc(FT.provText(state, msg))}">${FT.esc(FT.provText(state, msg))}</span>`;

  FT.modeTag = function (mode) {
    if (mode === "recorded") return `<span class="tag tag-recorded" title="A real logged session from this car, replayed">Recorded</span>`;
    if (mode === "live") return `<span class="tag tag-live" title="Live from the car">Live</span>`;
    return `<span class="tag" title="Produced by the demo simulator">Simulated</span>`;
  };

  FT.timeStr = (t) => {
    const d = new Date(t);
    return d.toLocaleTimeString("en-GB", { hour12: false });
  };
  FT.ageStr = (ms) => {
    if (ms == null) return "--";
    if (ms < 60000) return (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + " s";
    return Math.floor(ms / 60000) + " min";
  };

  FT.POS_NAME = { fl: "Front-left", fr: "Front-right", rl: "Rear-left", rr: "Rear-right" };

  FT.sevIcon = (sev) => (sev === "critical" ? "i-crit" : sev === "info" ? "i-info" : sev === "cleared" ? "i-check" : "i-warn");
  FT.sevWord = (sev) => ({ critical: "Critical", serious: "Serious", warning: "Warning", info: "Info", cleared: "Cleared" }[sev] || sev);
  FT.icon = (id) => `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;

  /* ---- tooltip ---- */
  const tip = () => document.getElementById("tooltip");
  FT.showTip = function (html, x, y) {
    const t = tip();
    t.innerHTML = html;
    t.hidden = false;
    const r = t.getBoundingClientRect();
    let left = x + 14, top = y + 16;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 12;
    t.style.left = Math.max(8, left) + "px";
    t.style.top = Math.max(8, top) + "px";
  };
  FT.hideTip = () => { tip().hidden = true; };

  /* ---- theme-aware values ---- */
  FT.cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  FT.isDark = () => {
    const t = document.documentElement.getAttribute("data-theme");
    if (t) return t === "dark";
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  };
  /* Base map tiles. The brief asked for CARTO Positron / Dark Matter, but CARTO's
   * basemaps now answer every keyless request with an "API KEY REQUIRED" tile.
   * Provider chain: Stadia Alidade Smooth / Smooth Dark (the closest keyless
   * look; works for localhost and LAN pages that send a Referer), then OSM
   * standard tiles, toned with a CSS filter per theme, after repeated errors. */
  const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  const PROVIDERS = {
    stadia: {
      url: (dark) => `https://tiles.stadiamaps.com/tiles/${dark ? "alidade_smooth_dark" : "alidade_smooth"}/{z}/{x}/{y}{r}.png`,
      attr: '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> ' + OSM_ATTR,
    },
    osm: { url: () => "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attr: OSM_ATTR },
  };
  let provider = location.protocol === "file:" ? "osm" : "stadia";
  const holders = new Set();
  FT.makeTiles = function (map) {
    const make = () => {
      const p = PROVIDERS[provider];
      const layer = L.tileLayer(p.url(FT.isDark()), { attribution: p.attr, maxZoom: 19, className: "tiles-" + provider });
      let errors = 0;
      layer.on("tileerror", () => {
        if (provider === "stadia" && ++errors >= 3) { provider = "osm"; holders.forEach((h) => h.rebuild()); }
      });
      return layer;
    };
    const holder = {
      layer: make().addTo(map),
      rebuild() { map.removeLayer(this.layer); this.layer = make().addTo(map); },
    };
    holders.add(holder);
    return holder;
  };
  FT.tileProvider = () => provider;
})();
