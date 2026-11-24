# build_snippets.py -- extract the REAL code shown on the /flow/ page.
#
#   python demo/obd-flow/build_snippets.py          # writes demo/obd-flow/js/snippets.js
#   python demo/obd-flow/build_snippets.py --check  # only verify; exit 1 if anything is missing
#
# Every snippet is taken from the repository by NAME, never copied by hand:
#   - Python: ast finds the function / method / assignment and gives the real start and end
#     line numbers (decorators included).
#   - JavaScript: the line declaring the named function is located, and its body is found by
#     brace matching (strings, template literals and comments are skipped).
# Highlighted lines are found by CONTENT (a substring per line), so they follow the code when
# it changes. A missing function or a highlight that matches nothing is an error.

import ast
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "demo" / "obd-flow" / "js" / "snippets.js"

# id: (file, language, name, {highlight-group: [substrings]})
# Group "all" is always highlighted; a PID group ("0x0C", ...) is added when that PID is traced.
# A substring starting with "@first:" highlights only its first matching line.
PID_PACK = {"0x0C": ["decoded.get(0x0C)"], "0x0D": ["decoded.get(0x0D)"], "0x05": ["decoded.get(0x05)"],
            "0x11": ["decoded.get(0x11)"], "0x2F": ["decoded.get(0x2F)"]}
PID_UNPACK = {"0x0C": ['"rpm":'], "0x0D": ['"speed_kmh":'], "0x05": ['"coolant_c":'],
              "0x11": ['"throttle_pct":'], "0x2F": ['"fuel_level_pct":']}
SNIPPETS = {
    "at_init": ("backend/elm327_bt.py", "python", "AT_INIT_SEQUENCE",
                {"all": ['b"ATZ\\r"', 'b"ATE0\\r"', 'b"ATSP0\\r"']}),
    "initialise_elm327": ("backend/elm327_bt.py", "python", "initialise_elm327",
                          {"all": ["for cmd, skip_if_unknown in AT_INIT_SEQUENCE:", "resp = send_at(ser, cmd"]}),
    "query_pid": ("backend/elm327_bt.py", "python", "query_pid",
                  {"all": ['cmd_str = f"01 {pid:02X} 1\\r" if fast else f"01 {pid:02X}\\r"', "ser.write(cmd_str.encode())",
                           "response = read_until_prompt(ser, timeout=timeout)", 'idx = response.find("41 ")',
                           'return f"7F 01 {pid:02X}"   # no usable Mode 01 data']}),
    "decode_pid": ("backend/obd_decoder.py", "python", "decode_pid",
                   {"all": ["tokens = hex_str.strip().upper().split()", 'if tokens[0] == "7F":',
                            "pid = int(tokens[1], 16)", "data = [int(b, 16) for b in tokens[2:]]",
                            "decoder = _PID_DECODERS.get(pid)", "return decoder(data)"]}),
    "d_0x0C": ("backend/obd_decoder.py", "python", "_d_0x0C", {"all": ["def _d_0x0C"]}),
    "d_0x0D": ("backend/obd_decoder.py", "python", "_d_0x0D", {"all": ["def _d_0x0D"]}),
    "d_0x05": ("backend/obd_decoder.py", "python", "_d_0x05", {"all": ["def _d_0x05"]}),
    "d_0x11": ("backend/obd_decoder.py", "python", "_d_0x11", {"all": ["def _d_0x11"]}),
    "d_0x2F": ("backend/obd_decoder.py", "python", "_d_0x2F", {"all": ["def _d_0x2F"]}),
    "pack_packet": ("backend/obd_decoder.py", "python", "pack_packet",
                    dict({"all": ["body = struct.pack(", "packet = body + bytes([crc8(body)])"]}, **PID_PACK)),
    "crc8": ("backend/obd_decoder.py", "python", "crc8",
             {"all": ["crc ^= byte", "crc = ((crc << 1) ^ 0x07) & 0xFF if (crc & 0x80) else (crc << 1) & 0xFF"]}),
    "coord": ("backend/obd_decoder.py", "python", "_coord", {"all": ["return int(round(val * 1_000_000))"]}),
    "unpack_packet": ("backend/obd_decoder.py", "python", "unpack_packet",
                      dict({"all": ["crc_valid = crc8(raw_bytes[:31]) == raw_bytes[31]", "f = struct.unpack(_STRUCT, raw_bytes[:31])"]},
                           **PID_UNPACK)),
    "parse_nmea_lat_lng": ("sensing/gps_neo6m_pi.py", "python", "parse_nmea_lat_lng",
                           {"all": ["degrees = float(coord_str[:deg_len])", "minutes = float(coord_str[deg_len:])",
                                    "decimal_degrees = degrees + (minutes / 60.0)"]}),
    "parse_gga": ("sensing/gps_neo6m_pi.py", "python", "NMEAParser._parse_gga",
                  {"all": ["lat = parse_nmea_lat_lng(fields[2], fields[3])", "lng = parse_nmea_lat_lng(fields[4], fields[5])"]}),
    "websocket_endpoint": ("backend/websocket_handler.py", "python", "websocket_endpoint",
                           {"all": ["raw = await websocket.receive_text()", "message = json.loads(raw)",
                                    'if msg_type == "telemetry":', "save_telemetry(ts, message)",
                                    "@first:await fan_out(raw, sender=websocket)"]}),
    "fan_out": ("backend/websocket_handler.py", "python", "fan_out",
                {"all": ["for client in list(connected_clients):", "await client.send_text(raw_message)"]}),
    "save_telemetry": ("backend/database.py", "python", "save_telemetry",
                       {"all": ['"INSERT INTO telemetry (ts, payload) VALUES (?, ?)"', "(ts, json.dumps(payload))"]}),
    "init_db": ("backend/database.py", "python", "init_db",
                {"all": ["CREATE TABLE IF NOT EXISTS telemetry", "ts      INTEGER", "payload TEXT"]}),
    "ft_connect": ("demo/fleet-dashboard/js/app.js", "javascript", "FT.connect",
                   {"all": ["ws.onmessage = (ev) => {", "m = JSON.parse(ev.data)", 'if (m && m.type === "telemetry") FT.ingest(m);']}),
    "ft_ingest": ("demo/fleet-dashboard/js/app.js", "javascript", "FT.ingest",
                  {"all": ["car.msg = msg;", "if (b32 && b32.length === 32) { car.crc32 = C.crc8(b32, 31) === b32[31];",
                           "evaluate(id, msg);", 'emit(isNew ? "newcar" : "telemetry", car);']}),
    "set_tile": ("demo/fleet-dashboard/js/car.js", "javascript", "setTile",
                 {"all": ["if (isNull) html = FT.esc(FT.nullText(state, msg));",
                          'else html = FT.esc(digits == null ? String(value) : Number(value).toFixed(digits))',
                          "const pt = FT.provText(state, msg);"]}),
}


