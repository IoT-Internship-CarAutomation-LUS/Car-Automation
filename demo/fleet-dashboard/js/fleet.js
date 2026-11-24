/* fleet.js -- fleet view: KPI strip, vehicle cards, map, alert feed. */
(function () {
  "use strict";
  const FT = window.FT;
  const C = window.FTCodec;
  const S = FT.state;

  /* ---------- packet ribbon (signature) ---------- */
  FT.ribbonCells = function (hex, fields) {
    const buf = C.fromHex(hex);
    const n = fields === C.FIELDS_16 ? 16 : 32;
    if (!buf || buf.length !== n) return null;
    const cells = new Array(n);
    for (const [start, len, key, , group] of fields) {
      const na = C.isSentinel(buf, start, len, key);
      for (let i = start; i < start + len; i++) cells[i] = { group, na, key };
    }
    return cells;
  };
  FT.renderRibbon = function (el, hex, fields) {
    const cells = FT.ribbonCells(hex, fields || C.FIELDS_32);
    const n = (fields || C.FIELDS_32) === C.FIELDS_16 ? 16 : 32;
    if (el.children.length !== n) el.innerHTML = "<i></i>".repeat(n);
    el.classList.toggle("is-empty", !cells);
    if (!cells) return;
    cells.forEach((c, i) => {
      const node = el.children[i];
      const slot = C.GROUPS[c.group].slot;
      node.className = c.na ? "na" : c.group === "crc" ? "crc" : "";
      node.style.setProperty("--c", `var(--s${slot})`);
    });
  };
  /** "Reports 13 of 18 fields" -- counts non-null leaves in vehicle.* */
  FT.reportedCount = function (msg) {
    const v = (msg && msg.vehicle) || {};
    const keys = Object.keys(v);
    return { have: keys.filter((k) => v[k] != null).length, of: keys.length };
  };

  /* ---------- cards ---------- */
  const cardEls = {};
  function ensureCard(car) {
    if (cardEls[car.id]) return cardEls[car.id];
    const li = document.createElement("li");
    li.innerHTML = `
      <button class="vcard" type="button" style="--car:${FT.carColor(car.id)}">
        ${FT.carGlyph(car.id)}
        <span class="vcard-row r1"><span class="vcard-name"></span><span class="vcard-mode"></span></span>
        <span class="vcard-speedbox"><span class="vcard-speed num"></span><span class="vcard-unit">km/h</span></span>
        <span class="vcard-row r2"><span class="plate"></span><span class="status"></span></span>
        <span class="vcard-rpm num"></span>
        <span class="vcard-live" hidden>Driven live from the Control Console</span>
        <span class="vcard-alerts"></span>
        <span class="vcard-wire"><span class="vcard-ribbon ribbon" title="The live 32-byte packet, one cell per byte, coloured by field. Hatched cells carry the 'not available' sentinel."></span><span class="vcard-ribbon-note"></span></span>
      </button>`;
    const btn = li.firstElementChild;
    btn.addEventListener("click", () => { location.hash = "#car/" + encodeURIComponent(car.id); });
    // keep list order stable by ORDER
    const list = document.getElementById("vlist");
    list.querySelectorAll("li.empty").forEach((x) => x.remove());
    li.dataset.id = car.id;
    list.appendChild(li);
    const sorted = FT.carList().map((c) => c.id);
    const kids = [...list.children].sort((a, b) => sorted.indexOf(a.dataset.id) - sorted.indexOf(b.dataset.id));
    kids.forEach((k) => list.appendChild(k));
    cardEls[car.id] = {
      btn, name: btn.querySelector(".vcard-name"), mode: btn.querySelector(".vcard-mode"),
      plate: btn.querySelector(".plate"), status: btn.querySelector(".status"),
      speed: btn.querySelector(".vcard-speed"), rpm: btn.querySelector(".vcard-rpm"),
      alerts: btn.querySelector(".vcard-alerts"), ribbon: btn.querySelector(".vcard-ribbon"),
      note: btn.querySelector(".vcard-ribbon-note"), live: btn.querySelector(".vcard-live"), lastHex: null,
    };
    return cardEls[car.id];
  }

  function updateCard(car) {
    const e = ensureCard(car);
    const m = car.msg;
    const src = m.source;
    const v = m.vehicle || {};
    const st = FT.statusOf(car);
    e.name.textContent = src.name;
    e.name.title = `${src.name} (${src.model_year})`;
    e.mode.innerHTML = FT.modeTag(src.data_mode);
    e.plate.textContent = src.reg_no || "No plate";
    e.plate.dataset.ev = src.powertrain === "ev";
    e.status.dataset.s = st;
    e.status.textContent = FT.STATUS_WORD[st];
    e.btn.classList.toggle("is-offline", st === "offline");
    if (v.speed_kmh == null) { e.speed.textContent = "--"; }
    else e.speed.textContent = v.speed_kmh >= 254 ? "254+" : String(Math.round(v.speed_kmh));
    const motor = src.powertrain === "ev";
    e.rpm.textContent = v.rpm == null ? "" : `${Math.round(v.rpm).toLocaleString("en-IN")} rpm`;
    if (v.gear === 14) e.rpm.textContent += " R";
    e.rpm.title = motor ? "Motor rpm (electric)" : "Engine rpm";
    const al = FT.alertsFor(car.id);
    const shown = al.slice(0, 2).map((a) =>
      `<span class="abadge sev-${a.sev}" title="${FT.esc(a.msg)}">${FT.icon(FT.sevIcon(a.sev))}${FT.esc(a.short || "Alert")}</span>`).join("");
    const more = al.length > 2 ? `<span class="abadge sev-${al[2].sev}" title="${FT.esc(al.slice(2).map((a) => a.msg).join("\n"))}">+${al.length - 2}</span>` : "";
    const html = shown + more;
    if (e.alerts.innerHTML !== html) e.alerts.innerHTML = html;
    if (e.lastHex !== m.packet_hex) { FT.renderRibbon(e.ribbon, m.packet_hex); e.lastHex = m.packet_hex; }
    const rc = FT.reportedCount(m);
    e.note.textContent = `${rc.have}/${rc.of} fields`;
    e.note.title = `This car reports ${rc.have} of the ${rc.of} vehicle fields; the rest are null (not supported, not applicable or no reading)`;
    e.alerts.hidden = !al.length;
    e.live.hidden = !FT.isLiveCar(m);
    e.btn.setAttribute("aria-label", `${src.name}, ${FT.STATUS_WORD[st]}, ${v.speed_kmh == null ? "speed unknown" : v.speed_kmh + " km/h"}${al.length ? ", " + al.length + " alerts" : ""}. Open full telemetry.`);
  }

  function renderEmptyCards() {
    const list = document.getElementById("vlist");
    if (Object.keys(S.cars).length) return;
    list.innerHTML = `<li class="empty"><strong>Waiting for the first packet</strong>${
      S.mode === "standalone" ? "Starting the in-browser simulator." : "Start the simulator with <span class=\"num\">python demo/run_demo.py</span>, or wait a moment."}</li>`;
  }

  /* ---------- KPIs + header ---------- */
  function updateKpis() {
    const cars = FT.carList();
    const online = cars.filter((c) => c.msg && Date.now() - c.lastRx <= 10000).length;
    document.getElementById("kpi-online").textContent = online;
    document.getElementById("kpi-online-of").textContent = "of " + cars.length;
    document.getElementById("kpi-moving").textContent = cars.filter((c) => FT.statusOf(c) === "moving").length;
    const ac = FT.activeCount();
    document.getElementById("kpi-alerts").textContent = ac;
    document.getElementById("kpi-alerts-wrap").dataset.tone = ac ? "alert" : "";
    document.getElementById("kpi-pps").textContent = FT.pps().toFixed(1);
    document.getElementById("kpi-crc").textContent = S.crc.total ? (100 * S.crc.ok / S.crc.total).toFixed(S.crc.ok === S.crc.total ? 0 : 1) + "%" : "--";
    const rec = cars.filter((c) => c.msg && c.msg.source.data_mode === "recorded").length;
    const live = cars.filter((c) => c.msg && c.msg.source.data_mode === "live").length;
    const sim = cars.filter((c) => c.msg && c.msg.source.data_mode === "simulated").length;
    const parts = [];
    if (live) parts.push(`${live} live`);
    parts.push(`${rec} recorded`, `${sim} simulated`);
    document.getElementById("demo-badge").textContent = cars.length ? "Demo data: " + parts.join(" + ") : "Demo data: waiting";
  }

  /* ---------- map ---------- */
  let map, tiles;
  const markers = {}, trails = {}, routes = {};

  function initMap() {
    // Whole zoom levels only (fractional zoom draws hairline tile seams), never wider than
    // greater Chennai, and one wheel notch = one zoom level.
    const CHENNAI = L.latLngBounds([12.55, 79.8], [13.35, 80.55]);
    map = L.map("fleet-map", {
      zoomControl: true, attributionControl: true, zoomSnap: 1, zoomDelta: 1,
      wheelPxPerZoomLevel: 120, wheelDebounceTime: 60, minZoom: 11, maxZoom: 18,
      maxBounds: CHENNAI, maxBoundsViscosity: 0.85,
    }).setView([12.97, 80.18], 11);
    tiles = FT.makeTiles(map);
    const data = window.DEMO_DATA && window.DEMO_DATA.routes;
    const bounds = [];
    if (data) {
      for (const [id, r] of Object.entries(data)) {
        // "live" is the Control Console loop, shared by every live car: neutral ink, not an identity colour
        const color = id === "live" ? FT.cssVar("--ink-3") : FT.cssVar(`--s${FT.slotFor(id)}`);
        routes[id] = L.polyline(r.coords, { color, weight: 3, opacity: 0.3, dashArray: "1 7", lineCap: "round", interactive: false }).addTo(map);
        r.coords.forEach((c) => bounds.push(c));
      }
    }
    FT.fleetBounds = bounds.length ? L.latLngBounds(bounds) : null;

    const FitAll = L.Control.extend({
      options: { position: "topleft" },
      onAdd() {
        const b = L.DomUtil.create("button", "map-fit");
        b.type = "button";
        b.title = "Fit every car and route in view";
        b.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-fit"/></svg><span>Fit all</span>`;
        L.DomEvent.disableClickPropagation(b);
        L.DomEvent.on(b, "click", () => { autoFit = true; frame(); });
        return b;
      },
    });
    new FitAll().addTo(map);

    // Frame as soon as (and whenever) the container has a real size, until the user moves the map.
    const box = document.getElementById("fleet-map");
    ["wheel", "mousedown", "touchstart", "keydown"].forEach((ev) =>
      box.addEventListener(ev, (e) => { if (!e.target.closest(".map-fit")) autoFit = false; }, { passive: true }));
    if (window.ResizeObserver) new ResizeObserver(() => { map.invalidateSize(); if (autoFit) frame(); }).observe(box);
    frame();
    FT.fleetMap = map;
  }
  let autoFit = true;
  function fitBoundsAll() {
    const b = FT.fleetBounds ? L.latLngBounds(FT.fleetBounds.getSouthWest(), FT.fleetBounds.getNorthEast()) : null;
    let out = b;
    for (const m of Object.values(markers)) {
      const ll = m.mk.getLatLng();
      out = out ? out.extend(ll) : L.latLngBounds(ll, ll);
    }
    return out;
  }
  function frame() {
    if (!map) return;
    const size = map.getSize();
    if (size.x < 80 || size.y < 80) return;        // hidden or not laid out yet: try again on resize
    const b = fitBoundsAll();
    if (!b) return;
    map.fitBounds(b, { padding: [36, 36], maxZoom: 14, animate: false });
  }
  FT.recolorFleetMap = function () {
    if (!map) return;
    tiles.rebuild();
    for (const [id, r] of Object.entries(routes)) r.setStyle({ color: id === "live" ? FT.cssVar("--ink-3") : FT.cssVar(`--s${FT.slotFor(id)}`) });
    for (const [id, t] of Object.entries(trails)) t.setStyle({ color: FT.cssVar(`--s${FT.slotFor(id)}`) });
  };

  function markerFor(car) {
    if (markers[car.id]) return markers[car.id];
    const icon = L.divIcon({
      className: "", iconSize: [0, 0],
      html: `<div class="car-marker" style="--car:${FT.carColor(car.id)}"><svg class="car-body car-glyph" viewBox="0 0 22 36"><use href="#car-top"/></svg><span class="car-label"></span></div>`,
    });
    const g = car.msg.gps;
    const mk = L.marker([g.lat, g.lng], { icon, keyboard: true, title: car.msg.source.name, riseOnHover: true }).addTo(map);
    mk.on("click", () => { location.hash = "#car/" + encodeURIComponent(car.id); });
    trails[car.id] = L.polyline([], { color: FT.cssVar(`--s${FT.slotFor(car.id)}`), weight: 6, opacity: 0.9, lineCap: "round", lineJoin: "round", interactive: false }).addTo(map);
    markers[car.id] = { mk, from: [g.lat, g.lng], to: [g.lat, g.lng], t0: performance.now(), angle: g.heading_deg || 0, trail: [] };
    return markers[car.id];
  }

  function updateMarker(car) {
    const g = car.msg.gps || {};
    if (!g.fix || g.lat == null) return;
    const m = markerFor(car);
    const el = m.mk.getElement();
    const cur = m.mk.getLatLng();
    m.from = [cur.lat, cur.lng]; m.to = [g.lat, g.lng]; m.t0 = performance.now();
    m.dur = car.prevRx ? Math.max(150, Math.min(1000, car.lastRx - car.prevRx)) : 1000;
    if (g.heading_deg != null) {
      const d = ((g.heading_deg - (m.angle % 360)) + 540) % 360 - 180;   // shortest turn
      m.angle += d;
    }
    if (el) {
      el.querySelector(".car-body").style.transform = `rotate(${m.angle}deg)`;
      const st = FT.statusOf(car);
      const lbl = el.querySelector(".car-label");
      const v = car.msg.vehicle;
      lbl.textContent = `${shortName(car.msg.source.name)}  ${v.speed_kmh == null ? "--" : (v.speed_kmh >= 254 ? "254+" : Math.round(v.speed_kmh))} km/h`;
      el.querySelector(".car-marker").classList.toggle("is-offline", st === "offline");
      el.querySelector(".car-marker").classList.toggle("has-alert", FT.alertsFor(car.id).some((a) => a.sev === "critical"));
    }
    m.trail.push([g.lat, g.lng]);
    while (m.trail.length > 45 * (car.prevRx && car.lastRx - car.prevRx < 600 ? 5 : 1)) m.trail.shift();
    trails[car.id].setLatLngs(m.trail);
  }
  const shortName = (n) => n.replace(/^(Maruti Suzuki|Maruti|Toyota|Bugatti|Tesla|Hyundai)\s+/, "").replace(/\s+16\.4$/, "").replace(/\s*\((manual|automatic)\)$/i, "");

  function declutterLabels() {
    // Greedy: place each label right of its car, else left, avoiding labels placed so far and every car body.
    const items = Object.values(markers).map((m) => m.mk.getElement()).filter(Boolean)
      .map((el) => ({ wrap: el.querySelector(".car-marker"), label: el.querySelector(".car-label") }));
    const bodies = items.map((it) => it.wrap.querySelector(".car-body").getBoundingClientRect());
    const hit = (a, b) => !(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top);
    const placed = [];
    items.forEach((it, i) => {
      let best = null;
      for (const left of [false, true]) {
        it.wrap.classList.toggle("label-left", left);
        const r = it.label.getBoundingClientRect();
        const bad = placed.some((p) => hit(r, p)) || bodies.some((bd, j) => j !== i && hit(r, bd));
        if (!bad) { best = left; break; }
      }
      it.wrap.classList.toggle("label-left", !!best);
      placed.push(it.label.getBoundingClientRect());
    });
  }
  setInterval(declutterLabels, 1000);

  function animate() {
    const now = performance.now();
    for (const m of Object.values(markers)) {
      const f = Math.min(1, (now - m.t0) / (m.dur || 1000));
      if (f < 1 || m._last !== m.t0) {
        m.mk.setLatLng([m.from[0] + (m.to[0] - m.from[0]) * f, m.from[1] + (m.to[1] - m.from[1]) * f]);
        if (f >= 1) m._last = m.t0;
      }
    }
    requestAnimationFrame(animate);
  }

  function updateLegend() {
    const el = document.getElementById("map-legend");
    const html = FT.carList().filter((c) => c.msg).map((c) =>
      `<span>${FT.carGlyph(c.id)}${FT.esc(shortName(c.msg.source.name))}</span>`).join("") +
      `<span title="Dotted line: the car's loop. Solid line: its last 45 seconds.">Dotted: route loop. Solid: last 45 s</span>`;
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  /* ---------- alert feed ---------- */
  function renderFeed() {
    const ol = document.getElementById("feed");
    document.getElementById("feed-empty").hidden = S.feed.length > 0;
    const ids = new Set([...ol.children].map((li) => li.dataset.id));
    const frag = [];
    for (const f of S.feed) {
      if (ids.has(f.id)) continue;
      frag.push(f);
    }
    for (const f of frag.reverse()) {
      const car = S.cars[f.car];
      const name = f.name || (car && car.msg ? car.msg.source.name : (f.car || "Presenter"));
      const li = document.createElement("li");
      li.dataset.id = f.id;
      li.className = (f.kind === "cleared" ? "is-cleared " : "") + "is-new";
      const sevCls = f.sev === "cleared" || f.sev === "info" ? "" : "sev-" + f.sev;
      li.innerHTML = `<span class="sev-icon ${sevCls}" ${f.sev === "info" ? 'style="background:var(--accent-soft);color:var(--accent)"' : ""}>${FT.icon(FT.sevIcon(f.sev))}</span>
        <span class="f-top">${f.car ? FT.carGlyph(f.car) : ""}<span class="f-car">${FT.esc(name)}</span><span class="f-time num">${FT.timeStr(f.t)}</span></span>
        <span class="f-msg"><span class="f-sev ${sevCls ? "" : ""}" style="color:var(--${f.sev === "cleared" ? "ink-3" : f.sev === "info" ? "accent" : f.sev + "-ink"})">${FT.sevWord(f.sev)}.</span> ${FT.esc(f.msg)}</span>`;
      li.querySelector(".car-glyph") && li.querySelector(".car-glyph").setAttribute("style", `--car:${FT.carColor(f.car)};width:.7rem;height:1.1rem;align-self:center`);
      if (car) li.style.cursor = "pointer", li.addEventListener("click", () => { location.hash = "#car/" + encodeURIComponent(f.car); });
      ol.insertBefore(li, ol.firstChild);
    }
    while (ol.children.length > 80) ol.removeChild(ol.lastChild);
  }

  /* ---------- wiring ---------- */
  FT.Fleet = {
    init() {
      initMap();
      renderEmptyCards();
      requestAnimationFrame(animate);
      FT.on((what, car) => {
        if (what === "telemetry" || what === "newcar") {
          updateCard(car); updateMarker(car);
          if (what === "newcar") { updateLegend(); updateKpis(); FT.refreshPresenterCars && FT.refreshPresenterCars(); }
        }
        if (what === "feed") renderFeed();
        if (what === "tick") {
          for (const c of FT.carList()) if (c.msg) {
            updateCard(c);
            const m = markers[c.id];
            if (m) { const el = m.mk.getElement(); el && el.querySelector(".car-marker").classList.toggle("is-offline", FT.statusOf(c) === "offline"); }
          }
          updateKpis();
          if (!Object.keys(S.cars).length) renderEmptyCards();
        }
        if (what === "mode") renderEmptyCards();
        if (what === "removed") {
          const id = car;
          if (cardEls[id]) { cardEls[id].btn.parentElement.remove(); delete cardEls[id]; }
          if (markers[id]) { markers[id].mk.remove(); delete markers[id]; }
          if (trails[id]) { trails[id].remove(); delete trails[id]; }
          FT.freeSlot(id);
          updateLegend(); updateKpis(); FT.refreshPresenterCars && FT.refreshPresenterCars();
          if (location.hash === "#car/" + encodeURIComponent(id)) location.hash = "#fleet";
        }
      });
    },
    invalidate() { if (map) setTimeout(() => { map.invalidateSize(); if (autoFit) frame(); }, 0); },
    reframe: frame,
    setSelected(id) { for (const [k, e] of Object.entries(cardEls)) e.btn.setAttribute("aria-current", k === id ? "true" : "false"); },
  };
})();
