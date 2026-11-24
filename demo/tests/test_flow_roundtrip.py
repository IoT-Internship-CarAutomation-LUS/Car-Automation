# test_flow_roundtrip.py -- the /flow/ reconstruction must be exact.
#
#   python demo/tests/test_flow_roundtrip.py [--samples 600]
#
# 1. The JS port of decode_pid (demo/obd-flow/js/flow-model.js) must give the same answer as
#    backend/obd_decoder.py decode_pid for every possible reply byte of the traced PIDs (and a
#    sweep of two-byte RPM replies, plus NO DATA / 7F / short replies).
# 2. For real simulator packets (backend/fleet_sim cars, Fronx recorded AND simulated), the ELM
#    reply rebuilt from each packet must decode back to the packet: the exact value for RPM, speed
#    and coolant; the exact packet byte (so the exact unpacked value) for throttle and fuel. A null
#    value must sit on the 0xFF sentinel and its NO DATA reply must decode to None.
# Runs the JS in Node (no browser needed).

import argparse
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "demo" / "simulator"))
from obd_decoder import decode_pid  # noqa: E402
import fleet_sim  # noqa: E402

PIDS = {"0x0C": 0x0C, "0x0D": 0x0D, "0x05": 0x05, "0x11": 0x11, "0x2F": 0x2F}

NODE = r"""
// Loads our own two repo scripts (codec.js, flow-model.js) into Node for testing; no external input.
global.window = global;
const fs = require('fs');
eval(fs.readFileSync(process.argv[1], 'utf8'));   // codec.js
eval(fs.readFileSync(process.argv[2], 'utf8'));   // flow-model.js
const data = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const M = window.FlowModel;
const out = { decode_mismatch: [], round: {}, failures: [] };
for (const [reply, py] of data.decode_table) {
  const js = M.decodePid(reply);
  const same = JSON.stringify(js) === JSON.stringify(py);
  if (!same) out.decode_mismatch.push([reply, py, js]);
}
for (const msg of data.messages) {
  for (const key of Object.keys(M.PIDS)) {
    const r = M.roundTrip(key, msg);
    const tag = msg.source.vehicle_id + ' ' + key;
    out.round[tag] = out.round[tag] || { ok: 0, fail: 0, nulls: 0 };
    if (r.ok) out.round[tag].ok++; else { out.round[tag].fail++; if (out.failures.length < 10) out.failures.push([tag, r]); }
    if (r.value == null) out.round[tag].nulls++;
  }
}
console.log(JSON.stringify(out));
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", type=int, default=600)
    args = ap.parse_args()

    # 1. decode table from the real Python decode_pid
    table = []
    for key, pid in PIDS.items():
        for a in range(256):
            if pid == 0x0C:
                for b in (0, 0x2E, 0x80, 0xFF):
                    rep = f"41 0C {a:02X} {b:02X}"
                    table.append([rep, decode_pid(rep)])
            else:
                rep = f"41 {pid:02X} {a:02X}"
                table.append([rep, decode_pid(rep)])
        for rep in ("NO DATA", f"7F 01 {pid:02X}", f"41 {pid:02X}", "", "?"):
            table.append([rep, decode_pid(rep)])

    # 2. real simulator packets
    msgs = []
    for mode in ("recorded", "simulated"):
        a = argparse.Namespace(fronx_mode=mode, fronx_ambient="recorded", cars=list(fleet_sim.CAR_SPECS))
        fleet = fleet_sim.Fleet(a)
        t0 = time.time()
        for car in fleet.cars.values():
            if mode == "simulated" and car.id != "fronx":
                continue
            if car.id == "omni":
                car.scen["overheat"] = True            # include the >110 C coolant range
            for k in range(args.samples):
                msgs.append(car.step(t0 + k))

    with tempfile.TemporaryDirectory() as td:
        data = Path(td) / "data.json"
        data.write_text(json.dumps({"decode_table": table, "messages": msgs}))
        res = subprocess.run(["node", "-e", NODE,
                              str(ROOT / "demo/fleet-dashboard/js/codec.js"),
                              str(ROOT / "demo/obd-flow/js/flow-model.js"), str(data)],
                             capture_output=True, text=True)
    if res.returncode != 0:
        print(res.stderr)
        sys.exit(1)
    out = json.loads(res.stdout)
    ok = True
    print(f"decode_pid port: {len(table)} replies compared, {len(out['decode_mismatch'])} mismatches")
    if out["decode_mismatch"]:
        ok = False
        print("  e.g.", out["decode_mismatch"][:5])
    total_ok = sum(v["ok"] for v in out["round"].values())
    total = sum(v["ok"] + v["fail"] for v in out["round"].values())
    print(f"round trip: {total_ok}/{total} (car, PID, packet) cases exact over {len(msgs)} real simulator packets")
    for tag, v in sorted(out["round"].items()):
        print(f"  {tag:18s} ok {v['ok']:5d}  fail {v['fail']:3d}  null->sentinel {v['nulls']:5d}")
    if total_ok != total:
        ok = False
        print("failures:", out["failures"])
    print("RESULT:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
