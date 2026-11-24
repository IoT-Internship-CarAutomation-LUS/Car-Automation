/* flow-model.js -- the data at every stage of the OBD-II pipeline, for one traced value.
 *
 * Pure functions (no DOM), so the round-trip test can run them in Node too.
 *
 * Our fleet cars send PACKETS, not ELM327 text, so stages 1-4 are RECONSTRUCTED from each
 * real packet: the value in the packet is turned back into the ELM reply that would have
 * produced it (e.g. rpm 843.5 -> raw 3374 -> A=0x0D, B=0x2E -> "41 0C 0D 2E"), and
 * decoding that reply with decodePid (a port of obd_decoder.decode_pid) must reproduce the
 * packet exactly. Stages 5-8 use the actual packet.
 */
(function (root) {
  "use strict";
  const C = root.FTCodec;
  const hex2 = (n) => n.toString(16).toUpperCase().padStart(2, "0");

  /* ---- port of backend/obd_decoder.py decode_pid (same formulas, same None cases) ---- */
  const round1 = (x) => Math.round(x * 10) / 10;            // Python round(x, 1); no exact ties occur for A*100/255
  const DECODERS = {
    0x0C: (d) => (d[0] * 256 + d[1]) / 4.0,
    0x0D: (d) => d[0],
    0x05: (d) => d[0] - 40,
    0x04: (d) => round1((d[0] * 100) / 255),
    0x11: (d) => round1((d[0] * 100) / 255),
    0x2F: (d) => round1((d[0] * 100) / 255),
    0x10: (d) => (d[0] * 256 + d[1]) / 100.0,
    0x0F: (d) => d[0] - 40,
    0x46: (d) => d[0] - 40,
    0x0B: (d) => d[0],
    0x01: (d) => [!!(d[0] & 0x80), d[0] & 0x7f],
  };
  function decodePid(hexStr) {
    if (!hexStr || !hexStr.trim()) return null;
    const tokens = hexStr.trim().toUpperCase().split(/\s+/);
    if (tokens[0] === "7F") return null;
    if (tokens.length < 2 || tokens[0] !== "41") return null;
    const pid = parseInt(tokens[1], 16);
    const data = tokens.slice(2).map((b) => parseInt(b, 16));
    if (Number.isNaN(pid) || data.some((x) => Number.isNaN(x))) return null;
    const dec = DECODERS[pid];
    if (!dec) return null;
    // Python raises IndexError on a short reply and returns None: same here.
    if (data.length < (pid === 0x0C || pid === 0x10 ? 2 : 1)) return null;
    return dec(data);
  }

  /* ---- the five traceable PIDs ---- */
  const PIDS = {
    "0x0C": { pid: 0x0C, leaf: "rpm", name: "Engine speed", unit: "rpm", bytes: [4, 5], dataLen: 2,
      sensor: "the crankshaft position sensor", ecuWord: "engine speed",
      formula: "((A × 256) + B) / 4", packExpr: "_u16(value, 4)", packEnc: "uint16, value × 4" },
    "0x0D": { pid: 0x0D, leaf: "speed_kmh", name: "Vehicle speed", unit: "km/h", bytes: [6], dataLen: 1,
      sensor: "the wheel-speed (ABS) sensors", ecuWord: "vehicle speed",
      formula: "A", packExpr: "_u8(value)", packEnc: "uint8 km/h" },
    "0x05": { pid: 0x05, leaf: "coolant_c", name: "Coolant temperature", unit: "°C", bytes: [20], dataLen: 1,
      sensor: "the coolant temperature sensor (a thermistor in the engine block)", ecuWord: "coolant temperature",
      formula: "A − 40", packExpr: "_temp(value)", packEnc: "uint8, °C + 40" },
    "0x11": { pid: 0x11, leaf: "throttle_pct", name: "Throttle position", unit: "%", bytes: [19], dataLen: 1,
      sensor: "the throttle position sensor", ecuWord: "throttle position",
      formula: "A × 100 / 255", packExpr: "_pct(value)", packEnc: "uint8, % × 2" },
    "0x2F": { pid: 0x2F, leaf: "fuel_level_pct", name: "Fuel level", unit: "%", bytes: [21], dataLen: 1,
      sensor: "the fuel level sender in the tank", ecuWord: "fuel level",
      formula: "A × 100 / 255", packExpr: "_pct(value)", packEnc: "uint8, % × 2" },
  };

  /* packers used by pack_packet for these PIDs, as in obd_decoder.py */
  const PACK = {
    "0x0C": (v) => { const r = Math.min(Math.max(Math.round(v * 4), 0), 65534); return [r >> 8, r & 0xff]; },
    "0x0D": (v) => [Math.min(Math.max(Math.round(v), 0), 254)],
    "0x05": (v) => [Math.min(Math.max(Math.round(v) + 40, 0), 254)],
    "0x11": (v) => [Math.min(Math.max(Math.round(v * 2), 0), 200)],
    "0x2F": (v) => [Math.min(Math.max(Math.round(v * 2), 0), 200)],
  };

  /**
   * Rebuild the ELM327 reply for a value taken from a real packet.
   * Percent PIDs: the car speaks in 1/255 steps but our packet stores 0.5 % steps, so we pick
   * the A whose decoded value packs to exactly the packet's byte (closest to the packet value).
   */
  function reconstruct(pidKey, value, packetBytes) {
    const P = PIDS[pidKey];
    if (value == null) return null;
    let data;
    if (pidKey === "0x0C") { const raw = Math.round(value * 4); data = [raw >> 8, raw & 0xff]; }
    else if (pidKey === "0x0D") data = [Math.round(value)];
    else if (pidKey === "0x05") data = [Math.round(value) + 40];
    else {
      const want = packetBytes ? packetBytes[P.bytes[0]] : Math.round(value * 2);
      let best = null;
      for (let A = 0; A <= 255; A++) {
        const dv = DECODERS[P.pid]([A]);
        if (PACK[pidKey](dv)[0] !== want) continue;
        if (best == null || Math.abs(dv - value) < Math.abs(DECODERS[P.pid]([best]) - value)) best = A;
      }
      data = [best];
    }
    const reply = ["41", hex2(P.pid)].concat(data.map(hex2)).join(" ");
    return { data, reply };
  }

  /** Round trip: decode the rebuilt reply, pack it like pack_packet, compare with the packet bytes. */
  function roundTrip(pidKey, msg) {
    const P = PIDS[pidKey];
    const bytes = C.fromHex(msg.packet_hex);
    const value = msg.vehicle[P.leaf];
    if (value == null) {
      const sentinel = P.bytes.every((i) => bytes[i] === 0xff);
      return { ok: sentinel && decodePid("NO DATA") === null, value: null, decoded: null, sentinel };
    }
    const r = reconstruct(pidKey, value, bytes);
    const decoded = decodePid(r.reply);
    const packed = PACK[pidKey](decoded);
    const same = packed.every((b, i) => b === bytes[P.bytes[i]]);
    // exact value for rpm / speed / coolant; same packet byte (so the same unpacked value) for percents
    const exact = pidKey === "0x11" || pidKey === "0x2F" ? same : decoded === value && same;
    return { ok: exact, value, decoded, reply: r.reply, packed };
  }

  /* ---- GPS side branch: NMEA <-> decimal degrees <-> int32 ---- */
  function nmeaChecksum(body) { let c = 0; for (const ch of body) c ^= ch.charCodeAt(0); return hex2(c); }
  function toNmea(deg, isLat) {
    const a = Math.abs(deg), d = Math.floor(a), min = (a - d) * 60;
    const dd = String(d).padStart(isLat ? 2 : 3, "0");
    const mm = min.toFixed(5).padStart(8, "0");
    return [dd + mm, isLat ? (deg < 0 ? "S" : "N") : (deg < 0 ? "W" : "E")];
  }
  /** port of sensing/gps_neo6m_pi.py parse_nmea_lat_lng */
  function parseNmeaLatLng(coord, dir) {
    if (!coord || !dir || coord.length < 4) return null;
    let degLen = dir === "N" || dir === "S" ? 2 : dir === "E" || dir === "W" ? 3 : null;
    if (degLen == null) return null;
    if (coord.split(".")[0].length <= degLen) degLen = coord.split(".")[0].length - 2;
    const v = parseFloat(coord.slice(0, degLen)) + parseFloat(coord.slice(degLen)) / 60;
    return Math.round((dir === "S" || dir === "W" ? -v : v) * 1e6) / 1e6;
  }
  function ggaSentence(gps, tsMs) {
    const t = new Date(tsMs || Date.now());
    const hhmmss = [t.getUTCHours(), t.getUTCMinutes(), t.getUTCSeconds()].map((n) => String(n).padStart(2, "0")).join("") + ".00";
    const [la, ns] = toNmea(gps.lat, true), [lo, ew] = toNmea(gps.lng, false);
    const body = `GPGGA,${hhmmss},${la},${ns},${lo},${ew},${gps.fix ? 1 : 0},${String(gps.sats || 0).padStart(2, "0")},1.10,,M,,M,,`;
    return { sentence: `$${body}*${nmeaChecksum(body)}`, lat: [la, ns], lng: [lo, ew] };
  }

  /* ---- the report example: one real capture cycle from report Figure 5.13 (18 July, Fronx) ---- */
  const REPORT_CYCLE = {
    replies: { 0x0C: "41 0C 0D 2E", 0x0D: "41 0D 00", 0x05: "41 05 80", 0x04: "41 04 6D", 0x11: "41 11 28",
      0x2F: "7F 01 2F", 0x10: "41 10 01 07", 0x0F: "41 0F 66", 0x46: "7F 01 46", 0x0B: "41 0B 33", 0x01: "41 01 00 07 E1 00" },
    battery_v: 13.8, gps: { lat: 12.805346, lng: 79.938221, sats: 6, fix: true },
    tsSec: Math.floor(Date.UTC(2026, 6, 18, 11, 7, 0) / 1000),     // 18 Jul 2026 16:37 IST (minute illustrative)
  };
  function reportMessage() {
    const R = REPORT_CYCLE;
    const dec = {};
    for (const [pid, rep] of Object.entries(R.replies)) dec[pid] = decodePid(rep);
    const d = { rpm: dec[0x0C], speed: dec[0x0D], coolant: dec[0x05], load: dec[0x04], throttle: dec[0x11], fuel: dec[0x2F],
      maf: dec[0x10], intake: dec[0x0F], ambient: dec[0x46], map: dec[0x0B], mil: dec[0x01] };
    const pkt = C.packPacket(d, R.gps, { battery_v: R.battery_v, gear: null, seq: 1,
      can: { brake: null, clutch: null, ac: null }, health: { power_ok: true, gps_ok: true, can_ok: false } }, R.tsSec);
    const u = C.unpackPacket(pkt);
    return {
      type: "telemetry", schema_version: C.SCHEMA_VERSION, ts: R.tsSec * 1000,
      source: { vehicle_id: "report", name: "Maruti Suzuki Fronx (report, 18 July)", model_year: 2024, reg_no: null,
        powertrain: "petrol", data_mode: "recorded", control: "auto" },
      vehicle: Object.assign({}, u.vehicle, { fuel_mileage_kmpl: null }),
      tyres: { fl: { pressure_kpa: null, temp_c: null }, fr: { pressure_kpa: null, temp_c: null }, rl: { pressure_kpa: null, temp_c: null }, rr: { pressure_kpa: null, temp_c: null } },
      gps: Object.assign({}, u.gps, { heading_deg: null }), device: u.device,
      cabin: { temp_c: null, humidity_pct: null }, gsm: { rssi_dbm: null }, ev: { soc_pct: null, range_km: null },
      driver: { ignition: null, throttle_pedal_pct: null, brake_pedal_pct: null, clutch_pedal_pct: null, transmission: null, estop: null },
      packet_hex: C.toHex(pkt), tpms_hex: null, crc_valid: u.crc_valid, tpms_crc_valid: null,
      provenance: { vehicle: "measured", tyres: "not_supported", gps: "measured", cabin: "not_supported", gsm: "not_supported",
        ev: "not_applicable", driver: "not_applicable",
        fields: { "vehicle.fuel_level_pct": "not_supported", "vehicle.ambient_temp_c": "not_supported", "vehicle.gear": "derived",
          "vehicle.brake": "not_supported", "vehicle.clutch": "not_supported", "vehicle.ac_on": "not_supported" } },
      _report: { replies: R.replies },
    };
  }

  /* ---- what the ELM327 says when a PID has no answer ---- */
  function unsupportedReply(pidKey, msg) {
    // query_pid() turns NO DATA (or any reply without "41 ") into "7F 01 <pid>", which decode_pid maps to None.
    return { elm: "NO DATA", normalized: `7F 01 ${hex2(PIDS[pidKey].pid)}` };
  }

  root.FlowModel = { PIDS, PACK, DECODERS, decodePid, reconstruct, roundTrip, ggaSentence, parseNmeaLatLng, toNmea,
    nmeaChecksum, reportMessage, REPORT_CYCLE, unsupportedReply, hex2 };
})(typeof window !== "undefined" ? window : globalThis);