def py_extract(path, name):
    src = path.read_text(encoding="utf-8")
    tree = ast.parse(src)
    parts = name.split(".")
    nodes = tree.body
    found = None
    for i, part in enumerate(parts):
        found = None
        for n in nodes:
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and n.name == part:
                found = n
            elif isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == part for t in n.targets):
                found = n
        if found is None:
            raise LookupError(f"{name} not found in {path}")
        nodes = getattr(found, "body", [])
    start = min([found.lineno] + [d.lineno for d in getattr(found, "decorator_list", [])])
    return start, found.end_lineno


def js_strip(line, state):
    """Return the line with strings/template literals/comments blanked, tracking multi-line state."""
    out, i = [], 0
    while i < len(line):
        c = line[i]
        if state["mode"] == "block":
            if line.startswith("*/", i):
                state["mode"] = None; i += 2
            else:
                i += 1
            continue
        if state["mode"] in ("'", '"', "`"):
            if c == "\\":
                i += 2; continue
            if state["mode"] == "`" and line.startswith("${", i):
                state["stack"].append("`"); state["mode"] = None; out.append("{"); i += 2; continue
            if c == state["mode"]:
                state["mode"] = None
            i += 1
            continue
        if line.startswith("//", i):
            break
        if line.startswith("/*", i):
            state["mode"] = "block"; i += 2; continue
        if c in "'\"`":
            state["mode"] = c; i += 1; continue
        out.append(c)
        if c == "{":
            state["stack"].append("{")
        elif c == "}" and state["stack"]:
            top = state["stack"].pop()
            if top == "`":
                state["mode"] = "`"
        i += 1
    return "".join(out)


def js_extract(path, name):
    lines = path.read_text(encoding="utf-8").splitlines()
    short = name.split(".")[-1]
    pats = [re.compile(r"^\s*" + re.escape(name) + r"\s*=\s*(async\s+)?function\b"),
            re.compile(r"^\s*(async\s+)?function\s+" + re.escape(short) + r"\s*\(")]
    start = next((i for i, l in enumerate(lines) if any(p.search(l) for p in pats)), None)
    if start is None:
        raise LookupError(f"{name} not found in {path}")
    state = {"mode": None, "stack": []}
    depth, opened = 0, False
    for j in range(start, len(lines)):
        code = js_strip(lines[j], state)
        for c in code:
            if c == "{":
                depth += 1; opened = True
            elif c == "}":
                depth -= 1
        if opened and depth == 0:
            return start + 1, j + 1
    raise LookupError(f"could not find the end of {name} in {path}")


def build():
    out, errors = {}, []
    for sid, (rel, lang, name, groups) in SNIPPETS.items():
        path = ROOT / rel
        try:
            start, end = (py_extract if lang == "python" else js_extract)(path, name)
        except LookupError as e:
            errors.append(str(e)); continue
        lines = path.read_text(encoding="utf-8").splitlines()[start - 1:end]
        hl = {}
        for g, subs in groups.items():
            nums = []
            for sub in subs:
                first = sub.startswith("@first:")          # "@first:text" = only the first matching line
                sub = sub[len("@first:"):] if first else sub
                hits = [start + k for k, l in enumerate(lines) if sub in l]
                hits = hits[:1] if first else hits
                if not hits:
                    errors.append(f"{sid}: highlight {sub!r} matches no line of {name} in {rel}")
                nums.extend(hits)
            hl[g] = sorted(set(nums))
        out[sid] = {"file": rel, "language": lang, "name": name, "start": start, "end": end,
                    "lines": lines, "highlight": hl}
    return out, errors


def main():
    snippets, errors = build()
    for e in errors:
        print("ERROR:", e)
    if errors:
        sys.exit(1)
    if "--check" in sys.argv:
        print(f"OK: {len(snippets)} snippets found, all highlights match")
        return
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("// Generated by demo/obd-flow/build_snippets.py from the real source files -- do not edit.\n"
                   "window.FLOW_SNIPPETS = " + json.dumps(snippets, indent=None, separators=(",", ":")) + ";\n",
                   encoding="utf-8")
    for sid, s in snippets.items():
        print(f"{sid:20s} {s['file']}:{s['start']}-{s['end']}  highlight {s['highlight'].get('all')}")


if __name__ == "__main__":
    main()
