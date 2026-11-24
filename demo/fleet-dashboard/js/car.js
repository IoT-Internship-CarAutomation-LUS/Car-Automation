/* car.js -- single-car view (#car/<id>). */
(function () {
  "use strict";
  const FT = window.FT;
  const C = window.FTCodec;
  const S = FT.state;
  const $ = (id) => document.getElementById(id);

  let current = null;           // vehicle id on screen
  let built = null;             // id the skeleton was built for (+ powertrain)
  let map, tiles, marker, trail, angle = 0;
  let charts = {};

  /* ---------- per-car gauge scales ---------- */
  function scales(msg) {
    const id = msg.source.vehicle_id, ev = msg.source.powertrain === "ev";
    const rpm = { fronx: [7000, 6000], corolla: [7000, 6200], veyron: [7000, 6400], omni: [6000, 5000], roadster: [14000, 13000] }[id]
      || (ev ? [16000, 14000] : [8000, 6500]);
    const spd = { veyron: 420, omni: 140, roadster: 220 }[id] || 200;
    return { rpmMax: rpm[0], rpmRed: rpm[1], spdMax: spd };
  }

  /* ---------- gauges ---------- */
  const CX = 100, CY = 100, R = 78, A0 = 135, SWEEP = 270;
  const polar = (a, r) => [CX + r * Math.cos((a * Math.PI) / 180), CY + r * Math.sin((a * Math.PI) / 180)];
  function arc(a1, a2, r) {
    const [x1, y1] = polar(a1, r), [x2, y2] = polar(a2, r);
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${a2 - a1 > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }
  function gaugeSvg(id, max, red, unit, ticks, limit) {
    const len = (Math.PI * R * SWEEP) / 180;
    let t = "";
    for (let i = 0; i <= ticks; i++) {
      const a = A0 + (SWEEP * i) / ticks;
      const [x1, y1] = polar(a, R - 9), [x2, y2] = polar(a, R - 15), [lx, ly] = polar(a, R - 25);
      const val = (max * i) / ticks;
      t += `<line class="g-tick" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
      t += `<text class="g-tick-label" x="${lx}" y="${ly + 3}">${max >= 1000 ? (val ? val / 1000 + "k" : "0") : Math.round(val)}</text>`;
    }
    let lim = "";
    if (limit && limit < max) {
      const a = A0 + (SWEEP * limit) / max;
      const [x1, y1] = polar(a, R + 7), [x2, y2] = polar(a, R - 7);
      const [lx, ly] = polar(a, R + 16);
      lim = `<line class="g-limit" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/><text class="g-tick-label" x="${lx}" y="${ly + 3}" style="fill:var(--critical-ink)">${limit}</text>`;
    }
    const redArc = red ? `<path class="g-red" d="${arc(A0 + (SWEEP * red) / max, A0 + SWEEP, R)}"/>` : "";
    return `<svg viewBox="0 0 200 178" role="img" aria-labelledby="${id}-cap">
      <path class="g-track" d="${arc(A0, A0 + SWEEP, R)}"/>${redArc}
      <path class="g-fill" id="${id}-fill" d="${arc(A0, A0 + SWEEP, R)}" stroke-dasharray="${len.toFixed(1)}" stroke-dashoffset="${len.toFixed(1)}"/>
      ${t}${lim}
      <text class="g-value" id="${id}-val" x="100" y="106">--</text>
      <text class="g-unit" id="${id}-unit" x="100" y="124">${unit}</text>
      <text class="g-unit" id="${id}-prov" x="100" y="160"></text>
    </svg>`;
  }
  function setGauge(id, val, max, color, nullLabel, provText) {
    const fill = $(id + "-fill"), txt = $(id + "-val");
    const len = parseFloat(fill.getAttribute("stroke-dasharray"));
    const f = val == null ? 0 : Math.max(0, Math.min(1, val / max));
    fill.style.stroke = color;
    fill.setAttribute("stroke-dashoffset", (len * (1 - f)).toFixed(1));
    txt.classList.toggle("is-na", val == null);
    txt.textContent = val == null ? nullLabel : Math.round(val).toLocaleString("en-IN");
    $(id + "-prov").textContent = provText;
  }

  /* ---------- tiles ---------- */
  function tileDefs(msg) {
    const ev = msg.source.powertrain === "ev";
    const d = [
      ["rpm", ev ? "Motor speed" : "Engine speed", "rpm", 0],
      ["speed_kmh", "Road speed", "km/h", 0],
      ["gear", "Gear", "", null],
      ["throttle_pct", ev ? "Accelerator" : "Throttle", "%", 1],
      ["engine_load_pct", "Engine load", "%", 1],
      ["coolant_c", "Coolant", "°C", 0],
      ["intake_temp_c", "Intake air", "°C", 0],
      ["ambient_temp_c", "Ambient air", "°C", 0],
      ["map_kpa", "Manifold pressure", "kPa", 0],
      ["maf_gps", "Air flow (MAF)", "g/s", 2],
      ev ? ["ev.soc_pct", "Battery charge", "%", 1] : ["fuel_level_pct", "Fuel level", "%", 1],
      ev ? ["ev.range_km", "Range", "km", 0] : ["fuel_mileage_kmpl", "Fuel economy", "km/L", 1],
      ["battery_v", "12 V battery", "V", 1],
      ["mil_on", "Check-engine lamp", "", null],
      ["dtc_count", "Fault codes", "", 0],
    ];
    return d;
  }
  function tileValue(msg, key) {
    if (key.startsWith("ev.")) return [msg.ev && msg.ev[key.slice(3)], FT.prov(msg, "ev", key.slice(3))];
    return [msg.vehicle[key], FT.prov(msg, "vehicle", key)];
  }

  /* ---------- skeleton ---------- */
  function build(car) {
    const msg = car.msg;
    const sc = scales(msg);
    const ev = msg.source.powertrain === "ev";
    $("gauges").innerHTML =
      `<div class="gauge">${gaugeSvg("g-rpm", sc.rpmMax, sc.rpmRed, ev ? "motor rpm" : "rpm", 7)}<div class="g-caption" id="g-rpm-cap">${ev ? "Motor speed" : "Engine speed"}</div></div>` +
      `<div class="gauge">${gaugeSvg("g-spd", sc.spdMax, null, "km/h", sc.spdMax > 300 ? 7 : sc.spdMax === 140 ? 7 : 5, sc.spdMax > 254 ? 254 : null)}<div class="g-caption" id="g-spd-cap">Road speed</div></div>`;
    $("trend-rpm-label").textContent = ev ? "Motor rpm" : "RPM";
    $("tiles").innerHTML = tileDefs(msg).map(([k, label]) =>
      `<div class="tile" data-k="${k}"><span class="tile-label">${label}</span><span class="tile-value num"></span><span class="prov"></span></div>`).join("");
    $("tri").innerHTML = [["brake", "Brake pedal"], ["clutch", "Clutch pedal"], ["ac_on", "Air conditioning"]].map(([k, l]) =>
      `<div class="tri" data-k="${k}"><span class="tri-label">${l}</span><span class="pill"></span><span class="prov"></span></div>`).join("");
    $("cabin").innerHTML = [["cabin.temp_c", "Cabin temp", "°C", 1], ["cabin.humidity_pct", "Humidity", "%", 0], ["gsm.rssi_dbm", "GSM signal", "dBm", 0]].map(([k, l]) =>
      `<div class="tile" data-k="${k}"><span class="tile-label">${l}</span><span class="tile-value num"></span><span class="prov"></span></div>`).join("");
    $("gps-facts").innerHTML = [["lat", "Latitude"], ["lng", "Longitude"], ["sats", "Satellites"], ["heading_deg", "Heading"]].map(([k, l]) =>
      `<div class="tile" data-k="${k}"><span class="tile-label">${l}</span><span class="tile-value num"></span><span class="prov"></span></div>`).join("");
    $("tpms").innerHTML = `
      ${tyreBox("fl", "")}
      <svg viewBox="0 0 80 150" aria-hidden="true">
        <rect class="tpms-wheel" data-p="fl" x="2" y="22" width="12" height="28" rx="4"/>
        <rect class="tpms-wheel" data-p="fr" x="66" y="22" width="12" height="28" rx="4"/>
        <rect class="tpms-wheel" data-p="rl" x="2" y="98" width="12" height="28" rx="4"/>
        <rect class="tpms-wheel" data-p="rr" x="66" y="98" width="12" height="28" rx="4"/>
        <rect class="tpms-car-body" x="11" y="6" width="58" height="138" rx="22"/>
        <rect class="tpms-car-glass" x="19" y="40" width="42" height="22" rx="6"/>
        <rect class="tpms-car-glass" x="21" y="108" width="38" height="14" rx="5"/>
      </svg>
      ${tyreBox("fr", "right")}${tyreBox("rl", "")}${tyreBox("rr", "right")}
      <div class="tpms-note" id="tpms-note" style="grid-column:1/-1;font-size:.86rem;color:var(--ink-3)"></div>`;
    $("health").innerHTML = [["pps", "Packet rate"], ["crc", "CRC-8 pass"], ["gaps", "Sequence gaps"], ["lost", "Packets lost"], ["age", "Last packet"], ["schema", "Schema"]].map(([k, l]) =>
      `<div class="tile" data-k="${k}"><span class="tile-label">${l}</span><span class="tile-value num"></span></div>`).join("");
    buildWireLabels();
    buildMap(car);
    buildCharts();
    built = car.id + ":" + msg.source.powertrain;
  }
  function tyreBox(p, cls) {
    return `<div class="tyre ${cls}" data-p="${p}"><div class="tyre-pos">${FT.POS_NAME[p]}</div><div class="tyre-p num"></div><div class="tyre-t num"></div></div>`;
  }

  /* ---------- wire strip ---------- */
  const SHORT = { ts: "Time", rpm: "RPM", speed: "Spd", lat: "Latitude", lng: "Longitude", satsfix: "Sat", maf: "MAF", gear: "Gr",
    throttle: "Thr", coolant: "Cool", fuel: "Fuel", battery: "Batt", mil: "MIL", can: "CAN", load: "Load", intake: "IAT",
    ambient: "Amb", map: "MAP", health: "Hlth", seq: "Seq", crc: "CRC", type: "Type", ver: "Ver",
    fl_p: "FL kPa", fl_t: "°C", fr_p: "FR kPa", fr_t: "°C", rl_p: "RL kPa", rl_t: "°C", rr_p: "RR kPa", rr_t: "°C" };
  function buildWireLabels() {
    const lab = (fields) => fields.map(([s, len, key, label, group]) =>
      `<span style="grid-column:${s + 1} / span ${len};--c:var(--s${C.GROUPS[group].slot})" title="${label}">${SHORT[key] || label}</span>`).join("");
    $("labels32").innerHTML = lab(C.FIELDS_32);
    $("labels16").innerHTML = lab(C.FIELDS_16);
    const used = ["frame", "engine", "motion", "gps", "temps", "elec", "body", "crc"];
    $("wire-legend").innerHTML = used.map((g) =>
      `<span><i style="--c:var(--s${C.GROUPS[g].slot})"></i>${C.GROUPS[g].label}</span>`).join("") +
      `<span><i class="na"></i>Not available (sentinel, unpacks to null)</span>`;
  }
  function renderBytes(el, hex, fields, n) {
    const buf = C.fromHex(hex);
    if (!buf || buf.length !== n) {
      el.innerHTML = `<div class="wire-empty" style="grid-column:1/-1">No ${n}-byte packet from this car${n === 16 ? ": no TPMS fitted" : ""}</div>`;
      el.dataset.mode = "empty";
      return null;
    }
    if (el.dataset.mode !== "bytes") {
      el.innerHTML = "";
      for (let i = 0; i < n; i++) { const d = document.createElement("span"); d.className = "byte"; d.dataset.i = i; el.appendChild(d); }
      el.dataset.mode = "bytes";
    }
    const owner = new Array(n);
    fields.forEach((f, fi) => { for (let i = f[0]; i < f[0] + f[1]; i++) owner[i] = fi; });
    for (let i = 0; i < n; i++) {
      const f = fields[owner[i]];
      const node = el.children[i];
      const na = C.isSentinel(buf, f[0], f[1], f[2]);
      node.textContent = buf[i].toString(16).toUpperCase().padStart(2, "0");
      node.className = "byte" + (na ? " na" : "") + (f[4] === "crc" ? " crc" : "");
      node.style.setProperty("--c", `var(--s${C.GROUPS[f[4]].slot})`);
      node.dataset.f = owner[i];
    }
    return buf;
  }

  function decodedText(key, u, msg) {
    const v = u.vehicle, g = u.gps;
    const n = (x, d, unit) => (x == null ? null : (d == null ? x : Number(x).toFixed(d)) + (unit ? " " + unit : ""));
    const tri = (x) => (x == null ? "UNKNOWN" : x ? "ON" : "OFF");
    switch (key) {
      case "ts": return new Date(u.ts).toLocaleTimeString("en-GB", { hour12: false }) + " (Unix " + u.ts / 1000 + ")";
      case "rpm": return n(v.rpm, 0, "rpm");
      case "speed": return v.speed_kmh == null ? null : v.speed_kmh + " km/h" + (v.speed_kmh >= 254 ? " (wire maximum)" : "");
      case "lat": return n(g.lat, 6, "°");
      case "lng": return n(g.lng, 6, "°");
      case "satsfix": return `${g.sats} satellites, ${g.fix ? "fix" : "no fix"}`;
      case "maf": return n(v.maf_gps, 2, "g/s");
      case "gear": return v.gear == null ? null : v.gear === 0 ? "Neutral" : "Gear " + v.gear;
      case "throttle": return n(v.throttle_pct, 1, "%");
      case "coolant": return n(v.coolant_c, 0, "°C");
      case "fuel": return n(v.fuel_level_pct, 1, "%");
      case "battery": return n(v.battery_v, 1, "V");
      case "mil": return v.mil_on == null ? null : `MIL ${v.mil_on ? "on" : "off"}, ${v.dtc_count} codes`;
      case "can": return `Brake ${tri(v.brake)}, clutch ${tri(v.clutch)}, AC ${tri(v.ac_on)}`;
      case "load": return n(v.engine_load_pct, 1, "%");
      case "intake": return n(v.intake_temp_c, 0, "°C");
      case "ambient": return n(v.ambient_temp_c, 0, "°C");
      case "map": return n(v.map_kpa, 0, "kPa");
      case "health": { const d = u.device; return `Power ${d.power_ok ? "ok" : "fault"}, GPS ${d.gps_ok ? "ok" : "no"}, CAN ${d.can_ok ? "ok" : "off"}`; }
      case "seq": return String(u.device.seq);
      case "crc": return u.crc_valid ? "Matches bytes 0–30 (checked in the browser)" : "MISMATCH: packet corrupted";
      default: return null;
    }
  }
  function tpmsText(key, t) {
    if (key === "type") return "0x54, TPMS packet";
    if (key === "ver") return "Layout 1";
    if (key === "seq") return String(t.seq);
    if (key === "crc") return t.crc_valid ? "Matches bytes 0–14 (checked in the browser)" : "MISMATCH: packet corrupted";
    const p = key.slice(0, 2), w = key.slice(3);
    const x = t.tyres[p][w === "p" ? "pressure_kpa" : "temp_c"];
    return x == null ? null : w === "p" ? x.toFixed(1) + " kPa" : x + " °C";
  }

  function attachTips(el, fields, n) {
    el.addEventListener("mousemove", (e) => {
      const node = e.target.closest(".byte");
      if (!node || !current) { FT.hideTip(); return; }
      const car = S.cars[current];
      const hex = n === 32 ? car.msg.packet_hex : car.msg.tpms_hex;
      const buf = C.fromHex(hex);
      if (!buf) return;
      const f = fields[+node.dataset.f];
      const [s, len, key, label, , enc] = f;
      const raw = Array.from(buf.slice(s, s + len), (b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
      const na = C.isSentinel(buf, s, len, key);
      const dec = n === 32 ? decodedText(key, C.unpackPacket(buf), car.msg) : tpmsText(key, C.unpackTpms(buf));
      el.querySelectorAll(".is-hot").forEach((x) => x.classList.remove("is-hot"));
      for (let i = s; i < s + len; i++) el.children[i].classList.add("is-hot");
      FT.showTip(`<div class="tt-title">${len > 1 ? `Bytes ${s}–${s + len - 1}` : `Byte ${s}`}: ${label}</div>
        <div class="tt-row"><span>Raw</span><span class="num">${raw}</span></div>
        <div class="tt-row"><span>Decoded</span><span>${FT.esc(na ? "Not available, unpacks to null" : dec == null ? "null" : dec)}</span></div>
        <div class="tt-row"><span>Encoding</span><span>${enc}</span></div>`, e.clientX, e.clientY);
    });
    el.addEventListener("mouseleave", () => { FT.hideTip(); el.querySelectorAll(".is-hot").forEach((x) => x.classList.remove("is-hot")); });
    let kf = -1;
    const showField = (fi) => {
      const f = fields[fi];
      const node = el.children[f[0]];
      if (!node || !node.classList.contains("byte")) return;
      const r = node.getBoundingClientRect();
      node.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: r.left + r.width / 2, clientY: r.bottom }));
    };
    el.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      kf = (kf + (e.key === "ArrowRight" ? 1 : -1) + fields.length) % fields.length;
      showField(kf);
    });
    el.addEventListener("focus", () => { kf = 0; showField(0); });
    el.addEventListener("blur", () => { FT.hideTip(); el.querySelectorAll(".is-hot").forEach((x) => x.classList.remove("is-hot")); });
  }

  /* ---------- map ---------- */
  function buildMap(car) {
    const g = car.msg.gps;
    const ll = g && g.lat != null ? [g.lat, g.lng] : [13.0, 80.2];
    if (!map) {
      map = L.map("car-map", { zoomControl: true, attributionControl: true }).setView(ll, 15);
      tiles = FT.makeTiles(map);
    } else map.setView(ll, 15, { animate: false });
    if (marker) marker.remove();
    if (trail) trail.remove();
    trail = L.polyline(car.longTrail.slice(), { color: FT.cssVar(`--s${FT.slotFor(car.id)}`), weight: 4, opacity: 0.85, interactive: false }).addTo(map);
    marker = L.marker(ll, { icon: L.divIcon({ className: "", iconSize: [0, 0],
      html: `<div class="car-marker" style="--car:${FT.carColor(car.id)}"><svg class="car-body car-glyph" viewBox="0 0 22 36"><use href="#car-top"/></svg></div>` }), keyboard: false }).addTo(map);
    angle = g && g.heading_deg != null ? g.heading_deg : 0;
    setTimeout(() => map.invalidateSize(), 0);
    if (!buildMap.ro && window.ResizeObserver) {
      buildMap.ro = new ResizeObserver(() => { map.invalidateSize(); resizeCharts(); });
      buildMap.ro.observe(document.querySelector(".gps-map"));
      buildMap.ro.observe($("chart-rpm"));
    }
  }

  /* ---------- charts (two single-axis charts, never a dual axis) ---------- */
  function buildCharts() {
    for (const c of Object.values(charts)) c.destroy();
    charts = {};
    const mk = (elId, color, label) => {
      const el = $(elId);
      el.innerHTML = "";
      const w = Math.max(200, el.clientWidth || 360);
      const grid = { stroke: FT.cssVar("--line"), width: 1 };
      const axis = { stroke: FT.cssVar("--ink-3"), grid, ticks: { stroke: FT.cssVar("--line"), width: 1 }, font: `11px ${"Red Hat Mono"}, monospace` };
      return new uPlot({
        width: w, height: 112, legend: { show: false },
        cursor: { y: false, points: { size: 8 } },
        scales: { x: { time: true }, y: { range: (u, mn, mx) => [0, niceMax(mx)] } },
        axes: [{ ...axis, values: (u, ts) => ts.map((t) => new Date(t * 1000).toLocaleTimeString("en-GB", { hour12: false, minute: "2-digit", second: "2-digit" })) },
               { ...axis, size: 54, splits: (u) => { const m = u.scales.y.max; return [0, m / 2, m]; },
                 values: (u, vals) => vals.map((v) => Math.round(v).toLocaleString("en-IN")) }],
        series: [{}, { label, stroke: color, width: 2, points: { show: false }, spanGaps: false }],
        hooks: { setCursor: [(u) => {
          const i = u.cursor.idx;
          if (i == null || u.data[1][i] == null && u.data[0][i] == null) { FT.hideTip(); return; }
          const rect = u.over.getBoundingClientRect();
          const v = u.data[1][i];
          FT.showTip(`<div class="tt-title">${label}</div><div class="tt-row"><span>${new Date(u.data[0][i] * 1000).toLocaleTimeString("en-GB", { hour12: false })}</span><span class="num">${v == null ? "no reading" : Math.round(v).toLocaleString("en-IN")}</span></div>`,
            rect.left + u.cursor.left, rect.top + u.cursor.top);
        }] },
      }, [[], []], el);
    };
    charts.rpm = mk("chart-rpm", FT.cssVar("--s1"), "RPM");
    charts.spd = mk("chart-spd", FT.cssVar("--s2"), "Speed, km/h");
    ["chart-rpm", "chart-spd"].forEach((id) => $(id).addEventListener("mouseleave", FT.hideTip));
  }
  function niceMax(mx) {
    if (!(mx > 0)) return 10;
    const p = Math.pow(10, Math.floor(Math.log10(mx)));
    for (const k of [1, 2, 2.5, 4, 5, 8, 10]) if (k * p >= mx * 1.05) return k * p;
    return 10 * p;
  }
  function resizeCharts() {
    for (const [k, c] of Object.entries(charts)) {
      const el = $(k === "rpm" ? "chart-rpm" : "chart-spd");
      const w = el.clientWidth;
      if (w && Math.abs(w - c.width) > 2) c.setSize({ width: w, height: 112 });
    }
  }

  /* ---------- update ---------- */
  function setTile(node, value, state, msg, digits, unit, opts) {
    const valEl = node.querySelector(".tile-value");
    const provEl = node.querySelector(".prov");
    const isNull = value == null;
    node.classList.toggle("is-null", isNull);
    let html;
    if (isNull) html = FT.esc(FT.nullText(state, msg));
    else if (opts && opts.text) html = FT.esc(opts.text);
    else html = FT.esc(digits == null ? String(value) : Number(value).toFixed(digits)) + (unit ? `<small>${unit}</small>` : "");
    if (opts && opts.extra) html += opts.extra;
    if (valEl.innerHTML !== html) valEl.innerHTML = html;
    const pt = FT.provText(state, msg);
    if (provEl.dataset.p !== state || provEl.textContent !== pt) { provEl.dataset.p = state; provEl.textContent = pt; provEl.title = pt; }
    node.classList.toggle("is-alert", !!(opts && opts.alert));
  }

  function update() {
    const car = current && S.cars[current];
    if (!car || !car.msg) return waiting();
    const msg = car.msg;
    if (built !== car.id + ":" + msg.source.powertrain) build(car);
    const v = msg.vehicle, src = msg.source, ev = src.powertrain === "ev";

    // header
    $("car-glyph").style.setProperty("--car", FT.carColor(car.id));
    $("car-name").textContent = src.name;
    $("car-year").textContent = src.model_year || "";
    $("car-plate").textContent = src.reg_no || "No plate";
    $("car-plate").dataset.ev = ev;
    $("car-power").textContent = ev ? "Electric" : "Petrol";
    $("car-mode").outerHTML = FT.modeTag(src.data_mode).replace("<span class=\"tag", "<span id=\"car-mode\" class=\"tag");
    document.title = `${src.name} - Fleet Telemetry`;

    // wire
    const b32 = renderBytes($("bytes32"), msg.packet_hex, C.FIELDS_32, 32);
    const b16 = renderBytes($("bytes16"), msg.tpms_hex, C.FIELDS_16, 16);
    $("wire-seq").textContent = msg.device ? "seq " + msg.device.seq : "";
    const crcState = (ok) => ok == null ? "" : ok ? `<span style="color:var(--good-ink)">${FT.icon("i-check")} CRC-8 ok</span>` : `<span style="color:var(--critical-ink)">${FT.icon("i-crit")} CRC-8 failed</span>`;
    $("crc32").innerHTML = b32 ? crcState(car.crc32) : "";
    $("crc16").innerHTML = b16 ? crcState(car.crc16) : `<span style="color:var(--ink-3)">${FT.esc(FT.provText(FT.prov(msg, "tyres"), msg))}</span>`;
    $("labels16").hidden = !b16;

    // gauges
    const sc = scales(msg);
    const pr = FT.prov(msg, "vehicle", "rpm"), ps = FT.prov(msg, "vehicle", "speed_kmh");
    setGauge("g-rpm", v.rpm, sc.rpmMax, v.rpm != null && v.rpm >= sc.rpmRed ? FT.cssVar("--critical") : FT.cssVar("--s1"), FT.nullText(pr, msg), FT.provText(pr, msg));
    setGauge("g-spd", v.speed_kmh, sc.spdMax, FT.cssVar("--s2"), FT.nullText(ps, msg), FT.provText(ps, msg));
    if (v.speed_kmh != null && v.speed_kmh >= 254) $("g-spd-val").textContent = "254+";
    $("obd-limit").hidden = !(v.speed_kmh != null && v.speed_kmh >= 254);

    // tiles
    for (const [k, , unit, digits] of tileDefs(msg)) {
      const node = $("tiles").querySelector(`[data-k="${k}"]`);
      if (!node) continue;
      const [val, state] = tileValue(msg, k);
      let opts = {};
      if (k === "gear" && val != null) opts.text = val === 0 ? "N" : String(val);
      if (k === "mil_on" && val != null) { opts.text = val ? "ON" : "OFF"; opts.alert = val; }
      if (k === "dtc_count" && val != null) opts.alert = val > 0;
      if (k === "coolant_c" && val != null) opts.alert = val > 105;
      if (k === "speed_kmh" && val != null && val >= 254) opts.text = "254+";
      if (k === "battery_v" && val != null) opts.alert = val < 12;
      if (k === "ev.soc_pct" && val != null) opts.extra = `<div class="soc"><i style="width:${Math.max(0, Math.min(100, val))}%"></i></div>`;
      setTile(node, val, state, msg, digits, unit, opts);
    }
    $("prov-vehicle").innerHTML = FT.provTag(FT.prov(msg, "vehicle"), msg);

    // CAN body: three states, null is UNKNOWN (never OFF)
    for (const node of $("tri").children) {
      const k = node.dataset.k;
      const val = v[k], state = FT.prov(msg, "vehicle", k);
      const pill = node.querySelector(".pill");
      const word = val == null ? "UNKNOWN" : val ? "ON" : "OFF";
      pill.dataset.v = word.toLowerCase();
      pill.innerHTML = (val == null ? FT.icon("i-unknown") : "") + word;
      const p = node.querySelector(".prov");
      p.dataset.p = state;
      // Schema: a null body signal means "not found on the CAN bus yet" -- say exactly that.
      p.textContent = val == null && state !== "not_applicable" ? "Not found on the CAN bus" : FT.provText(state, msg);
      p.title = val == null ? "UNKNOWN is not OFF: the validity bit in byte 24 is 0, so the state is not known" : "";
    }

    // cabin + GSM
    const cab = msg.cabin || {}, gsm = msg.gsm || {};
    for (const node of $("cabin").children) {
      const k = node.dataset.k;
      const [grp, leaf] = k.split(".");
      const val = (grp === "cabin" ? cab : gsm)[leaf];
      const state = FT.prov(msg, grp, leaf);
      const opts = {};
      if (k === "gsm.rssi_dbm" && val != null) {
        const bars = val >= -70 ? 4 : val >= -85 ? 3 : val >= -95 ? 2 : val >= -105 ? 1 : 0;
        opts.extra = `<span class="bars" aria-label="${bars} of 4 bars">${[1, 2, 3, 4].map((b) => `<i class="${b <= bars ? "on" : ""}" style="height:${b * 25}%"></i>`).join("")}</span>`;
      }
      setTile(node, val, state, msg, k === "cabin.temp_c" ? 1 : 0, k === "gsm.rssi_dbm" ? "dBm" : k === "cabin.temp_c" ? "°C" : "%", opts);
    }

    // GPS
    const g = msg.gps || {};
    const gs = FT.prov(msg, "gps");
    $("prov-gps").innerHTML = FT.provTag(gs, msg) + (src.vehicle_id === "fronx" && src.data_mode === "recorded" && gs === "simulated"
      ? `<span class="prov" data-p="simulated" title="The 31 July log has no GPS, so the car is parked at a fixed point on GST Road">fixed position</span>` : "");
    const fact = (k) => $("gps-facts").querySelector(`[data-k="${k}"]`);
    setTile(fact("lat"), g.lat, gs, msg, 6, "°");
    setTile(fact("lng"), g.lng, gs, msg, 6, "°");
    setTile(fact("sats"), g.sats, gs, msg, 0, "", { text: `${g.sats} ${g.fix ? "with fix" : "no fix"}` });
    const comp = (d) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(d / 45) % 8];
    setTile(fact("heading_deg"), g.heading_deg, gs, msg, 0, "", g.heading_deg == null ? {} : {
      text: `${Math.round(g.heading_deg)}° ${comp(g.heading_deg)}`,
      extra: `<svg class="icon compass" style="transform:rotate(${g.heading_deg}deg)"><use href="#i-compass"/></svg>` });
    if (map && g.fix && g.lat != null) {
      const ll = [g.lat, g.lng];
      marker.setLatLng(ll);
      const d = ((g.heading_deg || 0) - (angle % 360) + 540) % 360 - 180; angle += d;
      const el = marker.getElement(); el && (el.querySelector(".car-body").style.transform = `rotate(${angle}deg)`);
      trail.setLatLngs(car.longTrail);
      if (!map.getBounds().pad(-0.25).contains(ll)) map.panTo(ll, { animate: true, duration: 0.8 });
    }

    // TPMS
    const tst = FT.prov(msg, "tyres");
    $("prov-tyres").innerHTML = FT.provTag(tst, msg);
    for (const p of ["fl", "fr", "rl", "rr"]) {
      const t = (msg.tyres || {})[p] || {};
      const box = $("tpms").querySelector(`.tyre[data-p="${p}"]`);
      const wheel = $("tpms").querySelector(`.tpms-wheel[data-p="${p}"]`);
      const low = t.pressure_kpa != null && t.pressure_kpa < 180, hot = t.temp_c != null && t.temp_c > 90;
      box.classList.toggle("is-null", t.pressure_kpa == null);
      box.classList.toggle("is-alert", low || hot);
      wheel.setAttribute("class", "tpms-wheel" + (t.pressure_kpa == null ? " is-null" : low || hot ? " is-alert" : ""));
      box.querySelector(".tyre-p").innerHTML = t.pressure_kpa == null ? FT.esc(FT.nullText(tst, msg)) : `${t.pressure_kpa.toFixed(0)}<small> kPa</small>`;
      const tt = box.querySelector(".tyre-t");
      tt.textContent = t.temp_c == null ? "" : `${t.temp_c} °C`;
      tt.classList.toggle("hot", hot);
    }
    $("tpms-note").textContent = tst === "not_supported" ? (src.vehicle_id === "fronx"
      ? "TPMS sensors were designed for but never fitted to this car, so no 16-byte packet is sent."
      : "This car has no TPMS sensors, so no 16-byte packet is sent.") : "Alert below 180 kPa or above 90 °C.";

    // charts
    const xs = car.hist.map((h) => h.t), now = Date.now() / 1000;
    charts.rpm.setData([xs, car.hist.map((h) => h.rpm)], false);
    charts.rpm.setScale("x", { min: now - 120, max: now });
    charts.spd.setData([xs, car.hist.map((h) => h.speed)], false);
    charts.spd.setScale("x", { min: now - 120, max: now });
    $("trend-rpm-now").textContent = v.rpm == null ? FT.nullText(pr, msg) : Math.round(v.rpm).toLocaleString("en-IN");
    $("trend-spd-now").textContent = v.speed_kmh == null ? FT.nullText(ps, msg) : (v.speed_kmh >= 254 ? "254+" : v.speed_kmh);

    tick();
  }

  function waiting() {
    $("car-name").textContent = current ? `Waiting for ${current}` : "Car";
    $("car-age").textContent = "--";
  }

  function tick() {
    const car = current && S.cars[current];
    if (!car || !car.msg) return;
    const age = Date.now() - car.lastRx;
    const stale = age > 3000;
    $("car-age").textContent = FT.ageStr(age) + (age < 1000 ? "" : " ago");
    const st = FT.statusOf(car);
    $("car-status").dataset.s = st;
    $("car-status").textContent = FT.STATUS_WORD[st];
    const msg = car.msg;
    const groups = { wire: "vehicle", gauges: "vehicle", vehicle: "vehicle", can: "vehicle", cabin: "cabin", gps: "gps", tyres: "tyres" };
    for (const [el, grp] of Object.entries(groups)) {
      const dot = $("fresh-" + el);
      if (!dot) continue;
      const na = ["not_supported", "not_applicable"].includes(FT.prov(msg, grp));
      dot.className = "fresh" + (na ? " is-na" : stale ? " is-stale" : "");
      dot.title = na ? "Not supported by this vehicle" : stale ? `Stale: no packet for ${FT.ageStr(age)}` : "Fresh: updated in the last 3 s";
    }
    const h = (k) => $("health").querySelector(`[data-k="${k}"] .tile-value`);
    if (!h("pps")) return;
    const pps = car.rxTimes.filter((t) => Date.now() - t <= 10000).length / 10;
    h("pps").innerHTML = `${pps.toFixed(1)}<small>/s</small>`;
    h("crc").innerHTML = car.crcTotal ? `${(100 * car.crcOk / car.crcTotal).toFixed(car.crcOk === car.crcTotal ? 0 : 1)}<small>% of ${car.crcTotal}</small>` : "--";
    h("gaps").textContent = String(car.gaps);
    const expected = car.crcTotal + car.lost;
    h("lost").innerHTML = `${car.lost}<small>${expected ? " (" + (100 * car.lost / expected).toFixed(1) + "%)" : ""}</small>`;
    h("age").textContent = FT.ageStr(age);
    h("schema").textContent = msg.schema_version || "--";
    const fl = ["vehicle", "tyres", "gps", "cabin", "gsm", "ev"].map((grp) => {
      const p = FT.prov(msg, grp);
      const na = p === "not_supported" || p === "not_applicable";
      const word = { vehicle: "Vehicle", tyres: "Tyres", gps: "GPS", cabin: "Cabin", gsm: "GSM", ev: "EV" }[grp];
      return `<span title="${na ? FT.esc(FT.provText(p, msg)) : stale ? "Stale" : "Fresh"}"><span class="fresh${na ? " is-na" : stale ? " is-stale" : ""}"></span>${word}${na ? (p === "not_applicable" ? " (not applicable)" : " (not fitted)") : ""}</span>`;
    }).join("");
    if ($("fresh-list").innerHTML !== fl) $("fresh-list").innerHTML = fl;
  }

  FT.Car = {
    init() {
      attachTips($("bytes32"), C.FIELDS_32, 32);
      attachTips($("bytes16"), C.FIELDS_16, 16);
      $("back").addEventListener("click", () => { location.hash = "#fleet"; });
      FT.on((what, car) => {
        if (!current) return;
        if ((what === "telemetry" || what === "newcar") && car.id === current) update();
        if (what === "tick") tick();
      });
      window.addEventListener("resize", () => { if (current) { resizeCharts(); map && map.invalidateSize(); } });
    },
    open(id) {
      current = id; built = null;
      const car = S.cars[id];
      if (car && car.msg) update(); else waiting();
      setTimeout(() => { resizeCharts(); map && map.invalidateSize(); }, 30);
    },
    close() { current = null; FT.hideTip(); },
    retheme() {
      if (tiles) tiles.rebuild();
      if (current && S.cars[current] && S.cars[current].msg) { buildCharts(); trail && trail.setStyle({ color: FT.cssVar(`--s${FT.slotFor(current)}`) }); update(); }
    },
  };
})();
