/* codec.js -- browser port of backend/obd_decoder.py (32-byte packet) and
 * backend/tpms_codec.py (16-byte TPMS packet), schema v2.1.0.
 *
 * The live dashboard never takes values from these bytes: values come from the
 * JSON the backend relays. The decoder is used to (a) re-check every packet's
 * CRC-8 in the browser and (b) name each byte in the packet strip. The packer
 * is used only by the standalone (no-backend) simulator.
 */
(function () {
  "use strict";
  const U8_NA = 0xff, U16_NA = 0xffff, I32_NA = 0x7fffffff;
  const SCHEMA_VERSION = "2.1.0";

  function crc8(bytes, end) {
    let crc = 0;
    const n = end == null ? bytes.length : end;
    for (let i = 0; i < n; i++) {
      crc ^= bytes[i];
      for (let b = 0; b < 8; b++) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
    return crc;
  }

  const round = (v) => Math.round(v);
  const u8 = (v, lo = 0, hi = 254) => (v == null ? U8_NA : Math.min(Math.max(round(v), lo), hi));
  const pct = (v) => (v == null ? U8_NA : Math.min(Math.max(round(v * 2), 0), 200));
  const temp = (v) => (v == null ? U8_NA : Math.min(Math.max(round(v) + 40, 0), 254));
  const u16 = (v, s = 1) => (v == null ? U16_NA : Math.min(Math.max(round(v * s), 0), 65534));
  const coord = (v) => (v == null ? I32_NA : round(v * 1e6));

  /** decoded: {rpm, speed, coolant, load, throttle, fuel, maf, intake, ambient, map, mil:[on,count]|null}
   *  gps: {lat,lng,sats,fix}; extras: {battery_v, gear, seq, can:{brake,clutch,ac}, health:{...}} */
  function packPacket(d, gps, extras, tsSec) {
    gps = gps || {}; extras = extras || {};
    const buf = new Uint8Array(32);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, (tsSec == null ? Math.floor(Date.now() / 1000) : tsSec) >>> 0);
    dv.setUint16(4, u16(d.rpm, 4));
    buf[6] = u8(d.speed);
    dv.setInt32(7, coord(gps.lat));
    dv.setInt32(11, coord(gps.lng));
    buf[15] = (Math.min(gps.sats || 0, 63) & 0x3f) | (gps.fix ? 0x40 : 0);
    dv.setUint16(16, u16(d.maf, 100));
    buf[18] = u8(extras.gear, 0, 254);
    buf[19] = pct(d.throttle);
    buf[20] = temp(d.coolant);
    buf[21] = pct(d.fuel);
    buf[22] = u8(extras.battery_v == null ? null : extras.battery_v * 10);
    buf[23] = d.mil == null ? U8_NA : (d.mil[0] ? 0x80 : 0) | (Math.min(d.mil[1], 127) & 0x7f);
    const can = extras.can || {};
    let flags = 0;
    [[0, 1, "brake"], [2, 3, "clutch"], [4, 5, "ac"]].forEach(([s, v, k]) => {
      if (can[k] != null) { flags |= 1 << v; if (can[k]) flags |= 1 << s; }
    });
    buf[24] = flags;
    buf[25] = pct(d.load);
    buf[26] = temp(d.intake);
    buf[27] = temp(d.ambient);
    buf[28] = u8(d.map);
    const h = extras.health || {};
    buf[29] = (h.power_ok ? 0x80 : 0) | (h.gps_ok ? 0x40 : 0) | (h.can_ok ? 0x20 : 0);
    buf[30] = (extras.seq || 0) & 0xff;
    buf[31] = crc8(buf, 31);
    return buf;
  }

  const rU8 = (r) => (r === U8_NA ? null : r);
  const rPct = (r) => (r === U8_NA ? null : Math.round((r / 2) * 10) / 10);
  const rTemp = (r) => (r === U8_NA ? null : r - 40);
  const rU16 = (r, s) => (r === U16_NA ? null : Math.round((r / s) * 100) / 100);
  const rCoord = (r) => (r === I32_NA ? null : r / 1e6);

  function unpackPacket(buf) {
    if (buf.length !== 32) throw new Error("Expected 32 bytes, got " + buf.length);
    const dv = new DataView(buf.buffer, buf.byteOffset, 32);
    const flags = buf[24];
    const flag = (s, v) => (flags & (1 << v) ? !!(flags & (1 << s)) : null);
    const md = buf[23];
    return {
      schema_version: SCHEMA_VERSION,
      ts: dv.getUint32(0) * 1000,
      vehicle: {
        rpm: rU16(dv.getUint16(4), 4),
        speed_kmh: rU8(buf[6]),
        gear: buf[18] === U8_NA ? null : buf[18],
        throttle_pct: rPct(buf[19]),
        coolant_c: rTemp(buf[20]),
        fuel_level_pct: rPct(buf[21]),
        maf_gps: rU16(dv.getUint16(16), 100),
        engine_load_pct: rPct(buf[25]),
        intake_temp_c: rTemp(buf[26]),
        ambient_temp_c: rTemp(buf[27]),
        map_kpa: rU8(buf[28]),
        battery_v: buf[22] === U8_NA ? null : Math.round(buf[22]) / 10,
        mil_on: md === U8_NA ? null : !!(md & 0x80),
        dtc_count: md === U8_NA ? null : md & 0x7f,
        brake: flag(0, 1),
        clutch: flag(2, 3),
        ac_on: flag(4, 5),
      },
      gps: { lat: rCoord(dv.getInt32(7)), lng: rCoord(dv.getInt32(11)), sats: buf[15] & 0x3f, fix: !!(buf[15] & 0x40) },
      device: { power_ok: !!(buf[29] & 0x80), gps_ok: !!(buf[29] & 0x40), can_ok: !!(buf[29] & 0x20), seq: buf[30] },
      crc_valid: crc8(buf, 31) === buf[31],
    };
  }

  const TPMS_POS = ["fl", "fr", "rl", "rr"];
  function packTpms(tyres, seq) {
    const buf = new Uint8Array(16);
    const dv = new DataView(buf.buffer);
    buf[0] = 0x54; buf[1] = 0x01; buf[2] = (seq || 0) & 0xff;
    TPMS_POS.forEach((p, i) => {
      const t = (tyres && tyres[p]) || {};
      dv.setUint16(3 + i * 3, t.pressure_kpa == null ? U16_NA : Math.min(Math.max(round(t.pressure_kpa * 10), 0), 65534));
      buf[5 + i * 3] = temp(t.temp_c);
    });
    buf[15] = crc8(buf, 15);
    return buf;
  }
  function unpackTpms(buf) {
    if (buf.length !== 16) throw new Error("Expected 16 bytes");
    const dv = new DataView(buf.buffer, buf.byteOffset, 16);
    const tyres = {};
    TPMS_POS.forEach((p, i) => {
      const pr = dv.getUint16(3 + i * 3), tr = buf[5 + i * 3];
      tyres[p] = { pressure_kpa: pr === U16_NA ? null : Math.round(pr) / 10, temp_c: tr === U8_NA ? null : tr - 40 };
    });
    return { tyres, seq: buf[2], crc_valid: crc8(buf, 15) === buf[15] };
  }

  const toHex = (buf) => Array.from(buf, (b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
  function fromHex(hex) {
    if (!hex) return null;
    const parts = hex.trim().split(/\s+/);
    const out = new Uint8Array(parts.length);
    for (let i = 0; i < parts.length; i++) out[i] = parseInt(parts[i], 16) & 0xff;
    return out;
  }

  /* Byte map for the packet strip. group -> CSS series slot. */
  const GROUPS = {
    frame:  { label: "Frame / time", slot: 7 },
    engine: { label: "Engine", slot: 1 },
    motion: { label: "Speed & gear", slot: 2 },
    gps:    { label: "GPS", slot: 3 },
    temps:  { label: "Temperatures", slot: 4 },
    elec:   { label: "Fuel, battery, MIL", slot: 5 },
    body:   { label: "CAN body & device", slot: 6 },
    crc:    { label: "CRC-8", slot: 0 },
    tyreP:  { label: "Tyre pressure", slot: 1 },
    tyreT:  { label: "Tyre temperature", slot: 4 },
  };

  // [start, len, key, label, group, encoding, decode(json)->text, naCheck(bytes)->bool]
  const FIELDS_32 = [
    [0, 4, "ts", "Timestamp", "frame", "uint32 Unix seconds"],
    [4, 2, "rpm", "RPM", "engine", "uint16, value × 4"],
    [6, 1, "speed", "Speed", "motion", "uint8 km/h (max 254)"],
    [7, 4, "lat", "Latitude", "gps", "int32, deg × 1e6"],
    [11, 4, "lng", "Longitude", "gps", "int32, deg × 1e6"],
    [15, 1, "satsfix", "Sats + fix", "gps", "bits 0–5 sats, bit 6 fix"],
    [16, 2, "maf", "MAF", "engine", "uint16, g/s × 100"],
    [18, 1, "gear", "Gear", "motion", "uint8, 0 = neutral"],
    [19, 1, "throttle", "Throttle", "engine", "uint8, % × 2"],
    [20, 1, "coolant", "Coolant", "temps", "uint8, °C + 40"],
    [21, 1, "fuel", "Fuel level", "elec", "uint8, % × 2"],
    [22, 1, "battery", "Battery", "elec", "uint8, V × 10"],
    [23, 1, "mil", "MIL + DTC", "elec", "bit 7 MIL, bits 0–6 count"],
    [24, 1, "can", "Brake / clutch / AC", "body", "state + validity bits"],
    [25, 1, "load", "Engine load", "engine", "uint8, % × 2"],
    [26, 1, "intake", "Intake air", "temps", "uint8, °C + 40"],
    [27, 1, "ambient", "Ambient", "temps", "uint8, °C + 40"],
    [28, 1, "map", "MAP", "engine", "uint8 kPa"],
    [29, 1, "health", "Device health", "body", "bit 7 power, 6 GPS, 5 CAN"],
    [30, 1, "seq", "Sequence", "body", "uint8, N mod 256"],
    [31, 1, "crc", "CRC-8", "crc", "CRC-8-CCITT over bytes 0–30"],
  ];
  const FIELDS_16 = [
    [0, 1, "type", "Packet type", "frame", "0x54 = TPMS"],
    [1, 1, "ver", "Layout version", "frame", "0x01"],
    [2, 1, "seq", "Sequence", "frame", "uint8, N mod 256"],
    [3, 2, "fl_p", "Front-left pressure", "tyreP", "uint16, kPa × 10"],
    [5, 1, "fl_t", "Front-left temp", "tyreT", "uint8, °C + 40"],
    [6, 2, "fr_p", "Front-right pressure", "tyreP", "uint16, kPa × 10"],
    [8, 1, "fr_t", "Front-right temp", "tyreT", "uint8, °C + 40"],
    [9, 2, "rl_p", "Rear-left pressure", "tyreP", "uint16, kPa × 10"],
    [11, 1, "rl_t", "Rear-left temp", "tyreT", "uint8, °C + 40"],
    [12, 2, "rr_p", "Rear-right pressure", "tyreP", "uint16, kPa × 10"],
    [14, 1, "rr_t", "Rear-right temp", "tyreT", "uint8, °C + 40"],
    [15, 1, "crc", "CRC-8", "crc", "CRC-8-CCITT over bytes 0–14"],
  ];

  /** Is this field's raw value the "unavailable" sentinel? */
  function isSentinel(buf, start, len, key) {
    if (key === "crc" || key === "ts" || key === "satsfix" || key === "can" || key === "health" ||
        key === "seq" || key === "type" || key === "ver") return false;
    if (len === 1) return buf[start] === U8_NA;
    if (len === 2) return buf[start] === 0xff && buf[start + 1] === 0xff;
    if (len === 4) return buf[start] === 0x7f && buf[start + 1] === 0xff && buf[start + 2] === 0xff && buf[start + 3] === 0xff;
    return false;
  }

  window.FTCodec = {
    SCHEMA_VERSION, crc8, packPacket, unpackPacket, packTpms, unpackTpms, toHex, fromHex,
    GROUPS, FIELDS_32, FIELDS_16, isSentinel, U8_NA, U16_NA, I32_NA,
  };
})();
