/* console.js -- Control Console, Driver Simulator (schema v2.2.0).
 *
 * A person drives one car with pedals, a gear lever and an emergency stop. Every
 * packet is built exactly like the simulator's: FTCodec.packPacket (the browser
 * port of obd_decoder.pack_packet, byte-identical, CRC-8) and packTpms, then
 * unpacked and sent as schema JSON over the backend WebSocket. 5 Hz while the
 * ignition is on, 1 Hz when it is off. The car follows a road loop around the
 * Crescent campus in Vandalur and GST Road (demo/data/routes/live.json).
 */
(function () {
  "use strict";
  const C = window.FTCodec;
  const FT = window.FT;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const approach = (cur, t, up, down) => (t > cur ? Math.min(t, cur + up) : Math.max(t, cur - down));

  /* ---------------- identity ---------------- */
  const rand = (n, set) => Array.from({ length: n }, () => set[Math.floor(Math.random() * set.length)]).join("");
  // One car per page load, so two tabs (or a phone and a laptop) join as two cars.
  const VID = "live-" + rand(4, "abcdefghjkmnpqrstuvwxyz23456789");
  const fakeReg = () => `TN ${["01", "09", "11", "14", "19", "22"][Math.floor(Math.random() * 6)]} ${rand(2, "ABCDEFGHJKLMNPRSTUVWXYZ")} ${rand(4, "0123456789")}`;

  const CARS = {
    demo:  { name: "Live Demo Car", year: 2024, trans: "manual", ratios: [140, 80, 53, 37, 27, 21], rev: 140, mass: 1150, disp: 1.2, tq: 115 },
    swift: { name: "Maruti Suzuki Swift", year: 2024, trans: "manual", ratios: [138, 78, 52, 38, 29, 23], rev: 138, mass: 920, disp: 1.2, tq: 113 },
    creta: { name: "Hyundai Creta", year: 2024, trans: "automatic", ratios: [128, 74, 50, 37, 29, 23], rev: 128, mass: 1300, disp: 1.5, tq: 144 },
  };
  const IDLE = 800, LIMIT = 6000, AMBIENT = 31;

  /* ---------------- route ---------------- */
  const rad = (d) => (d * Math.PI) / 180;
  function hav(a, b) {
    const la1 = rad(a[0]), la2 = rad(b[0]);
    const h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(h));
  }
  function bearing(a, b) {
    const la1 = rad(a[0]), la2 = rad(b[0]), dl = rad(b[1] - a[1]);
    return ((Math.atan2(Math.sin(dl) * Math.cos(la2), Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl)) * 180) / Math.PI + 360) % 360;
  }
  const route = (function () {
    const raw = (window.LIVE_ROUTE && window.LIVE_ROUTE.coords) || [[12.87489, 80.0848], [12.8905, 80.081]];
    const pts = [raw[0]];
    for (const p of raw.slice(1)) if (hav(pts[pts.length - 1], p) > 0.5) pts.push(p);
    if (hav(pts[0], pts[pts.length - 1]) > 1) pts.push(pts[0]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hav(pts[i - 1], pts[i]));
    const len = cum[cum.length - 1];
    return {
      len,
      at(s) {
        s = ((s % len) + len) % len;
        let lo = 0, hi = cum.length - 1;
        while (lo < hi - 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
        const a = pts[lo], b = pts[lo + 1], L = cum[lo + 1] - cum[lo], f = L > 0 ? (s - cum[lo]) / L : 0;
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, bearing(a, b)];
      },
    };
  })();

  /* ---------------- state ---------------- */
  const S = {
    carKey: "demo", connected: false, wanted: false, ws: null,
    ign: false, v: 0, rpm: 0, gear: 0, autoSel: "P", autoGear: 1, limiter: false,
    ped: { throttle: 0, brake: 0, clutch: 0 }, held: { throttle: false, brake: false, clutch: false },
    keys: { throttle: false, brake: false, clutch: false },
    estop: false, stoppedAt: 0,
    coolant: AMBIENT, fuel: 62, intake: AMBIENT + 4, s: 0, heading: 0,
    tyreT: { fl: 31, fr: 31, rl: 31, rr: 31 }, cabinT: 30.5, cabinH: 61, rssi: -70,
    seq: Math.floor(Math.random() * 256), sent: 0, sentTimes: [], lastSendAt: 0, lastHex: null,
    t: 0, notice: null, noticeUntil: 0,
  };
  window.__console = S;          // for the Playwright checks
  const car = () => CARS[S.carKey];
  const manual = () => car().trans === "manual";

  /* ---------------- physics (20 Hz) ---------------- */
  const torqueCurve = (rpm) => clamp(0.55 + 0.45 * (1 - ((rpm - 3800) / 3200) ** 2), 0.4, 1);

  function gearIndex() {           // -1 = reverse, 0 = neutral/park, 1..6
    if (manual()) return S.gear;
    return S.autoSel === "D" ? S.autoGear : S.autoSel === "R" ? -1 : 0;
  }

  function step(dt) {
    S.t += dt;
    const c = car();
    const kmh = Math.abs(S.v) * 3.6;

    // pedals: held by pointer, ramped by keys, otherwise spring back to 0
    for (const k of ["throttle", "brake", "clutch"]) {
      if (S.keys[k]) S.ped[k] = approach(S.ped[k], 1, (k === "clutch" ? 6 : k === "brake" ? 3 : 2.5) * dt, 0);
      else if (!S.held[k]) S.ped[k] = approach(S.ped[k], 0, 0, 7 * dt);
    }
    if (!manual()) S.ped.clutch = 0;

    const thr = S.estop || !S.ign ? 0 : S.ped.throttle;
    const brk = S.estop ? 1 : S.ped.brake;
    const g = gearIndex();
    const ratio = g === 0 ? 0 : g === -1 ? c.rev : c.ratios[g - 1];
    const couple = !S.ign || g === 0 ? 0 : manual() ? clamp(1 - S.ped.clutch / 0.6, 0, 1) : 1;
    const idle = IDLE + 35 * Math.sin(S.t * 1.7);
    const wheelRpm = kmh * ratio;
    let driveF = 0;

    if (!S.ign) {
      S.rpm = approach(S.rpm, 0, 0, 2500 * dt);
      S.limiter = false;
    } else {
      const free = idle + thr * (6400 - idle);
      // Forgiving: a slipping clutch / torque converter keeps the engine above idle -- it never stalls.
      const slipFloor = idle + thr * (manual() ? 1500 : 2000);
      const engaged = wheelRpm >= slipFloor ? wheelRpm : slipFloor;
      const target = couple * engaged + (1 - couple) * free;
      S.rpm = approach(S.rpm, target, 4500 * dt, 3500 * dt);
      S.limiter = S.rpm >= LIMIT || wheelRpm * couple > LIMIT;
      if (S.limiter) S.rpm = LIMIT - 120 * Math.random();
      let eng = S.limiter ? 0 : c.tq * torqueCurve(S.rpm) * thr;
      if (thr < 0.02 && couple > 0.5 && wheelRpm > idle + 200) eng = -0.12 * c.tq * (S.rpm / LIMIT + 0.2);   // engine braking
      if (!manual() && S.autoSel === "D" && thr < 0.02 && kmh < 7 && brk < 0.05) eng = 0.1 * c.tq;          // automatic creep
      driveF = (eng * (ratio / 8.77) * 0.88 / 0.3) * couple * (g === -1 ? -1 : 1);
    }

    const m = c.mass;
    const brakeF = brk * 8.5 * m + (S.estop ? 2 * m : 0);
    const roll = 0.013 * m * 9.81;
    const aero = 0.5 * 1.2 * 0.68 * S.v * S.v;
    if (Math.abs(S.v) < 0.05) {
      const hold = brakeF + roll;
      S.v = Math.abs(driveF) > hold ? ((driveF - Math.sign(driveF) * hold) / m) * dt : 0;
    } else {
      const a = (driveF - Math.sign(S.v) * (brakeF + roll + aero)) / m;
      const nv = S.v + a * dt;
      S.v = Math.sign(nv) !== Math.sign(S.v) ? 0 : nv;
    }

    // automatic gearbox
    if (!manual() && S.autoSel === "D") {
      const r = kmh * c.ratios[S.autoGear - 1];
      if (r > 2100 + thr * 2900 && S.autoGear < 6) S.autoGear++;
      else if (r < 1150 + thr * 900 && S.autoGear > 1) S.autoGear--;
    }

    // emergency stop releases itself 3 s after the car has stopped
    if (S.estop) {
      if (S.v === 0) { S.stoppedAt = S.stoppedAt || performance.now(); if (performance.now() - S.stoppedAt > 3000) S.estop = false; }
      else S.stoppedAt = 0;
    }

    // position along the loop, heading follows the road
    S.s += S.v * dt;
    const p = route.at(S.s);
    S.lat = p[0]; S.lng = p[1]; S.heading = p[2];

    // slow things (sped up so the warm-up is visible within a couple of minutes)
    if (S.ign) {
      S.coolant = approach(S.coolant, 90, (0.35 + S.rpm / 6000) * dt * (90 - S.coolant) / 25 + 0.02 * dt, 0);
      const maf = mafOf(S.rpm, loadOf(thr, couple));
      S.fuel = Math.max(5, S.fuel - maf * dt * 0.00006 * 20);
    } else {
      S.coolant = approach(S.coolant, AMBIENT, 0, 0.05 * dt);
    }
    S.intake = approach(S.intake, AMBIENT + 4 + S.rpm / 900 - kmh * 0.04, 0.3 * dt, 0.3 * dt);
    for (const pos of ["fl", "fr", "rl", "rr"]) S.tyreT[pos] = approach(S.tyreT[pos], 31 + kmh * 0.09 + (pos[0] === "r" ? 1.5 : 0) + brk * 2, 0.08 * dt, 0.05 * dt);
    S.cabinT = approach(S.cabinT, S.ign ? 24 : 31, 0.04 * dt, 0.04 * dt);
    S.rssi = clamp(S.rssi + (Math.random() - 0.5) * 0.6, -80, -60);
  }
  const loadOf = (thr, couple) => (couple > 0.5 ? 18 + thr * 75 : 15 + thr * 40);
  const mafOf = (rpm, load) => Math.max(1.3, (rpm / 60) * (car().disp / 2) * 1.18 * (load / 100));

  /* ---------------- packet ---------------- */
  function reportedGear() {
    if (manual()) return S.gear === -1 ? 14 : S.gear;
    return S.autoSel === "R" ? 14 : S.autoSel === "D" ? S.autoGear : 0;
  }

  function buildMessage(nowMs) {
    const c = car(), on = S.ign;
    const kmh = Math.abs(S.v) * 3.6;
    const thr = S.estop || !on ? 0 : S.ped.throttle;
    const g = gearIndex();
    const couple = !on || g === 0 ? 0 : manual() ? clamp(1 - S.ped.clutch / 0.6, 0, 1) : 1;
    const load = loadOf(thr, couple);
    // Ignition off = ECU asleep: engine PIDs are unavailable (sentinels); the ELM327 still reads the battery.
    const d = on ? {
      rpm: S.rpm, speed: kmh, coolant: S.coolant, load, throttle: thr * 100, fuel: S.fuel,
      maf: mafOf(S.rpm, load), intake: S.intake, ambient: AMBIENT, map: clamp(28 + load * 0.7, 20, 101), mil: [false, 0],
    } : {};
    const can = { brake: S.estop || S.ped.brake > 0.05, clutch: manual() ? S.ped.clutch > 0.5 : null, ac: on };
    const gps = { lat: S.lat, lng: S.lng, sats: 8 + Math.floor(Math.random() * 3), fix: true };
    S.seq = (S.seq + 1) & 0xff;
    const pkt = C.packPacket(d, gps, { battery_v: on ? 14.1 : 12.4, gear: reportedGear(), seq: S.seq, can,
      health: { power_ok: true, gps_ok: true, can_ok: true } }, Math.floor(nowMs / 1000));
    const u = C.unpackPacket(pkt);
    const raw = {};
    for (const p of ["fl", "fr", "rl", "rr"]) {
      const cold = p[0] === "f" ? 230 : 225;
      raw[p] = { pressure_kpa: cold * (S.tyreT[p] + 273.15) / 303.15, temp_c: S.tyreT[p] };
    }
    const tp = C.packTpms(raw, S.seq), tu = C.unpackTpms(tp);
    const vehicle = Object.assign({}, u.vehicle);
    let kmpl = null;
    if (vehicle.maf_gps && vehicle.speed_kmh >= 3) kmpl = Math.round((vehicle.speed_kmh / ((vehicle.maf_gps * 3600) / (14.7 * 745))) * 10) / 10;
    vehicle.fuel_mileage_kmpl = kmpl;
    S.lastHex = C.toHex(pkt);
    return {
      type: "telemetry", schema_version: C.SCHEMA_VERSION, ts: nowMs,
      source: { vehicle_id: VID, name: c.name, model_year: c.year, reg_no: $("reg").value.trim().toUpperCase() || null,
        powertrain: "petrol", data_mode: "live", control: "manual" },
      driver: { ignition: S.ign, throttle_pedal_pct: Math.round(S.ped.throttle * 100), brake_pedal_pct: Math.round(S.ped.brake * 100),
        clutch_pedal_pct: manual() ? Math.round(S.ped.clutch * 100) : null, transmission: c.trans, estop: S.estop },
      vehicle, tyres: tu.tyres,
      gps: Object.assign({}, u.gps, { heading_deg: Math.round(S.heading * 10) / 10 }),
      device: u.device,
      cabin: { temp_c: Math.round(S.cabinT * 10) / 10, humidity_pct: Math.round(S.cabinH) },
      gsm: { rssi_dbm: Math.round(S.rssi) },
      ev: { soc_pct: null, range_km: null },
      packet_hex: S.lastHex, tpms_hex: C.toHex(tp), crc_valid: u.crc_valid, tpms_crc_valid: tu.crc_valid,
      provenance: {
        vehicle: "simulated", tyres: "simulated", gps: "simulated", cabin: "simulated", gsm: "simulated",
        ev: "not_applicable", driver: "measured",
        fields: {
          "vehicle.throttle_pct": "measured", "vehicle.brake": "measured", "vehicle.gear": "measured",
          "vehicle.clutch": manual() ? "measured" : "not_applicable", "vehicle.fuel_mileage_kmpl": "derived",
          "driver.clutch_pedal_pct": manual() ? "measured" : "not_applicable",
        },
      },
    };
  }

  /* ---------------- network ---------------- */
  function defaultWs() {
    if (location.protocol === "http:" || location.protocol === "https:") return (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";
    return "ws://localhost:8000/ws";
  }
  function setLink(state, text) { $("link").dataset.state = state; $("link-text").textContent = text; }

  function connect() {
    S.wanted = true;
    let ws;
    try { ws = new WebSocket($("ws-url").value.trim() || defaultWs()); }
    catch (e) { notice("warning", "That WebSocket address is not valid. Check the Backend WebSocket field."); return; }
    S.ws = ws;
    setLink("connecting", "Connecting");
    ws.onopen = () => {
      S.connected = true;
      setLink("live", "Live: backend WebSocket");
      $("setup").hidden = true; $("summary").hidden = false;
      $("sum-name").textContent = car().name; $("sum-plate").textContent = $("reg").value.trim().toUpperCase();
      $("sum-vid").textContent = VID;
      renderGearbox();
      sendNow();
    };
    ws.onmessage = () => { /* the backend fans out every car's telemetry; the console ignores it */ };
    ws.onclose = () => {
      const was = S.connected;
      S.connected = false; S.ws = null;
      if (S.wanted) {
        setLink("reconnecting", "Reconnecting");
        if (!was) notice("warning", "Could not reach the backend. Is python demo/run_demo.py running, and is this the right address?");
        setTimeout(() => { if (S.wanted && !S.connected) connect(); }, 1500);
      } else setLink("down", "Not connected");
    };
    ws.onerror = () => { /* onclose follows */ };
  }
  function disconnect() {
    S.wanted = false;
    if (S.ws) S.ws.close();
    S.ign = false; S.v = 0;
    $("setup").hidden = false; $("summary").hidden = true;
    setLink("down", "Not connected");
  }

  function sendNow() {
    if (!S.connected || !S.ws || S.ws.readyState !== 1) return;
    const now = Date.now();
    S.ws.send(JSON.stringify(buildMessage(now)));
    S.sent++; S.lastSendAt = now; S.sentTimes.push(now);
    while (S.sentTimes.length && now - S.sentTimes[0] > 3000) S.sentTimes.shift();
    renderWire();
  }

  /* ---------------- controls ---------------- */
  function bindPedal(key) {
    const el = $("p-" + key), track = el.querySelector(".pedal-track");
    const setY = (y) => { const r = track.getBoundingClientRect(); S.ped[key] = clamp((y - r.top) / r.height, 0, 1); };
    track.addEventListener("pointerdown", (e) => {
      if (el.classList.contains("is-disabled")) return;
      e.preventDefault();
      track.setPointerCapture(e.pointerId);
      S.held[key] = true; el.classList.add("is-held"); setY(e.clientY);
    });
    track.addEventListener("pointermove", (e) => { if (S.held[key] && track.hasPointerCapture(e.pointerId)) setY(e.clientY); });
    const up = () => { S.held[key] = false; el.classList.remove("is-held"); };
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((ev) => track.addEventListener(ev, up));
    track.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  const MANUAL_ORDER = [-1, 0, 1, 2, 3, 4, 5, 6];
  const AUTO_ORDER = ["P", "R", "N", "D"];
  const gearLabel = (g) => (g === -1 ? "R" : g === 0 ? "N" : String(g));
  function renderGearbox() {
    const box = $("gearbox");
    const auto = !manual();
    box.classList.toggle("auto", auto);
    const items = auto ? AUTO_ORDER : MANUAL_ORDER;
    box.innerHTML = items.map((g) => {
      const label = auto ? g : gearLabel(g);
      return `<button class="gear" type="button" role="radio" data-g="${label}" data-v="${g}" aria-checked="false" aria-label="${auto ? "Selector " + label : label === "R" ? "Reverse" : label === "N" ? "Neutral" : "Gear " + label}">${label}</button>`;
    }).join("");
    $("p-clutch").classList.toggle("is-disabled", auto);
    $("p-clutch").querySelector(".pedal-name").textContent = auto ? "No clutch" : "Clutch";
    syncGearbox();
  }
  function syncGearbox() {
    const cur = manual() ? String(S.gear) : S.autoSel;
    for (const b of $("gearbox").children) b.setAttribute("aria-checked", b.dataset.v === cur ? "true" : "false");
  }
  function selectGear(val) {
    const kmh = Math.abs(S.v) * 3.6;
    if (manual()) {
      const g = Number(val);
      if (g === -1 && S.v > 1.4) return notice("warning", "Stop before selecting reverse.");
      if (g > 0 && S.v < -1.4) return notice("warning", "Stop before selecting a forward gear.");
      S.gear = g;
    } else {
      if ((val === "R" && S.v > 1.4) || (val === "D" && S.v < -1.4)) return notice("warning", "Stop before changing direction.");
      if (val === "P" && kmh > 3) return notice("warning", "Stop before selecting Park.");
      S.autoSel = val;
      if (val === "D") S.autoGear = 1;
    }
    syncGearbox();
  }
  function shift(dir) {
    if (manual()) {
      const i = MANUAL_ORDER.indexOf(S.gear) + dir;
      if (i >= 0 && i < MANUAL_ORDER.length) selectGear(MANUAL_ORDER[i]);
    } else {
      const i = AUTO_ORDER.indexOf(S.autoSel) + dir;
      if (i >= 0 && i < AUTO_ORDER.length) selectGear(AUTO_ORDER[i]);
    }
  }
  function toggleIgnition() {
    S.ign = !S.ign;
    if (S.ign && S.rpm < 300) S.rpm = 1100;     // starter kick, settles to idle
    sendNow();
  }
  function emergencyStop() {
    S.estop = true; S.stoppedAt = 0;
    S.ped.throttle = 0;
    sendNow();
  }

  /* horn: two-tone, just for fun, no data */
  let audio = null, hornNodes = null;
  function horn(on) {
    $("horn").classList.toggle("is-on", on);
    try {
      if (on && !hornNodes) {
        audio = audio || new (window.AudioContext || window.webkitAudioContext)();
        const gain = audio.createGain(); gain.gain.value = 0.08; gain.connect(audio.destination);
        hornNodes = [415, 520].map((f) => { const o = audio.createOscillator(); o.type = "square"; o.frequency.value = f; o.connect(gain); o.start(); return o; });
        hornNodes.gain = gain;
      } else if (!on && hornNodes) { hornNodes.forEach((o) => o.stop()); hornNodes.gain.disconnect(); hornNodes = null; }
    } catch (e) { /* no audio available: the button still shows it */ }
  }

  function notice(tone, text) { S.notice = { tone, text }; S.noticeUntil = performance.now() + 3500; }

  /* ---------------- render ---------------- */
  let lastBanner = "";
  function banner() {
    const kmh = Math.abs(S.v) * 3.6;
    let tone = "neutral", icon = "i-info", text = "Choose a car and press Connect.";
    if (S.estop) { tone = "critical"; icon = "i-crit"; text = kmh > 0.5 ? "EMERGENCY STOP: braking hard" : "EMERGENCY STOP: car stopped. Releases in a moment"; }
    else if (S.notice && performance.now() < S.noticeUntil) { tone = S.notice.tone; icon = "i-warn"; text = S.notice.text; }
    else if (S.wanted && !S.connected) { tone = "warning"; icon = "i-warn"; text = "Connection lost. Reconnecting to the backend"; }
    else if (S.connected && !S.ign) { tone = "info"; text = "Connected. Turn the ignition on (I) to start the engine."; }
    else if (S.connected && S.limiter) { tone = "warning"; icon = "i-warn"; text = `Rev limiter at ${LIMIT.toLocaleString("en-IN")} rpm: shift up`; }
    else if (S.connected && kmh < 1) {
      tone = "info";
      text = manual() ? (S.gear === 0 ? "Engine running. Hold the clutch, pick 1st and press the throttle." : "In gear. Press the throttle to move off.")
                      : (S.autoSel === "D" || S.autoSel === "R" ? "Release the brake and press the throttle." : "Select D (or R) to drive.");
    } else if (S.connected) {
      // Kept free of the live speed: the banner is an aria-live region and must not chatter 5 times a second.
      tone = "good"; icon = "i-check";
      const gl = reportedGear() === 14 ? "in reverse" : reportedGear() === 0 ? "in neutral" : "";
      text = `Driving${gl ? " " + gl : ""}. The fleet dashboard sees every packet.`;
    }
    const key = tone + text;
    if (key !== lastBanner) {
      lastBanner = key;
      $("banner").dataset.tone = tone;
      $("banner-text").textContent = text;
      $("banner-icon").innerHTML = `<use href="#${icon}"/>`;
    }
    const fresh = S.connected && Date.now() - S.lastSendAt < 1500;
    const dot = $("fresh").querySelector(".fresh");
    dot.className = "fresh" + (fresh ? "" : S.connected ? " is-stale" : " is-na");
    $("fresh-text").textContent = !S.connected ? "Not sending" : fresh ? `Sending ${S.ign ? "5" : "1"} per second` : "Waiting";
  }

  const shown = {};
  function setHtml(id, html) { if (shown[id] !== html) { shown[id] = html; $(id).innerHTML = html; } }
  function render() {
    const kmh = Math.abs(S.v) * 3.6;
    $("r-speed").textContent = Math.round(kmh);
    const rg = reportedGear();
    $("r-gear").textContent = manual() ? gearLabel(S.gear) : S.autoSel === "D" ? "D" + S.autoGear : S.autoSel;
    $("r-rpm").textContent = Math.round(S.rpm).toLocaleString("en-IN");
    $("rpm-fill").style.width = Math.min(100, (S.rpm / 7000) * 100) + "%";
    document.querySelector(".cluster").classList.toggle("is-limiter", S.limiter);
    $("limiter").hidden = !S.limiter;
    setHtml("r-cool", S.ign ? `${Math.round(S.coolant)}<small>°C</small>` : "--");
    setHtml("r-fuel", S.ign ? `${S.fuel.toFixed(1)}<small>%</small>` : "--");
    setHtml("r-batt", `${S.ign ? "14.1" : "12.4"}<small>V</small>`);
    for (const k of ["throttle", "brake", "clutch"]) {
      const el = $("p-" + k), pct = Math.round(S.ped[k] * 100);
      el.querySelector(".pedal-fill").style.height = pct + "%";
      el.querySelector(".pedal-knob").style.top = `calc(${S.ped[k]} * (100% - 1.6rem))`;
      el.querySelector(".pedal-val").textContent = pct + "%";
      el.setAttribute("aria-valuenow", pct);
    }
    const ign = $("ign");
    ign.setAttribute("aria-pressed", S.ign ? "true" : "false");
    $("ign-text").textContent = S.ign ? "Ignition on" : "Ignition off";
    $("estop").classList.toggle("is-active", S.estop);
    $("drive").classList.toggle("is-off", !S.connected);
    $("w-sent").textContent = S.sent;
    $("w-rate").textContent = (S.sentTimes.filter((t) => Date.now() - t <= 2000).length / 2).toFixed(1);
    banner();
    void rg;
  }

  function renderWire() {
    const box = $("w-bytes");
    const buf = C.fromHex(S.lastHex);
    if (!buf) return;
    if (box.children.length !== 32) box.innerHTML = Array.from({ length: 32 }, () => `<span class="byte"></span>`).join("");
    for (const [s, len, key, label, group] of C.FIELDS_32) {
      const na = C.isSentinel(buf, s, len, key);
      for (let i = s; i < s + len; i++) {
        const n = box.children[i];
        n.textContent = buf[i].toString(16).toUpperCase().padStart(2, "0");
        n.className = "byte" + (na ? " na" : "") + (group === "crc" ? " crc" : "");
        n.style.setProperty("--c", `var(--s${C.GROUPS[group].slot})`);
        n.title = `${label}${na ? ": not available" : ""}`;
      }
    }
    $("w-seq").textContent = S.seq;
  }

  /* ---------------- theme (same toggle and storage key as the fleet dashboard) ---------------- */
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
  });

  /* ---------------- wiring ---------------- */
  $("vid").textContent = VID;
  $("reg").value = fakeReg();
  $("ws-url").value = defaultWs();
  $("car-select").addEventListener("change", (e) => { S.carKey = e.target.value; S.gear = 0; S.autoSel = "P"; renderGearbox(); });
  $("connect").addEventListener("click", connect);
  $("disconnect").addEventListener("click", disconnect);
  $("ign").addEventListener("click", toggleIgnition);
  $("estop").addEventListener("click", emergencyStop);
  $("gearbox").addEventListener("click", (e) => { const b = e.target.closest(".gear"); if (b) selectGear(manual() ? Number(b.dataset.v) : b.dataset.v); });
  const hornBtn = $("horn");
  hornBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); hornBtn.setPointerCapture(e.pointerId); horn(true); });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((ev) => hornBtn.addEventListener(ev, () => horn(false)));
  ["throttle", "brake", "clutch"].forEach(bindPedal);

  const KEYMAP = { KeyW: "throttle", ArrowUp: "throttle", KeyS: "brake", ArrowDown: "brake", Space: "clutch", KeyC: "clutch" };
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, select, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
    const pedal = KEYMAP[e.code];
    if (pedal) { e.preventDefault(); if (!(pedal === "clutch" && !manual())) S.keys[pedal] = true; return; }
    if (e.repeat) return;
    if (e.code === "KeyQ") shift(-1);
    else if (e.code === "KeyE") shift(1);
    else if (e.code === "KeyI") toggleIgnition();
    else if (e.code === "KeyX") emergencyStop();
    else if (e.code === "KeyH") horn(true);
    else return;
    e.preventDefault();
  });
  document.addEventListener("keyup", (e) => {
    const pedal = KEYMAP[e.code];
    if (pedal) S.keys[pedal] = false;
    if (e.code === "KeyH") horn(false);
  });
  window.addEventListener("blur", () => { S.keys = { throttle: false, brake: false, clutch: false }; horn(false); });
  window.addEventListener("pagehide", () => { if (S.ws) S.ws.close(); });

  themeUi();
  renderGearbox();
  let last = performance.now(), sinceSend = 0;
  setInterval(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    step(dt);
    sinceSend += dt;
    if (sinceSend >= (S.ign ? 0.2 : 1.0)) { sinceSend = 0; sendNow(); }
  }, 50);
  (function frame() { render(); requestAnimationFrame(frame); })();
  step(0);
})();
