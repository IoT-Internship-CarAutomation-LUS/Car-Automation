/* app.js -- state, WebSocket link, ingest, client-side alert engine. */
(function () {
  "use strict";
  const FT = (window.FT = window.FT || {});
  const C = window.FTCodec;

  const STALE_MS = 3000, OFFLINE_MS = 10000, EVENT_TTL_MS = 20000, REPEAT_COOLDOWN_MS = 60000;

  const S = (FT.state = {
    mode: "connecting",          // connecting | live | reconnecting | standalone
    cars: {},                    // id -> car record
    rx: [],                      // receive times, for packets/s
    crc: { ok: 0, total: 0 },
    active: new Map(),           // key -> {car, rule, sev, msg, since, expires?, posted}
    lastPosted: new Map(),       // key -> time a raise was last posted to the feed
    feed: [],                    // newest first
    listeners: [],
  });

  FT.on = (fn) => S.listeners.push(fn);
  const emit = (what, data) => S.listeners.forEach((fn) => { try { fn(what, data); } catch (e) { console.error(e); } });

  function carRecord(id) {
    if (!S.cars[id]) {
      S.cars[id] = { id, msg: null, lastRx: null, firstRx: null, hist: [], trail: [], longTrail: [],
        lastSeq: null, gaps: 0, lost: 0, rxTimes: [], crcOk: 0, crcTotal: 0, lastMoveAt: 0, crc32: null, crc16: null };
    }
    return S.cars[id];
  }
  FT.carList = function () {
    const ids = Object.keys(S.cars);
    return ids.sort((a, b) => {
      const ia = FT.ORDER.indexOf(a), ib = FT.ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    }).map((id) => S.cars[id]);
  };

  /* ---------------- ingest ---------------- */
  FT.ingest = function (msg) {
    if (!msg || msg.type !== "telemetry" || !msg.source || !msg.source.vehicle_id) return;
    const now = Date.now();
    const id = String(msg.source.vehicle_id);
    const car = carRecord(id);
    const isNew = !car.msg;
    car.msg = msg;
    car.lastRx = now;
    car.firstRx = car.firstRx || now;
    S.rx.push(now);
    car.rxTimes.push(now);
    while (S.rx.length && now - S.rx[0] > 5000) S.rx.shift();
    while (car.rxTimes.length && now - car.rxTimes[0] > 10000) car.rxTimes.shift();

    // Re-check the CRC-8 of the packet in the browser (and trust the backend's flag too).
    let crcOk = msg.crc_valid !== false;
    const b32 = C.fromHex(msg.packet_hex);
    if (b32 && b32.length === 32) { car.crc32 = C.crc8(b32, 31) === b32[31]; crcOk = crcOk && car.crc32; }
    const b16 = C.fromHex(msg.tpms_hex);
    car.crc16 = null;
    if (b16 && b16.length === 16) { car.crc16 = C.crc8(b16, 15) === b16[15]; crcOk = crcOk && car.crc16 && msg.tpms_crc_valid !== false; }
    S.crc.total++; car.crcTotal++;
    if (crcOk) { S.crc.ok++; car.crcOk++; } else { raiseEvent(id, "crc", "critical", "CRC-8 check failed: the packet was corrupted on the way"); }

    // Sequence gaps = packets that never arrived.
    const seq = msg.device && msg.device.seq;
    if (seq != null && car.lastSeq != null) {
      const gap = (seq - car.lastSeq - 1 + 256) % 256;
      if (gap > 0 && gap < 250) {
        car.gaps++; car.lost += gap;
        raiseEvent(id, "seqgap", "warning",
          `${gap} packet${gap > 1 ? "s" : ""} missing (seq ${car.lastSeq} then ${seq})`);
      }
    }
    if (seq != null) car.lastSeq = seq;

    const v = msg.vehicle || {};
    const t = now / 1000;
    car.hist.push({ t, rpm: v.rpm, speed: v.speed_kmh });
    while (car.hist.length && t - car.hist[0].t > 125) car.hist.shift();
    if ((v.speed_kmh || 0) >= 3) car.lastMoveAt = now;
    const g = msg.gps || {};
    if (g.fix && g.lat != null && g.lng != null) {
      const last = car.longTrail[car.longTrail.length - 1];
      if (!last || last[0] !== g.lat || last[1] !== g.lng) {
        car.longTrail.push([g.lat, g.lng]);
        if (car.longTrail.length > 180) car.longTrail.shift();
      }
    }

    // Data came back: staleness clears.
    clearAlert(id, "stale");
    clearAlert(id, "offline");
    evaluate(id, msg);
    emit(isNew ? "newcar" : "telemetry", car);
  };

  /* ---------------- alerts ---------------- */
  function post(entry) {
    S.feed.unshift(entry);
    if (S.feed.length > 80) S.feed.pop();
    emit("feed", entry);
  }
  function keyOf(car, rule) { return car + ":" + rule; }

  function raise(car, rule, sev, text, short) {
    const key = keyOf(car, rule);
    const now = Date.now();
    const cur = S.active.get(key);
    if (cur) { cur.msg = text; cur.sev = sev; return; }          // ongoing: update, never repeat
    const recently = S.lastPosted.get(key);
    const posted = !(recently && now - recently < REPEAT_COOLDOWN_MS);
    S.active.set(key, { car, rule, sev, msg: text, short, since: now, posted });
    if (posted) {
      S.lastPosted.set(key, now);
      post({ id: key + ":" + now, t: now, car, sev, msg: text, kind: "raised" });
    }
    emit("alerts");
  }
  function raiseEvent(car, rule, sev, text) {
    const key = keyOf(car, rule) + ":" + Date.now();
    const short = rule === "crc" ? "CRC" : "Loss";
    S.active.set(key, { car, rule, sev, msg: text, short, since: Date.now(), expires: Date.now() + EVENT_TTL_MS, posted: true });
    post({ id: key, t: Date.now(), car, sev, msg: text, kind: "event" });
    emit("alerts");
  }
  function clearAlert(car, rule, text) {
    const key = keyOf(car, rule);
    const cur = S.active.get(key);
    if (!cur) return;
    S.active.delete(key);
    if (cur.posted) post({ id: key + ":c" + Date.now(), t: Date.now(), car, sev: "cleared", msg: text || clearedText(rule), kind: "cleared" });
    emit("alerts");
  }
  function clearedText(rule) {
    if (rule.startsWith("tp-")) return `${FT.POS_NAME[rule.slice(3)]} tyre pressure back above 185 kPa`;
    if (rule.startsWith("tt-")) return `${FT.POS_NAME[rule.slice(3)]} tyre cooled below 88 °C`;
    return ({ coolant: "Coolant back below 103 °C", speed: "Speed back under 115 km/h", battery: "Battery back above 12.2 V",
      mil: "Check-engine lamp off, no fault codes", stale: "Packets arriving again", offline: "Back online, packets arriving" })[rule] || "Back to normal";
  }
  FT.postInfo = (car, text) => post({ id: "info:" + Date.now(), t: Date.now(), car, sev: "info", msg: text, kind: "info" });

  /** hysteresis rule: on when test(), off when clear() */
  function rule(car, name, on, off, sev, text, short) {
    const key = keyOf(car, name);
    if (S.active.has(key)) { if (off) clearAlert(car, name); else S.active.get(key).msg = text; }
    else if (on) raise(car, name, sev, text, short);
  }

  function evaluate(id, msg) {
    const v = msg.vehicle || {};
    const ty = msg.tyres || {};
    if (v.coolant_c != null || S.active.has(keyOf(id, "coolant"))) {
      const c = v.coolant_c;
      rule(id, "coolant", c > 105, c == null || c < 103, "critical", `Coolant ${c} °C, above the 105 °C limit`, "Coolant");
    }
    for (const p of ["fl", "fr", "rl", "rr"]) {
      const t = ty[p] || {};
      const pr = t.pressure_kpa, tt = t.temp_c;
      rule(id, "tp-" + p, pr != null && pr < 180, pr == null || pr > 185, "critical",
        `${FT.POS_NAME[p]} tyre ${pr != null ? pr.toFixed(0) : "--"} kPa, below 180 kPa`, "Tyre " + p.toUpperCase());
      rule(id, "tt-" + p, tt != null && tt > 90, tt == null || tt < 88, "serious",
        `${FT.POS_NAME[p]} tyre ${tt} °C, above 90 °C`, "Tyre heat");
    }
    const s = v.speed_kmh;
    rule(id, "speed", s != null && s > 120, s == null || s < 115, "warning",
      s >= 254 ? `Speed at the OBD limit (254 km/h shown, real speed may be higher)` : `Speed ${s} km/h, above 120 km/h`, "Speed");
    const b = v.battery_v;
    rule(id, "battery", b != null && b < 12.0, b == null || b > 12.2, "warning", `Battery ${b} V, below 12.0 V`, "Battery");
    const milOn = v.mil_on === true || (v.dtc_count != null && v.dtc_count > 0);
    rule(id, "mil", milOn, !milOn, "serious",
      `Check-engine lamp ${v.mil_on ? "on" : "off"}, ${v.dtc_count || 0} fault code${v.dtc_count === 1 ? "" : "s"} stored`, "MIL");
  }

  function sweep() {
    const now = Date.now();
    for (const car of Object.values(S.cars)) {
      const age = car.lastRx == null ? null : now - car.lastRx;
      if (age == null) continue;
      if (age > OFFLINE_MS) {
        if (S.active.has(keyOf(car.id, "stale"))) S.active.delete(keyOf(car.id, "stale"));
        raise(car.id, "offline", "critical", `Offline: no packet for ${Math.round(age / 1000)} s`, "Offline");
        const a = S.active.get(keyOf(car.id, "offline")); if (a) a.msg = `Offline: no packet for ${Math.round(age / 1000)} s`;
      } else if (age > STALE_MS) {
        raise(car.id, "stale", "warning", `Data stale: no packet for ${Math.round(age / 1000)} s`, "Stale");
        const a = S.active.get(keyOf(car.id, "stale")); if (a) a.msg = `Data stale: no packet for ${Math.round(age / 1000)} s`;
      }
    }
    for (const [k, a] of S.active) if (a.expires && a.expires < now) S.active.delete(k);
    emit("tick");
  }
  setInterval(sweep, 500);

  FT.alertsFor = (id) => [...S.active.values()].filter((a) => a.car === id)
    .sort((a, b) => sevRank(b.sev) - sevRank(a.sev));
  const sevRank = (s) => ({ critical: 3, serious: 2, warning: 1 }[s] || 0);
  FT.activeCount = () => S.active.size;

  FT.statusOf = function (car) {
    if (!car || !car.msg) return "waiting";
    const age = Date.now() - car.lastRx;
    if (age > OFFLINE_MS) return "offline";
    if (age > STALE_MS) return "stale";
    const v = car.msg.vehicle || {};
    if ((v.speed_kmh || 0) >= 3) return "moving";
    const ev = car.msg.source.powertrain === "ev";
    if (ev) return Date.now() - car.lastMoveAt < 90000 ? "idle" : "parked";
    return (v.rpm || 0) > 0 ? "idle" : "parked";
  };
  FT.STATUS_WORD = { moving: "Moving", idle: "Idle", parked: "Parked", stale: "Stale", offline: "Offline", waiting: "Waiting" };

  /* ---------------- link ---------------- */
  let ws = null, opened = false, backoff = 1000;
  function wsUrl() {
    const q = new URLSearchParams(location.search).get("ws");
    if (q) return q;
    if (location.protocol === "http:" || location.protocol === "https:")
      return (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";
    return "ws://localhost:8000/ws";
  }
  function setMode(m) { S.mode = m; emit("mode", m); }

  FT.connect = function () {
    const forced = new URLSearchParams(location.search).get("mode") === "standalone";
    if (forced) return FT.startStandalone("requested in the URL");
    let timer = setTimeout(() => {
      if (!opened) { try { ws && ws.close(); } catch (e) { /* ignore */ } FT.startStandalone("no backend answered within 4 s"); }
    }, 4000);
    open();
    function open() {
      try { ws = new WebSocket(wsUrl()); } catch (e) { return; }
      ws.onopen = () => { opened = true; clearTimeout(timer); backoff = 1000; setMode("live"); };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m && m.type === "telemetry") FT.ingest(m);
      };
      ws.onclose = () => {
        if (S.mode === "standalone") return;
        if (opened) { setMode("reconnecting"); setTimeout(open, backoff); backoff = Math.min(backoff * 2, 8000); }
      };
      ws.onerror = () => { /* onclose follows */ };
    }
  };

  FT.startStandalone = function (why) {
    if (S.mode === "standalone") return;
    setMode("standalone");
    FT.standaloneReason = why;
    FT.Standalone.start(FT.ingest);
  };

  FT.sendControl = function (scenario, target) {
    const msg = { type: "demo_control", schema_version: C.SCHEMA_VERSION, ts: Date.now(),
      id: Math.random().toString(36).slice(2, 10), scenario, target: target || null,
      duration_s: scenario === "car_offline" ? 15 : null };
    if (S.mode === "standalone") { FT.Standalone.control(msg); return true; }
    if (ws && ws.readyState === 1) { ws.send(JSON.stringify(msg)); return true; }
    return false;
  };

  FT.pps = () => S.rx.filter((t) => Date.now() - t <= 5000).length / 5;
})();
