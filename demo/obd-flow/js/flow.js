/* flow.js -- "How data flows": one value from the car's ECU to the dashboard tile.
 * Reuses the fleet dashboard's codec, state and WebSocket link (../fleet/js/app.js), so the
 * packets traced here are the same live packets the fleet dashboard shows.
 */
(function () {
  "use strict";
  const FT = window.FT, C = window.FTCodec, M = window.FlowModel;
  const SNIP = window.FLOW_SNIPPETS || {}, FIGS = window.FLOW_FIGURES || {};
  const $ = (id) => document.getElementById(id);
  const esc = FT.esc;
  const hex2 = M.hex2;

  const STAGES = [
    { id: "ecu", n: 1, name: "Car ECU", sub: "inside the car", hw: true },
    { id: "port", n: 2, name: "OBD-II port", sub: "CAN bus, SAE J1962", hw: true },
    { id: "elm", n: 3, name: "ELM327", sub: "Bluetooth, AT commands", hw: true },
    { id: "decode", n: 4, name: "Pi decodes", sub: "decode_pid()" },
    { id: "pack", n: 5, name: "Pack 32 bytes", sub: "pack_packet(), CRC-8" },
    { id: "unpack", n: 6, name: "Unpack to JSON", sub: "unpack_packet()" },
    { id: "backend", n: 7, name: "Backend", sub: "WebSocket, SQLite" },
    { id: "dash", n: 8, name: "Dashboard", sub: "the tile you see" },
  ];
  const GPS = { id: "gps", n: "GPS", name: "GPS side branch", sub: "NEO-6M, joins at stage 5" };
  const ORDER = ["ecu", "port", "elm", "decode", "gps", "pack", "unpack", "backend", "dash"];
  const stageById = (id) => (id === "gps" ? GPS : STAGES.find((s) => s.id === id));

  const CODE = {
    ecu: [], port: [], elm: ["at_init", "initialise_elm327", "query_pid"],
    decode: ["decode_pid", "@d"], gps: ["parse_gga", "parse_nmea_lat_lng", "coord"],
    pack: ["pack_packet", "crc8"], unpack: ["unpack_packet"],
    backend: ["websocket_endpoint", "save_telemetry", "fan_out"], dash: ["ft_connect", "ft_ingest", "set_tile"],
  };
  const EVIDENCE = {
    ecu: [["fig5-11-capture-in-fronx", "The real Fronx with our capture running: the ECU's engine speed (RPM) scrolling on the laptop."]],
    port: [["fig4-1-obd-pins", "The five pins we use: 6 and 14 carry CAN, 16 is +12 V, 4 and 5 are ground."],
           ["fig4-3-request-reply", "The exact request and reply for engine speed: CAN 7DF 02 01 0C, answer 7E8 04 41 0C 0D 2E."]],
    elm: [["fig5-13-elm327-init", "Real Pi log, 18 July: ATZ, ATE0, ATL0, ATSP0, ATH0 all OK, then 010C -> 41 0C 0D 2E. Fuel 012F came back 7F 01 2F."],
          ["fig5-12-parts", "The in-car unit: Raspberry Pi 4, ESP32 boards, GPS and CAN modules."]],
    decode: [["fig6-2-raw-decoded-packed", "Raw replies, the decoded values and the packed packet, one cycle after another."]],
    gps: [["fig5-4-board2-gps", "Board 2 with the NEO-6M GPS (and CAN and GSM modules)."]],
    pack: [["fig6-2-raw-decoded-packed", "Each [PACKET] line is the 32 bytes pack_packet() built from the [RAW] replies above it."]],
    unpack: [["fig6-4-laptop-receiver", "The laptop receiver unpacking every packet: RPM, coolant, fuel=None and crc_valid=True."]],
    backend: [["fig6-3-pi-forwarding", "The Pi forwarding every packet off the car over the network (the TCP bench link; the WebSocket path does the same job)."]],
    dash: [["fig6-5-dashboard-real-rpm", "Dashboard 1 showing a real engine speed (2,289.5 rpm) on 14 July."]],
  };

  /* ---------------- state ---------------- */
  const st = {
    stage: "decode", pid: "0x0C", carId: "fronx", mode: "live",   // live | paused | report
    frozen: null, summary: false, playing: null, lastRender: 0,
  };
  (function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get("car")) st.carId = h.get("car");
    if (h.get("pid") && M.PIDS[h.get("pid")]) st.pid = h.get("pid");
    if (h.get("stage") && ORDER.includes(h.get("stage"))) st.stage = h.get("stage");
    if (h.get("view") === "summary") st.summary = true;
    if (h.get("mode") === "report") st.mode = "report";
  })();
  function writeHash() {
    const h = new URLSearchParams({ car: st.carId || "", pid: st.pid, stage: st.stage });
    if (st.summary) h.set("view", "summary");
    if (st.mode === "report") h.set("mode", "report");
    history.replaceState(null, "", "#" + h.toString());
  }

  let reportMsg = null;
  function currentMsg() {
    if (st.mode === "report") return (reportMsg = reportMsg || M.reportMessage());
    if (st.mode === "paused" && st.frozen) return st.frozen;
    const car = FT.state.cars[st.carId];
    return car && car.msg ? car.msg : null;
  }

  /* ---------------- per-stage context ---------------- */
  function ctxOf(msg) {
    const P = M.PIDS[st.pid];
    const bytes = C.fromHex(msg.packet_hex);
    const value = msg.vehicle[P.leaf];
    const state = FT.prov(msg, "vehicle", P.leaf);
    const report = st.mode === "report";
    let reply = null, rec = null;
    if (report) {
      reply = msg._report.replies[P.pid];
      rec = value != null ? { reply, data: reply.split(" ").slice(2).map((x) => parseInt(x, 16)) } : null;
    } else if (value != null) {
      rec = M.reconstruct(st.pid, value, bytes);
      reply = rec.reply;
    }
    const supported = value != null;
    const ev = msg.source.powertrain === "ev";
    const liveCar = FT.isLiveCar(msg);
    let reason = "";
    if (!supported) {
      if (state === "not_applicable") reason = `An electric car has no ${P.ecuWord} to report, so this PID is not applicable (EV).`;
      else if (state === "not_supported") reason = `This car's ECU does not offer ${P.ecuWord} over OBD-II (PID ${P.pid === 0x2F ? "0x2F" : "0x" + hex2(P.pid)}).`;
      else if (liveCar && msg.driver && msg.driver.ignition === false) reason = "The ignition is off, so the ECU is asleep and answers nothing.";
      else if (msg.source.vehicle_id === "fronx" && msg.source.data_mode === "recorded") reason = `The 31 July session logged no ${P.ecuWord} replies, so this packet has no reading.`;
      else reason = "No reading in this sample.";
    }
    return { msg, P, bytes, value, state, report, reply, rec, supported, ev, reason, liveCar,
      pidHex: "0x" + hex2(P.pid), name: msg.source.name };
  }
  const fmtVal = (c, v = c.value) => (v == null ? "None" : (Number.isInteger(v) ? String(v) : String(v))) + (v == null ? "" : " " + c.P.unit);
  const nullWord = (c) => (c.state === "not_applicable" ? "Not applicable (EV)" : c.state === "not_supported" ? "Not supported" : "No reading");

  /* ---------------- "what happens" ---------------- */
  function what(stage, c) {
    const P = c.P;
    const T = {
      ecu: c.supported
        ? [`Inside the car, ${P.sensor} measures ${P.ecuWord}. The ECU (the engine computer) keeps it as a number.`,
           "Nothing of ours runs here. We only ask the ECU for that number, through the standard OBD-II socket."]
        : [c.reason, "So there is nothing to ask for, and the rest of the pipeline has to carry an honest gap, not a zero."],
      port: [`The ELM327 adapter plugs into the OBD-II socket (SAE J1962). It reaches the ECU on the CAN bus (pins 6 and 14), takes +12 V from pin 16 and ground from pins 4 and 5.`,
        c.supported ? `To ask for ${P.ecuWord} it sends a CAN frame to the broadcast ID 7DF; the engine ECU answers from 7E8 (ISO 15765-4).`
                    : `The request goes out on 7DF as usual, but no data comes back (or a negative response does), so the ELM327 will say NO DATA.`],
      elm: ["The Raspberry Pi talks to the ELM327 over Bluetooth as a serial port, /dev/rfcomm0 at 38400 baud.",
        "At start-up our code sends ATZ (reset), ATE0 (echo off), ATL0 (linefeeds off), ATSP0 (find the protocol) and ATH0 (hide CAN headers).",
        c.supported ? `Then for each value it writes "01 ${hex2(P.pid)}\\r" (mode 01, PID ${hex2(P.pid)}) and reads text up to the > prompt.`
                    : `It writes "01 ${hex2(P.pid)}\\r"; the reply is NO DATA, which query_pid() turns into "7F 01 ${hex2(P.pid)}".`],
      decode: c.supported
        ? [`decode_pid() splits the reply into bytes. 41 means "an answer to mode 01", ${hex2(P.pid)} says which PID, and the rest are the data bytes.`,
           `The PID's formula from SAE J1979, ${P.formula}, turns the bytes into a number.`]
        : ["decode_pid() sees a reply that starts with 7F (a negative answer) and returns None.", "None is how the Pi says unavailable. It is never turned into 0."],
      gps: ["A NEO-6M GPS on the Pi's serial port sends NMEA text sentences once a second.",
        "The parser reads $GPGGA: latitude as degrees and minutes (DDMM.MMMMM), longitude as DDDMM.MMMMM, and parse_nmea_lat_lng() turns them into decimal degrees.",
        "pack_packet() then stores each as a whole number of millionths of a degree (int32), in bytes 7 to 14 of the same packet."],
      pack: ["pack_packet() puts every value of one moment into a fixed 32-byte layout: time, RPM, speed, GPS, temperatures and more, always at the same byte positions.",
        c.supported ? `${P.name} goes into byte${P.bytes.length > 1 ? "s " + P.bytes[0] + " to " + P.bytes[1] : " " + P.bytes[0]} as ${P.packEnc}.`
                    : `A missing value becomes a sentinel (0xFF), never 0, so byte ${P.bytes[0]} is FF.`,
        "The last byte is a CRC-8 (polynomial 0x07) over bytes 0 to 30, so the receiver can tell if any bit changed."],
      unpack: ["At the boundary, unpack_packet() reads the 32 bytes back with the same layout and recomputes the CRC-8.",
        c.supported ? `Byte${P.bytes.length > 1 ? "s" : ""} ${P.bytes.join(" and ")} become "${P.leaf}": ${c.value} in the JSON message.`
                    : `The sentinel FF becomes "${P.leaf}": null. JSON can say "unknown"; a byte can only use a reserved value.`],
      backend: ["The FastAPI backend has one WebSocket endpoint, /ws. It parses each message and routes it by its type.",
        "A telemetry message is stored in SQLite as one row (id, ts, payload) and fanned out to every other connected client: the fleet dashboard, this page, a second laptop."],
      dash: ["The dashboard's WebSocket handler parses the JSON and hands it to FT.ingest(), which re-checks the CRC, keeps the latest message per car and raises alerts.",
        c.supported ? "The car view draws the tile with setTile(): the value, its unit and a provenance tag (measured, simulated, derived)."
                    : `setTile() never draws a null as 0: the tile reads "${nullWord(c)}".`],
    };
    const F = {
      ecu: "The ECU already knows the value. OBD-II is only a standard way to ask for it.",
      port: "Honest note: the ELM327 handles this layer. Our code never sees these CAN frames, only the ELM327's text.",
      elm: c.supported ? `From here on everything is plain text, "${c.reply}", not CAN frames.` : "From here on everything is plain text, not CAN frames. \"NO DATA\" is text too.",
      decode: c.supported && st.pid === "0x0C" ? "Engine speed is sent in quarter-RPM steps, which is why it ends in .0, .25, .5 or .75."
        : "Each PID has its own formula; decode_pid() looks it up by the PID byte.",
      gps: "This branch joins the main path at stage 5: position and engine data travel in the same 32 bytes.",
      pack: `32 bytes for the whole moment. This message's JSON is ${JSON.stringify(c.msg).length.toLocaleString("en-IN")} bytes.`,
      unpack: "The CRC is checked again here, and again in the browser: crc_valid is true.",
      backend: "The backend stores and forwards the value unchanged. It only adds a gear estimate for petrol cars that send none.",
      dash: "The number on screen is the number the ECU gave, after one formula and one lossless packing step.",
    };
    return `${T[stage].map((t) => `<p>${esc(t)}</p>`).join("")}<p class="fact"><strong>Key fact.</strong> ${esc(F[stage])}</p>`;
  }

  /* ---------------- "the data here" ---------------- */
  const io = (inLabel, inVal, op, outLabel, outVal, extra = "") =>
    `<div class="io"><div class="io-box"><span class="io-label">${inLabel}</span><span class="io-val num">${inVal}</span></div>
      <div class="io-op"><span class="io-arrow" aria-hidden="true"></span><span class="io-op-text">${op}</span></div>
      <div class="io-box io-out"><span class="io-label">${outLabel}</span><span class="io-val num">${outVal}</span></div></div>${extra}`;
  const hot = (s) => `<mark class="hot">${s}</mark>`;
  const dataHex = (c) => (c.rec ? c.rec.data.map(hex2) : []);

  function canFrame(id, bytes, hotFrom) {
    const cells = bytes.map((b, i) => `<span class="cf ${i >= hotFrom ? "cf-hot" : ""}">${b}</span>`).join("");
    const pad = Array.from({ length: 8 - bytes.length }, () => `<span class="cf cf-pad" title="padding">··</span>`).join("");
    return `<div class="canf"><span class="canf-id num">${id}</span><span class="canf-bytes num">${cells}${pad}</span></div>`;
  }

  function byteGrid(c, opts = {}) {
    const b = c.bytes;
    const hotSet = new Set(opts.hot || c.P.bytes);
    const owner = [];
    C.FIELDS_32.forEach((f, fi) => { for (let i = f[0]; i < f[0] + f[1]; i++) owner[i] = fi; });
    let cells = "";
    for (let i = 0; i < 32; i++) {
      const f = C.FIELDS_32[owner[i]];
      const na = C.isSentinel(b, f[0], f[1], f[2]);
      cells += `<span class="byte${na ? " na" : ""}${f[4] === "crc" ? " crc" : ""}${hotSet.has(i) ? " traced" : ""}" style="--c:var(--s${C.GROUPS[f[4]].slot})" title="Byte ${i}: ${esc(f[3])}${na ? " (not available)" : ""}">${hex2(b[i])}</span>`;
    }
    const labels = C.FIELDS_32.map(([s, len, key, label, group]) =>
      `<span style="grid-column:${s + 1} / span ${len};--c:var(--s${C.GROUPS[group].slot})" title="${esc(label)}">${esc({ ts: "Time", rpm: "RPM", speed: "Spd", lat: "Latitude", lng: "Longitude", satsfix: "Sat", maf: "MAF", gear: "Gr", throttle: "Thr", coolant: "Cool", fuel: "Fuel", battery: "Batt", mil: "MIL", can: "CAN", load: "Load", intake: "IAT", ambient: "Amb", map: "MAP", health: "Hlth", seq: "Seq", crc: "CRC" }[key] || label)}</span>`).join("");
    return `<div class="grid-wrap"><div class="bytes b32">${cells}</div><div class="byte-labels b32">${labels}</div></div>`;
  }

  function data(stage, c) {
    const P = c.P, dh = dataHex(c);
    const pidB = hex2(P.pid);
    switch (stage) {
      case "ecu":
        return c.supported
          ? io("Sensor", esc(P.sensor.replace(/^the /, "")), "the ECU measures and keeps it", "ECU value", hot(esc(fmtVal(c))))
          : io("Sensor", esc(P.sensor.replace(/^the /, "")), "nothing is offered over OBD-II", "ECU value", `<span class="nil">${esc(nullWord(c))}</span>`);
      case "port": {
        const req = canFrame("7DF", ["02", "01", pidB], 99);
        const rep = c.supported ? canFrame("7E8", [hex2(2 + dh.length), "41", pidB].concat(dh), 3)
          : `<div class="canf"><span class="canf-id num">7E8</span><span class="canf-none">no data (or 7F negative response)</span></div>`;
        return `<div class="frames"><div><span class="io-label">Request, ISO 15765-4</span>${req}<span class="canf-note">length 02, mode 01, PID ${pidB}</span></div>
          <div><span class="io-label">Reply</span>${rep}<span class="canf-note">${c.supported ? `length, 41 = mode 01 answer, PID ${pidB}, data ${dh.join(" ")}` : "the ELM327 will print NO DATA"}</span></div></div>
          <p class="honest">The ELM327 builds and reads these frames. Our code never sees them: it only sees the text in the next stage.</p>`;
      }
      case "elm": {
        const init = ["ATZ", "ATE0", "ATL0", "ATSP0", "ATH0"].map((a) => `<div class="term-line"><span class="tx">&gt; ${a}\\r</span><span class="rx">${a === "ATZ" ? "ELM327 v1.5" : "OK"}</span></div>`).join("");
        const reply = c.supported ? hot(esc(c.reply)) : "NO DATA";
        return `<div class="term"><div class="term-title">Once, at start-up</div>${init}
          <div class="term-title">Every second, for PID ${pidB}</div>
          <div class="term-line big"><span class="tx">&gt; 01 ${pidB}\\r</span><span class="rx">${reply}\\r\\r&gt;</span></div></div>
          ${c.supported ? "" : `<p class="honest">query_pid() finds no "41 " in the reply and returns <span class="num">"7F 01 ${pidB}"</span>, exactly as in report Figure 5.13 for fuel.</p>`}`;
      }
      case "decode": {
        if (!c.supported) return io("Reply string", `"7F 01 ${pidB}"`, "decode_pid(): tokens[0] == \"7F\"", "Value", hot("None"));
        const d = c.rec.data;
        let arith;
        if (st.pid === "0x0C") arith = `((0x${hex2(d[0])} × 256) + 0x${hex2(d[1])}) / 4<br>= (${d[0] * 256} + ${d[1]}) / 4<br>= ${hot(esc(String(M.decodePid(c.reply))))} rpm`;
        else if (st.pid === "0x0D") arith = `0x${hex2(d[0])} = ${hot(String(d[0]))} km/h`;
        else if (st.pid === "0x05") arith = `0x${hex2(d[0])} − 40 = ${d[0]} − 40 = ${hot(String(d[0] - 40))} °C`;
        else arith = `0x${hex2(d[0])} × 100 / 255 = ${d[0]} × 100 / 255 = ${hot(String(M.decodePid(c.reply)))} %`;
        const note = (st.pid === "0x11" || st.pid === "0x2F") && !c.report
          ? `<p class="honest">The car speaks in 1/255 steps and our packet stores 0.5 % steps. The rebuilt byte A is the one whose decoded value packs to exactly this packet's byte (${c.value} % after unpacking).</p>` : "";
        return io("Reply string", `"${esc(c.reply)}"`, `decode_pid(): split, look up PID ${pidB}, apply ${esc(P.formula)}`, "Value", `<span class="arith">${arith}</span>`) + note;
      }
      case "gps": {
        const g = c.msg.gps;
        if (g.lat == null) return `<p class="nil">No GPS fix in this packet: latitude and longitude are the 0x7FFFFFFF sentinel and unpack to null.</p>`;
        const s = M.ggaSentence(g, c.msg.ts);
        const latI = Math.round(g.lat * 1e6), lngI = Math.round(g.lng * 1e6);
        const b = c.bytes;
        const bh = (i0) => Array.from({ length: 4 }, (_, k) => hex2(b[i0 + k])).join(" ");
        return `<div class="nmea num">${esc(s.sentence.replace(s.lat[0], "\u0001").replace(s.lng[0], "\u0002")).replace("\u0001", hot(s.lat[0])).replace("\u0002", hot(s.lng[0]))}</div>` +
          io("Latitude", `${s.lat[0]},${s.lat[1]}`, "degrees + minutes / 60", "Decimal", `${g.lat.toFixed(6)}°`) +
          io("Decimal", `${g.lat.toFixed(6)}`, "_coord(): × 1,000,000 as int32", "Bytes 7 to 10", `${latI.toLocaleString("en-IN")}<br>${hot(bh(7))}`) +
          io("Longitude", `${s.lng[0]},${s.lng[1]}`, "degrees + minutes / 60, then × 1,000,000", "Bytes 11 to 14", `${lngI.toLocaleString("en-IN")}<br>${hot(bh(11))}`);
      }
      case "pack": {
        const P2 = P.bytes.map((i) => hex2(c.bytes[i])).join(" ");
        const crcCalc = C.crc8(c.bytes, 31);
        const valIn = c.supported ? `${P.pid === 0x0C ? "0x0C" : "0x" + pidB}: ${c.report ? M.decodePid(c.reply) : c.value}` : `0x${pidB}: None`;
        const op = c.supported ? `${esc(P.packExpr)} → ${P.pid === 0x0C ? Math.round((c.report ? M.decodePid(c.reply) : c.value) * 4) + " = 0x" + P2.replace(" ", "") : ""}` : "None → sentinel 0xFF";
        return io("decoded dict", esc(valIn), op, `Byte${P.bytes.length > 1 ? "s " + P.bytes.join("-") : " " + P.bytes[0]}`, hot(P2)) +
          byteGrid(c, { hot: P.bytes.concat([31]) }) +
          `<p class="crcline num">crc8(bytes 0–30) = 0x${hex2(crcCalc)} → byte 31 is 0x${hex2(c.bytes[31])} ${crcCalc === c.bytes[31] ? `<span class="ok">${FT.icon("i-check")} match</span>` : `<span class="bad">${FT.icon("i-crit")} mismatch</span>`}</p>`;
      }
      case "unpack": {
        const u = C.unpackPacket(c.bytes);
        const v = u.vehicle;
        const keys = ["rpm", "speed_kmh", "gear", "throttle_pct", "coolant_c", "fuel_level_pct", "maf_gps", "engine_load_pct"];
        const lines = keys.map((k) => {
          const line = `    "${k}": ${JSON.stringify(v[k])},`;
          return k === P.leaf ? hot(esc(line)) : esc(line);
        }).join("\n");
        const json = `{\n  "type": "telemetry",\n  "schema_version": "${esc(c.msg.schema_version)}",\n  "vehicle": {\n${lines}\n    ...\n  },\n  "crc_valid": ${hot(String(u.crc_valid))}\n}`;
        return io(`Byte${P.bytes.length > 1 ? "s " + P.bytes.join("-") : " " + P.bytes[0]}`, hot(P.bytes.map((i) => hex2(c.bytes[i])).join(" ")),
          "unpack_packet(): same layout, sentinel → null", "JSON field", `"${P.leaf}": ${hot(esc(JSON.stringify(v[P.leaf])))}`) +
          `<pre class="json num">${json}</pre>`;
      }
      case "backend": {
        const raw = JSON.stringify(c.msg);
        const payload = raw.length > 92 ? raw.slice(0, 92) + "…" : raw;
        const pos = raw.indexOf(`"${P.leaf}":`);
        const field = pos >= 0 ? raw.slice(pos, raw.indexOf(",", pos)) : "";
        return io("WebSocket text frame", `${raw.length.toLocaleString("en-IN")} bytes of JSON`, 'route: type == "telemetry"', "Stored and forwarded", `save_telemetry()<br>fan_out()`) +
          `<div class="row-shape"><div class="io-label">SQLite row, table telemetry (id, ts, payload)</div>
            <table class="dbrow num"><thead><tr><th>id</th><th>ts</th><th>payload (TEXT)</th></tr></thead>
            <tbody><tr><td>auto</td><td>${c.msg.ts}</td><td>${esc(payload)}<br>… ${hot(esc(field))} …</td></tr></tbody></table></div>`;
      }
      case "dash": {
        const v = c.msg.vehicle[P.leaf];
        const pt = FT.provText(c.state, c.msg);
        const tile = `<div class="tile demo-tile${v == null ? " is-null" : ""}"><span class="tile-label">${esc(P.name)}</span>
          <span class="tile-value num">${v == null ? esc(FT.nullText(c.state, c.msg)) : esc(String(v)) + `<small>${esc(P.unit)}</small>`}</span>
          <span class="prov" data-p="${esc(c.state)}">${esc(pt)}</span></div>`;
        return io("onmessage", "JSON.parse(ev.data)", "FT.ingest(msg) → state.cars[id].msg", "setTile()", `${P.leaf} = ${hot(esc(JSON.stringify(v)))}`) +
          `<div class="tile-stage"><span class="io-label">The tile, drawn by the same code as the car view</span>${tile}</div>`;
      }
    }
    return "";
  }

  /* ---------------- code ---------------- */
  function splitHighlighted(html) {
    const out = [], stack = [];
    let line = "", i = 0;
    while (i < html.length) {
      const ch = html[i];
      if (ch === "<") {
        const end = html.indexOf(">", i);
        const tag = html.slice(i, end + 1);
        if (tag.startsWith("</")) stack.pop(); else stack.push(tag);
        line += tag; i = end + 1; continue;
      }
      if (ch === "\n") { out.push(line + "</span>".repeat(stack.length)); line = stack.join(""); i++; continue; }
      line += ch; i++;
    }
    out.push(line + "</span>".repeat(stack.length));
    return out;
  }
  function highlightLines(s) {
    const code = s.lines.join("\n");
    if (window.hljs) {
      try { return splitHighlighted(window.hljs.highlight(code, { language: s.language, ignoreIllegals: true }).value); }
      catch (e) { /* fall through to plain text */ }
    }
    return s.lines.map(esc);
  }
  function snippetBlock(id) {
    const sid = id === "@d" ? "d_" + st.pid : id;
    const s = SNIP[sid];
    if (!s) return `<p class="nil">Snippet ${esc(sid)} is missing: run python demo/obd-flow/build_snippets.py</p>`;
    const hl = new Set([...(s.highlight.all || []), ...(s.highlight[st.pid] || [])]);
    const lines = highlightLines(s);
    const n = s.lines.length;
    const show = new Set();
    if (n <= 16) for (let k = 0; k < n; k++) show.add(s.start + k);
    else {
      show.add(s.start); show.add(s.start + 1);
      for (const h of hl) for (let k = h - 2; k <= h + 2; k++) if (k >= s.start && k <= s.end) show.add(k);
      show.add(s.end);
    }
    let rows = "", hiddenRun = [];
    const flush = () => {
      if (!hiddenRun.length) return;
      rows += `<tr class="fold"><td class="ln"></td><td><button type="button" class="fold-btn" data-run="${hiddenRun[0]}">${hiddenRun.length} line${hiddenRun.length > 1 ? "s" : ""} hidden, show</button></td></tr>`;
      hiddenRun.forEach((ln) => { rows += rowHtml(ln, true); });
      hiddenRun = [];
    };
    const rowHtml = (ln, hidden) => `<tr class="cl${hl.has(ln) ? " hl" : ""}" data-ln="${ln}"${hidden ? ` hidden data-run="${hiddenRunStart}"` : ""}><td class="ln num">${ln}</td><td class="lc"><code>${lines[ln - s.start] || ""}</code></td></tr>`;
    let hiddenRunStart = null;
    for (let ln = s.start; ln <= s.end; ln++) {
      if (show.has(ln)) { flush(); rows += rowHtml(ln, false); hiddenRunStart = null; }
      else { if (!hiddenRun.length) hiddenRunStart = ln; hiddenRun.push(ln); }
    }
    flush();
    const anyHidden = n > 16;
    return `<div class="snip" data-snippet="${esc(sid)}" data-file="${esc(s.file)}" data-start="${s.start}" data-end="${s.end}">
      <div class="snip-head"><span class="snip-file num">${esc(s.file)}</span><span class="snip-lines">lines ${s.start}–${s.end}, <code>${esc(s.name)}</code></span>
      ${anyHidden ? `<button type="button" class="snip-all" aria-pressed="false">Expand all</button>` : ""}</div>
      <div class="snip-body"><table class="code hljs"><tbody>${rows}</tbody></table></div></div>`;
  }
  function code(stage) {
    const ids = CODE[stage];
    if (!ids.length) {
      return stage === "ecu"
        ? `<p class="nocode">No code of ours runs here: this happens inside the car's engine computer.</p>`
        : `<p class="nocode">No code of ours runs here. The ELM327 chip builds and reads the CAN frames; our first line of code is in stage 3.</p>`;
    }
    const note = stage === "gps" ? `<p class="code-note">On 18 July the Pi capture (<code>elm327_bt.py</code> on the gps-integration branch) used this same <code>NMEAParser</code> from <code>sensing/gps_neo6m_pi.py</code>.</p>` : "";
    return note + ids.map(snippetBlock).join("");
  }
  document.addEventListener("click", (e) => {
    const f = e.target.closest(".fold-btn");
    if (f) {
      const body = f.closest("tbody");
      body.querySelectorAll(`tr[data-run="${f.dataset.run}"]`).forEach((tr) => { tr.hidden = false; });
      f.closest("tr").remove();
      return;
    }
    const all = e.target.closest(".snip-all");
    if (all) {
      const snip = all.closest(".snip");
      snip.querySelectorAll("tr[hidden]").forEach((tr) => { tr.hidden = false; });
      snip.querySelectorAll("tr.fold").forEach((tr) => tr.remove());
      all.remove();
    }
  });

  /* ---------------- evidence + lightbox ---------------- */
  function evidence(stage) {
    return EVIDENCE[stage].map(([key, note]) => {
      const f = FIGS[key];
      if (!f) return "";
      return `<figure class="ev">
        <button type="button" class="ev-img" data-fig="${key}" aria-label="Enlarge report Figure ${f.figure}"><img src="${f.file}" alt="Report Figure ${f.figure}: ${esc(f.caption)}" loading="lazy"></button>
        <figcaption><span class="ev-num">Report Figure ${f.figure}</span> ${esc(f.caption)}<span class="ev-note">${esc(note)}</span></figcaption></figure>`;
    }).join("");
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".ev-img");
    if (!b) return;
    const f = FIGS[b.dataset.fig];
    const img = document.createElement("img");      // created on open: no <img> without a src in the page
    img.src = f.file;
    img.alt = `Report Figure ${f.figure}: ${f.caption}`;
    $("lb-holder").replaceChildren(img);
    $("lb-cap").textContent = `Report Figure ${f.figure}: ${f.caption}`;
    $("lightbox").showModal();
  });
  $("lb-close").addEventListener("click", () => $("lightbox").close());
  $("lightbox").addEventListener("click", (e) => { if (e.target === $("lightbox")) $("lightbox").close(); });

  /* ---------------- pipeline strip ---------------- */
  function buildPipeline() {
    $("stages").innerHTML = STAGES.map((s) =>
      `<li><button class="node ${s.hw ? "node-hw" : "node-sw"}" type="button" data-stage="${s.id}" aria-label="Stage ${s.n}: ${s.name}">
        <span class="node-num num">${s.n}</span><span class="node-name">${s.name}</span><span class="node-sub">${s.sub}</span></button></li>`).join("");
    document.querySelectorAll(".node").forEach((n) => n.addEventListener("click", () => go(n.dataset.stage)));
  }
  function placeDot() {
    const node = document.querySelector(`.node[data-stage="${st.stage}"]`);
    const pipe = $("pipeline"), row = $("stages");
    if (!node || !pipe || !row) return;
    const a = node.getBoundingClientRect(), p = pipe.getBoundingClientRect(), r = row.getBoundingClientRect();
    // x follows the active node; y stays on the rail under the stage row (the GPS branch joins at stage 5)
    $("dot").style.transform = `translate(${a.left - p.left + a.width / 2 - 7}px, ${r.bottom - p.top - 0.55 * parseFloat(getComputedStyle(document.documentElement).fontSize) - 7}px)`;
  }

  /* ---------------- render ---------------- */
  function sourceTag(stage, c) {
    if (st.summary) return "";
    if (c.report) return ["ecu", "port", "elm", "decode", "gps"].includes(stage) ? "From report Figures 4.3 and 5.13" : "Packed from the report's values";
    if (["ecu", "port", "elm", "decode", "gps"].includes(stage)) return stage === "gps" && c.msg.provenance.gps === "measured" ? "Actual packet" : "Reconstructed from this packet";
    return "Actual packet";
  }
  function carLine(c) {
    const car = FT.state.cars[c.msg.source.vehicle_id];
    const seq = c.msg.device ? c.msg.device.seq : "--";
    if (c.report) return `Maruti Suzuki Fronx, one real capture cycle (18 July, report Figure 5.13)`;
    const age = car && car.lastRx ? FT.ageStr(Date.now() - car.lastRx) + " ago" : "";
    return `${c.name}, ${c.msg.source.data_mode}, packet seq ${seq}${st.mode === "paused" ? " (paused)" : age ? ", " + age : ""}`;
  }

  let lastCodeKey = "";
  function render(force) {
    const msg = currentMsg();
    document.querySelectorAll(".node").forEach((n) => {
      n.classList.toggle("is-active", n.dataset.stage === st.stage);
      n.setAttribute("aria-current", n.dataset.stage === st.stage ? "step" : "false");
    });
    placeDot();
    $("stage-view").hidden = st.summary;
    $("summary-view").hidden = !st.summary;
    $("summary").setAttribute("aria-pressed", st.summary);
    $("report").setAttribute("aria-pressed", st.mode === "report");
    $("pause").setAttribute("aria-pressed", st.mode === "paused");
    $("pause").innerHTML = st.mode === "paused" ? `${FT.icon("i-play")}<span>Live</span>` : `${FT.icon("i-pause")}<span>Pause</span>`;
    $("pause").disabled = st.mode === "report";
    $("source").disabled = st.mode === "report";
    status(msg);
    if (!msg) {
      $("p-what").innerHTML = `<p class="nil">Waiting for packets from ${esc(st.carId || "a car")}. Start the demo with python demo/run_demo.py, or pick another source.</p>`;
      $("p-data").innerHTML = ""; $("p-evidence").innerHTML = evidence(st.stage); $("p-code").innerHTML = code(st.stage);
      return;
    }
    const c = ctxOf(msg);
    if (st.summary) { renderSummary(c); writeHash(); return; }
    const S = stageById(st.stage);
    $("sv-title").textContent = `${S.n === "GPS" ? "GPS side branch" : "Stage " + S.n + ": " + S.name}`;
    $("sv-tag").textContent = sourceTag(st.stage, c);
    $("sv-tag").dataset.kind = /Actual|Packed/.test($("sv-tag").textContent) ? "actual" : "rebuilt";
    $("sv-car").textContent = carLine(c);
    $("p-what").innerHTML = what(st.stage, c);
    $("p-data").innerHTML = data(st.stage, c);
    const codeKey = st.stage + st.pid + (window.hljs ? "h" : "") + (c.supported ? "s" : "n");
    if (force || codeKey !== lastCodeKey) {
      $("p-code").innerHTML = code(st.stage);
      $("p-evidence").innerHTML = evidence(st.stage);
      lastCodeKey = codeKey;
    }
    writeHash();
  }

  function renderSummary(c) {
    const P = c.P, dh = dataHex(c), pidB = hex2(P.pid);
    $("sum-car").textContent = carLine(c);
    const g = c.msg.gps;
    const gga = g.lat != null ? M.ggaSentence(g, c.msg.ts) : null;
    const bytesHex = Array.from(c.bytes, (b, i) => (P.bytes.includes(i) ? hot(hex2(b)) : hex2(b))).join(" ");
    const v = c.msg.vehicle[P.leaf];
    const rows = [
      ["1", "Car ECU", c.supported ? `${esc(P.ecuWord)} = ${hot(esc(fmtVal(c)))}` : `<span class="nil">${esc(c.reason)}</span>`],
      ["2", "CAN frames", c.supported ? `7DF ${["02", "01", pidB].join(" ")} → 7E8 ${[hex2(2 + dh.length), "41", pidB].join(" ")} ${hot(dh.join(" "))}` : `7DF 02 01 ${pidB} → no data`],
      ["3", "ELM327 text", `"01 ${pidB}\\r" → ${c.supported ? `"${hot(esc(c.reply))}"` : '"NO DATA" → query_pid(): "7F 01 ' + pidB + '"'}`],
      ["4", "Decoded", c.supported ? `decode_pid() = ${hot(esc(String(M.decodePid(c.reply))))} ${esc(P.unit)}` : `decode_pid() = ${hot("None")}`],
      ["GPS", "GPS branch", gga ? `${esc(gga.sentence.slice(0, 48))}… → ${g.lat.toFixed(6)}, ${g.lng.toFixed(6)} → int32 ${Math.round(g.lat * 1e6)}` : "no fix: sentinel 0x7FFFFFFF"],
      ["5", "Packet bytes", `<span class="sum-bytes">${bytesHex}</span>`],
      ["6", "JSON field", `"${esc(P.leaf)}": ${hot(esc(JSON.stringify(v)))}, "crc_valid": ${C.crc8(c.bytes, 31) === c.bytes[31]}`],
      ["7", "Database row", `telemetry(id, ts=${c.msg.ts}, payload={… "${esc(P.leaf)}": ${hot(esc(JSON.stringify(v)))} …})`],
      ["8", "Dashboard tile", `${esc(P.name)}: ${hot(v == null ? esc(FT.nullText(c.state, c.msg)) : esc(String(v)) + " " + esc(P.unit))} <span class="prov" data-p="${esc(c.state)}">${esc(FT.provText(c.state, c.msg))}</span>`],
    ];
    $("sum-list").innerHTML = rows.map(([n, name, val]) =>
      `<li class="sum-row${n === "GPS" ? " sum-gps" : ""}"><span class="sum-n num">${n}</span><span class="sum-name">${name}</span><span class="sum-val num">${val}</span></li>`).join("");
  }

  function status(msg) {
    let t;
    if (st.mode === "report") t = "Report example: the exact numbers from report Figures 4.3 and 5.13.";
    else if (!msg) t = `Waiting for ${st.carId || "a car"}.`;
    else t = st.mode === "paused" ? "Paused: the stages hold this one packet." : "Live: following every new packet from the backend.";
    $("tb-status").textContent = t;
  }

  /* ---------------- navigation ---------------- */
  function go(stage) { st.stage = stage; render(true); }
  function step(dir) { const i = ORDER.indexOf(st.stage); go(ORDER[(i + dir + ORDER.length) % ORDER.length]); }
  function setPlaying(on) {
    clearInterval(st.playing); st.playing = null;
    if (on) st.playing = setInterval(() => step(1), 6000);
    $("play").setAttribute("aria-pressed", on);
    $("play").innerHTML = on ? `${FT.icon("i-pause")}<span>Stop walking</span>` : `${FT.icon("i-play")}<span>Walk through</span>`;
  }
  $("prev").addEventListener("click", () => step(-1));
  $("next").addEventListener("click", () => step(1));
  $("play").addEventListener("click", () => setPlaying(!st.playing));
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("select, input, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
    if ($("lightbox").open) return;
    if (e.key === "ArrowRight") { step(1); e.preventDefault(); }
    else if (e.key === "ArrowLeft") { step(-1); e.preventDefault(); }
    else if (e.key === " ") { if (e.target.closest("button")) return; setPlaying(!st.playing); e.preventDefault(); }
    else if (/^[1-8]$/.test(e.key)) go(STAGES[+e.key - 1].id);
  });

  /* ---------------- controls ---------------- */
  function refreshSources() {
    const sel = $("source");
    const cars = FT.carList().filter((c) => c.msg);
    const opts = cars.map((c) => `<option value="${esc(c.id)}">${esc(c.msg.source.name)}${FT.isLiveCar(c.msg) ? " (live, Control Console)" : c.msg.source.data_mode === "recorded" ? " (recorded)" : " (simulated)"}</option>`);
    if (st.carId && !cars.some((c) => c.id === st.carId)) opts.unshift(`<option value="${esc(st.carId)}">${esc(st.carId)} (waiting)</option>`);
    const html = opts.join("") || `<option value="">Waiting for cars</option>`;
    if (sel.innerHTML !== html) sel.innerHTML = html;
    sel.value = st.carId;
  }
  $("source").addEventListener("change", (e) => { st.carId = e.target.value; if (st.mode === "paused") st.mode = "live"; render(true); });
  $("pid").value = st.pid;
  $("pid").addEventListener("change", (e) => { st.pid = e.target.value; render(true); });
  $("pause").addEventListener("click", () => {
    if (st.mode === "live") { const car = FT.state.cars[st.carId]; st.frozen = car && car.msg ? JSON.parse(JSON.stringify(car.msg)) : null; st.mode = st.frozen ? "paused" : "live"; }
    else if (st.mode === "paused") st.mode = "live";
    render(true);
  });
  $("report").addEventListener("click", () => { st.mode = st.mode === "report" ? "live" : "report"; if (st.mode === "report") st.pid = $("pid").value; render(true); });
  $("summary").addEventListener("click", () => { st.summary = !st.summary; render(true); });

  /* theme + link, same as the fleet dashboard */
  function themeUi() {
    const dark = FT.isDark();
    $("theme-toggle").innerHTML = `<svg class="icon"><use href="#${dark ? "i-sun" : "i-moon"}"/></svg><span>${dark ? "Light" : "Dark"}</span>`;
  }
  $("theme-toggle").addEventListener("click", () => {
    const next = FT.isDark() ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("ft-theme", next); } catch (e) { /* storage blocked: lasts for this visit */ }
    themeUi();
  });
  const LINK = { connecting: "Connecting", live: "Live: backend WebSocket", reconnecting: "Reconnecting", standalone: "In-browser simulator" };
  FT.on((what, x) => {
    if (what === "mode") { $("link").dataset.state = x; $("link-text").textContent = LINK[x] || x; }
    if (what === "newcar" || what === "removed") { refreshSources(); if (x && x.id === st.carId) render(true); }
    if (what === "telemetry" && x.id === st.carId && st.mode === "live") {
      const now = performance.now();
      if (now - st.lastRender > 450) { st.lastRender = now; render(false); }
    }
    if (what === "removed" && x === st.carId && st.mode === "live") render(true);
  });
  window.addEventListener("hljs-ready", () => render(true));
  window.addEventListener("resize", placeDot);

  buildPipeline();
  themeUi();
  refreshSources();
  render(true);
  FT.connect();
  setInterval(() => { if (st.mode === "live" && !st.summary) { const m = currentMsg(); if (m) $("sv-car").textContent = carLine(ctxOf(m)); } }, 1000);
  window.__flow = { st, render, go };
})();
