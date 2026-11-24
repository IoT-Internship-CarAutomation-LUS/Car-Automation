/* standalone.js -- in-browser fallback simulator. Used when no backend answers
 * within 4 s, or with ?mode=standalone. A compact port of
 * demo/simulator/fleet_sim.py: same five cars, same routes and Fronx recording
 * (from js/demo-data.js), same JSON shape. Every message is still built by
 * packing into the 32-byte packet (JS port of pack_packet + CRC-8) and
 * unpacking it again, so packet_hex and the CRC are real. */
(function () {
  "use strict";
  const C = window.FTCodec;
  const DATA = window.DEMO_DATA || { routes: {}, fronx_recorded: { samples: [] } };
  const NULL_TYRES = () => ({ fl: { pressure_kpa: null, temp_c: null }, fr: { pressure_kpa: null, temp_c: null },
    rl: { pressure_kpa: null, temp_c: null }, rr: { pressure_kpa: null, temp_c: null } });

  // deterministic PRNG per car
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const approach = (cur, t, up, down) => (t > cur ? Math.min(t, cur + up) : Math.max(t, cur - down));
  const rad = (d) => (d * Math.PI) / 180;
  function hav(a, b) {
    const R = 6371000, la1 = rad(a[0]), la2 = rad(b[0]), dla = la2 - la1, dlo = rad(b[1] - a[1]);
    const h = Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function bearing(a, b) {
    const la1 = rad(a[0]), la2 = rad(b[0]), dlo = rad(b[1] - a[1]);
    const x = Math.sin(dlo) * Math.cos(la2), y = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dlo);
    return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
  }
  const angDiff = (a, b) => Math.abs(((b - a + 540) % 360) - 180);

  class Route {
    constructor(coords) {
      const pts = [coords[0]];
      for (let i = 1; i < coords.length; i++) if (hav(pts[pts.length - 1], coords[i]) > 0.5) pts.push(coords[i]);
      if (hav(pts[0], pts[pts.length - 1]) > 1) pts.push(pts[0]);
      this.pts = pts; this.cum = [0];
      for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + hav(pts[i - 1], pts[i]));
      this.len = this.cum[this.cum.length - 1];
      this.br = []; for (let i = 0; i + 1 < pts.length; i++) this.br.push(bearing(pts[i], pts[i + 1]));
      this.turn = pts.map((_, i) => angDiff(this.headingAt(this.cum[i] - 30), this.headingAt(this.cum[i] + 30)));
    }
    seg(s) {
      s = ((s % this.len) + this.len) % this.len;
      let lo = 0, hi = this.cum.length - 1;
      while (lo < hi - 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= s) lo = m; else hi = m; }
      return [Math.min(lo, this.br.length - 1), s];
    }
    headingAt(s) { return this.br[this.seg(s)[0]]; }
    position(s) {
      const [i, ss] = this.seg(s), a = this.pts[i], b = this.pts[i + 1];
      const L = this.cum[i + 1] - this.cum[i], f = L > 0 ? (ss - this.cum[i]) / L : 0;
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, this.br[i]];
    }
    maxTurnAhead(s, look) {
      const [i0, s0] = this.seg(s), n = this.pts.length;
      let worst = 0, dist = 0, prev = s0;
      for (let k = 1; k <= n; k++) {
        const idx = (i0 + k) % n, c = this.cum[idx];
        dist += c >= prev ? c - prev : this.len - prev + c; prev = c;
        if (dist > look) break;
        worst = Math.max(worst, this.turn[idx]);
      }
      return worst;
    }
  }

  const SPECS = {
    fronx: { name: "Maruti Suzuki Fronx", year: 2024, reg: "TN 11 AZ 4817", pt: "petrol", cruise: [38, 58], acc: 1.6, dec: 2.6, stopEvery: [70, 140], stopLen: [8, 20], ratios: [140, 80, 53, 37, 27], idle: [688, 850], rpmMax: 3126, up: 2800, disp: 1.2 },
    corolla: { name: "Toyota Corolla", year: 2020, reg: "TN 14 BK 2209", pt: "petrol", cruise: [45, 72], acc: 1.8, dec: 2.8, stopEvery: [80, 160], stopLen: [10, 25], ratios: [140, 80, 53, 37, 27, 20], idle: [700, 760], rpmMax: 5200, up: 2600, disp: 1.8 },
    veyron: { name: "Bugatti Veyron 16.4", year: 2011, reg: "TN 09 BV 1001", pt: "petrol", cruise: [170, 300], acc: 4.5, dec: 6.0, stopEvery: null, ratios: [62, 43, 32, 25, 20, 17, 14.7], idle: [850, 950], rpmMax: 6400, up: 4300, disp: 8.0 },
    omni: { name: "Maruti Omni", year: 2005, reg: "TN 07 AC 1986", pt: "petrol", cruise: [22, 42], acc: 1.0, dec: 2.2, stopEvery: [45, 90], stopLen: [10, 30], ratios: [140, 80, 53, 37], idle: [820, 900], rpmMax: 4500, up: 2800, disp: 0.8 },
    roadster: { name: "Tesla Roadster", year: 2008, reg: "TN 10 EV 2008", pt: "ev", cruise: [40, 68], acc: 2.6, dec: 2.6, stopEvery: [80, 150], stopLen: [10, 22], motor: 69.6, rpmMax: 14000 },
  };
  const TYRES = { corolla: { fl: 230, fr: 230, rl: 225, rr: 225 }, veyron: { fl: 255, fr: 255, rl: 275, rr: 275 }, roadster: { fl: 207, fr: 207, rl: 241, rr: 241 } };

  class Car {
    constructor(id) {
      this.id = id; this.sp = SPECS[id];
      this.r = rng([...id].reduce((a, c) => a + c.charCodeAt(0), 0) * 7919);
      this.u = (a, b) => a + (b - a) * this.r();
      const rt = DATA.routes[id];
      this.route = rt ? new Route(rt.coords) : null;
      this.s = this.route ? this.u(0, this.route.len) : 0;
      this.v = this.u(0.3, 0.7) * this.sp.cruise[1] / 3.6;
      this.cruise = this.u(...this.sp.cruise); this.cruiseUntil = 0;
      this.stopUntil = 0; this.nextStop = Date.now() / 1000 + (this.sp.stopEvery ? this.u(...this.sp.stopEvery) : 1e12);
      this.gear = 1; this.prevGear = 1; this.seq = Math.floor(this.r() * 256); this.t = 0;
      this.heading = this.route ? this.route.headingAt(this.s) : 0;
      this.coolant = id === "omni" ? 97 : 88.5; this.intake = 38;
      this.tyreT = { fl: id === "veyron" ? 52 : 31, fr: id === "veyron" ? 52 : 31, rl: id === "veyron" ? 52 : 31, rr: id === "veyron" ? 52 : 31 };
      this.cabinT = 26.5; this.cabinH = 58; this.rssi = id === "omni" ? -99 : -74; this.soc = 78;
      this.scen = {}; this.offlineUntil = 0; this.nextDrop = Date.now() / 1000 + this.u(30, 80);
      this.rec = id === "fronx" && DATA.fronx_recorded && DATA.fronx_recorded.samples.length ? DATA.fronx_recorded.samples : null;
      this.ri = 0;
    }
    drive(now) {
      const sp = this.sp;
      if (now > this.cruiseUntil) { this.cruise = this.u(...sp.cruise); this.cruiseUntil = now + this.u(25, 60); }
      let target = this.cruise;
      if (sp.stopEvery && now >= this.nextStop && this.stopUntil < now) { this.stopUntil = now + this.u(...sp.stopLen); this.nextStop = this.stopUntil + this.u(...sp.stopEvery); }
      if (now < this.stopUntil) target = 0;
      const v = this.v, look = (v * v) / (2 * sp.dec) + 25, turn = this.route.maxTurnAhead(this.s, look);
      if (turn > 8) { let corner = Math.max(14, target * Math.max(0.15, 1 - turn / 100)); if (this.id === "veyron") corner = Math.max(60, corner); target = Math.min(target, corner); }
      let nv = approach(v, target / 3.6, sp.acc * (0.8 + 0.4 * this.r()), sp.dec);
      nv = Math.max(0, nv + (nv > 1 ? this.u(-0.15, 0.15) : 0));
      const accel = nv - v;
      this.s = (this.s + (v + nv) / 2) % this.route.len; this.v = nv;
      const [lat, lng, h] = this.route.position(this.s);
      const d = ((h - this.heading + 540) % 360) - 180;
      this.heading = (this.heading + d * (nv > 0.5 ? 0.85 : 0) + 360) % 360;
      return [lat, lng, accel];
    }
    step(now) {
      this.t++;
      const sp = this.sp, id = this.id;
      if (this.rec) return this.stepRecorded(now);
      const [lat, lng, accel] = this.drive(now);
      const spd = this.v * 3.6;
      let pedal = spd > 1 ? clamp(0.12 + accel * 0.28 + Math.pow(spd / 300, 1.5) * 0.9, 0, 1) : 0;
      if (accel < -0.3) pedal = 0;
      const braking = accel < -0.7 || (spd < 1 && now < this.stopUntil);
      let d, can = { brake: null, clutch: null, ac: null }, gear = null, battery;
      if (sp.pt === "ev") {
        const kwh = 0.135 + 0.0000105 * spd * spd;
        this.soc -= ((kwh * this.v) / 1000 + 0.0004) / 53 * 100;
        if (this.soc < 18) this.soc = 80;
        d = { rpm: spd * sp.motor, speed: spd, throttle: Math.round(pedal * 1000) / 10, ambient: 30 + 2 * Math.sin(this.t / 300), mil: [false, 0] };
        can = { brake: braking, clutch: null, ac: true };
        battery = 13.5 + 0.1 * Math.sin(this.t / 40);
      } else {
        let g = Math.max(1, Math.min(this.gear, sp.ratios.length)), rpm;
        if (spd < 2) { g = 0; rpm = this.u(...sp.idle); }
        else {
          while (g < sp.ratios.length && spd * sp.ratios[g - 1] > sp.up) g++;
          while (g > 1 && spd * sp.ratios[g - 1] < sp.idle[1] + 350) g--;
          rpm = Math.max(spd * sp.ratios[g - 1], sp.idle[0] + 150);
        }
        rpm = Math.min(rpm, sp.rpmMax);
        const shifting = g !== this.prevGear && g > 0 && this.prevGear > 0;
        this.prevGear = g; this.gear = Math.max(g, 1); gear = g;
        const load = clamp(18 + pedal * 70 + this.u(-2, 2), 10, 100);
        const maf = Math.max(1.4, (rpm / 60) * (sp.disp / 2) * 1.18 * (load / 100) * (id === "veyron" ? 1.4 : 1));
        const map = id === "veyron" ? clamp(30 + load * 1.6, 20, 250) : clamp(26 + load * 0.72, 20, 101);
        let hot = 88.5 + 1.5 * Math.sin(this.t / 180);
        if (id === "omni") hot = 98.5 + 3.5 * Math.sin(this.t / 150);
        if (id === "veyron") hot = 92 + 3 * Math.min(1, spd / 300);
        if (this.scen.overheat) { hot = 116; this.coolant = approach(this.coolant, hot, 0.7, 0.2); }
        else this.coolant = approach(this.coolant, hot, 0.15, 0.35);
        this.intake = approach(this.intake, 34 + load * 0.25 - spd * 0.05, 0.2, 0.2);
        battery = { fronx: 13.8, corolla: 14.2, veyron: 13.9, omni: null }[id];
        if (battery != null && id !== "fronx") battery += 0.1 * Math.sin(this.t / 37);
        d = { rpm, speed: spd, coolant: this.coolant, load, throttle: 14 + pedal * 72, maf, intake: this.intake,
          ambient: 30 + 2 * Math.sin(this.t / 300), map, mil: this.scen.mil ? [true, 2] : [false, 0] };
        if (id === "corolla") { d.fuel = 62 - (this.t / 3600) * 4; can = { brake: braking, clutch: shifting || (spd < 1 && now < this.stopUntil), ac: true }; }
        else if (id === "veyron") { d.fuel = 71 - (this.t / 3600) * 30; can = { brake: braking, clutch: null, ac: true }; }
        else if (id === "fronx") { d.ambient = null; gear = null; }
        else if (id === "omni") { d = { rpm, speed: spd, coolant: this.coolant }; gear = null; }
      }
      return this.emit(now, d, spd, lat, lng, gear, battery, can, braking);
    }
    stepRecorded(now) {
      const r = this.rec[this.ri]; this.ri = (this.ri + 1) % this.rec.length;
      const d = { rpm: r.rpm, speed: r.speed_kmh, coolant: r.coolant_c, load: r.engine_load_pct, throttle: r.throttle_pct,
        maf: r.maf_gps, intake: r.intake_temp_c, ambient: r.ambient_temp_c, map: r.map_kpa,
        mil: r.mil_on == null ? null : [r.mil_on, r.dtc_count || 0] };
      this.heading = 38; this.v = 0;
      return this.emit(now, d, r.speed_kmh || 0, 12.92494, 80.11993, null, r.battery_v, { brake: null, clutch: null, ac: null }, false, 7);
    }
    emit(now, d, spd, lat, lng, gear, battery, can, braking, sats) {
      const sp = this.sp, id = this.id;
      this.seq = (this.seq + 1) & 0xff;
      if (sats == null) sats = id === "fronx" ? [6, 7, 7][Math.floor(this.r() * 3)] : 7 + Math.floor(this.r() * 4);
      const gps = { lat, lng, sats, fix: lat != null };
      const pkt = C.packPacket(d, gps, { battery_v: battery, gear, seq: this.seq, can,
        health: { power_ok: true, gps_ok: gps.fix, can_ok: Object.values(can).some((x) => x != null) } }, Math.floor(now));
      const u = C.unpackPacket(pkt);
      let tyres = NULL_TYRES(), tpmsHex = null, tpmsCrc = null;
      const cold = TYRES[id];
      if (cold) {
        const raw = {};
        for (const p of ["fl", "fr", "rl", "rr"]) {
          let base = 31 + spd * (id === "veyron" ? 0.13 : 0.09) + (p[0] === "r" ? 2 : 0) + (braking ? 1.5 : 0);
          this.tyreT[p] = approach(this.tyreT[p], base, 0.06, 0.04);
          let pr = cold[p] * (this.tyreT[p] + 273.15) / 303.15;
          if (p === "fl" && this.scen.puncture) { this.scen.pk = Math.max(128, (this.scen.pk || pr) - 3.2); pr = this.scen.pk; }
          raw[p] = { pressure_kpa: pr + this.u(-0.4, 0.4), temp_c: this.tyreT[p] };
        }
        const tp = C.packTpms(raw, this.seq), tu = C.unpackTpms(tp);
        tyres = tu.tyres; tpmsHex = C.toHex(tp); tpmsCrc = tu.crc_valid;
      }
      const vehicle = Object.assign({}, u.vehicle);
      let kmpl = null;
      if (sp.pt === "petrol" && vehicle.maf_gps && vehicle.speed_kmh && vehicle.speed_kmh >= 3) {
        const lph = (vehicle.maf_gps * 3600) / (14.7 * 745); kmpl = Math.round((vehicle.speed_kmh / lph) * 10) / 10;
      }
      vehicle.fuel_mileage_kmpl = kmpl;
      // Mirror the backend: it estimates a gear for petrol cars that send none (never for EVs).
      if (sp.pt !== "ev" && !vehicle.gear && vehicle.speed_kmh != null && vehicle.rpm != null && vehicle.speed_kmh >= 3) vehicle.gear = estimateGear(vehicle.rpm, vehicle.speed_kmh);
      const board = ["corolla", "veyron", "roadster"].includes(id);
      if (board) { this.cabinT = approach(this.cabinT, (can.ac ? 24.5 : 31) + this.u(-0.3, 0.3), 0.05, 0.05); this.cabinH = clamp(this.cabinH + this.u(-0.4, 0.4), 48, 66); }
      this.rssi = id === "omni" ? clamp(this.rssi + this.u(-2.5, 2.5), -109, -93) : clamp(this.rssi + this.u(-1.5, 1.5), -86, -63);
      return {
        type: "telemetry", schema_version: u.schema_version, ts: Math.round(now * 1000),
        source: { vehicle_id: id, name: sp.name, model_year: sp.year, reg_no: sp.reg, powertrain: sp.pt, data_mode: this.rec ? "recorded" : "simulated", control: "auto" },
        driver: { ignition: null, throttle_pedal_pct: null, brake_pedal_pct: null, clutch_pedal_pct: null, transmission: null, estop: null },
        vehicle, tyres, gps: Object.assign({}, u.gps, { heading_deg: Math.round(this.heading * 10) / 10 }), device: u.device,
        cabin: { temp_c: board ? Math.round(this.cabinT * 10) / 10 : null, humidity_pct: board ? Math.round(this.cabinH) : null },
        gsm: { rssi_dbm: board || id === "omni" ? Math.round(this.rssi) : null },
        ev: sp.pt === "ev" ? { soc_pct: Math.round(this.soc * 10) / 10, range_km: Math.round(this.soc * 3.93) } : { soc_pct: null, range_km: null },
        packet_hex: C.toHex(pkt), tpms_hex: tpmsHex, crc_valid: u.crc_valid, tpms_crc_valid: tpmsCrc,
        provenance: this.provenance(),
      };
    }
    provenance() {
      const id = this.id, rec = !!this.rec;
      const p = { vehicle: rec ? "measured" : "simulated", tyres: TYRES[id] ? "simulated" : "not_supported", gps: "simulated",
        cabin: ["corolla", "veyron", "roadster"].includes(id) ? "simulated" : "not_supported",
        gsm: ["corolla", "veyron", "roadster", "omni"].includes(id) ? "simulated" : "not_supported",
        ev: this.sp.pt === "ev" ? "simulated" : "not_applicable", driver: "not_applicable", fields: { "vehicle.fuel_mileage_kmpl": "derived" } };
      const f = p.fields, set = (keys, v) => keys.forEach((k) => (f["vehicle." + k] = v));
      if (id === "fronx") { set(["fuel_level_pct", "brake", "clutch", "ac_on"], "not_supported"); f["vehicle.gear"] = "derived";
        if (rec) f["vehicle.coolant_c"] = "no_data"; else f["vehicle.ambient_temp_c"] = "not_supported"; }
      else if (id === "omni") { set(["throttle_pct", "engine_load_pct", "fuel_level_pct", "maf_gps", "intake_temp_c", "ambient_temp_c", "map_kpa", "battery_v", "mil_on", "dtc_count", "brake", "clutch", "ac_on", "fuel_mileage_kmpl"], "not_supported"); f["vehicle.gear"] = "derived"; }
      else if (id === "veyron") f["vehicle.clutch"] = "not_supported";
      else if (id === "roadster") set(["coolant_c", "maf_gps", "map_kpa", "intake_temp_c", "fuel_level_pct", "engine_load_pct", "gear", "clutch", "fuel_mileage_kmpl"], "not_applicable");
      return p;
    }
  }

  // Same bands as backend/config.py GEAR_RATIO_THRESHOLDS / obd_decoder.calculate_gear
  const BANDS = [[1, 115, 180], [2, 65, 114.9], [3, 45, 64.9], [4, 32, 44.9], [5, 24, 31.9], [6, 15, 23.9]];
  function estimateGear(rpm, spd) {
    if (spd < 3 || rpm < 400) return 0;
    if (rpm < 1000 && spd > 15) return 0;
    const r = rpm / spd;
    for (const [g, lo, hi] of BANDS) if (r >= lo && r <= hi) return g;
    if (r > 180) return 0;
    if (r < 15) return 6;
    let best = 0, diff = Infinity;
    for (const [g, lo, hi] of BANDS) { const dd = Math.abs(r - (lo + hi) / 2); if (dd < diff) { diff = dd; best = g; } }
    return best;
  }

  let cars = [], timer = null;
  window.FT = window.FT || {};
  window.FT.Standalone = {
    start(ingest) {
      cars = Object.keys(SPECS).filter((id) => DATA.routes[id] || id === "fronx").map((id) => new Car(id));
      const tick = () => {
        const now = Date.now() / 1000;
        cars.forEach((car, i) => setTimeout(() => {
          const m = car.step(now + i * 0.2);
          let drop = false;
          if (car.id === "omni" && now >= car.nextDrop) { drop = true; car.nextDrop = now + car.u(35, 90); }
          if (now < car.offlineUntil) drop = true;
          if (!drop) ingest(m);
        }, i * 200));
      };
      tick();
      timer = setInterval(tick, 1000);
    },
    control(msg) {
      const by = Object.fromEntries(cars.map((c) => [c.id, c]));
      const sc = msg.scenario;
      if (sc === "omni_overheat" && by.omni) by.omni.scen.overheat = true;
      else if (sc === "corolla_puncture" && by.corolla) by.corolla.scen.puncture = true;
      else if (sc === "mil_on" && by.corolla) by.corolla.scen.mil = true;
      else if (sc === "car_offline") { const c = by[msg.target] || by.veyron; if (c) c.offlineUntil = Date.now() / 1000 + (msg.duration_s || 15); }
      else if (sc === "reset_all") cars.forEach((c) => { c.scen = {}; c.offlineUntil = 0; if (c.id === "omni") c.coolant = 99; });
    },
    stop() { clearInterval(timer); },
  };
})();
