#!/usr/bin/env python3
# backend/tests/dry_run.py
#
# Exercises the REAL run_capture() end-to-end with zero hardware, using
# fake_elm327.FakeELM327 in place of serial.Serial. This is the only patch
# made: elm327_bt.py itself is imported and run completely unmodified, so
# a failure here is elm327_bt.py's problem, not a fake-logic mismatch.
#
# Why this exists: since the v2.0.0 rewrite, run_capture() has never
# actually executed. --test fails at open_port() with no adapter powered
# at a desk, so initialise_elm327, the 0100 probe, ATRV, query_pid's
# SEARCHING-prefix recovery, the poll loop, log_decoded/log_raw, the
# pack_packet extras call, the v2 telemetry envelope, and --raw/--fast/
# --stream have ALL been unrun code. This proves them before a car session.
#
# Usage:
#   python backend/tests/dry_run.py             modes 1-4 only (no backend needed)
#   python backend/tests/dry_run.py --stream     also runs the --stream/backend test

import csv
import io
import json
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
BACKEND_DIR = TESTS_DIR.parent
sys.path.insert(0, str(BACKEND_DIR))
sys.path.insert(0, str(TESTS_DIR))

import serial  # the real pyserial module
from fake_elm327 import FakeELM327, DryRunStop

serial.Serial = FakeELM327  # the only patch -- elm327_bt.py runs completely unmodified

import elm327_bt
import obd_decoder

PASS, FAIL = "PASS", "FAIL"
results = []  # (label, ok)


def check(label, ok, detail=""):
    results.append((label, ok))
    tag = PASS if ok else FAIL
    print(f"  [{tag}] {label}" + (f" -- {detail}" if detail else ""))
    return ok


class Tee(io.TextIOBase):
    """Writes to real stdout AND a buffer, so output stays visible live
    while we also get to assert on it afterward."""
    def __init__(self, *streams):
        self._streams = streams

    def write(self, s):
        for st in self._streams:
            st.write(s)
        return len(s)

    def flush(self):
        for st in self._streams:
            st.flush()


def run_capture_captured(stop_after, **kwargs):
    """
    Run the REAL elm327_bt.run_capture() against a fresh FakeELM327 and a
    fresh temp log dir (never the real logs/), capturing stdout while
    still printing it live. Returns (captured_stdout, log_dir_path).
    """
    tmp_log_dir = tempfile.mkdtemp(prefix="dryrun_logs_")
    elm327_bt.LOG_DIR = tmp_log_dir

    FakeELM327.STOP_AFTER_CYCLES = stop_after
    FakeELM327.instances = []

    buf = io.StringIO()
    old_stdout = sys.stdout
    sys.stdout = Tee(old_stdout, buf)
    try:
        elm327_bt.run_capture(**kwargs)
    except DryRunStop as e:
        print(f"[DRY RUN] {e}")
    finally:
        sys.stdout = old_stdout

    return buf.getvalue(), Path(tmp_log_dir)


def read_csv_rows(log_dir: Path, kind: str):
    files = list(log_dir.glob(f"*/{kind}/{kind}_*.csv"))
    if not files:
        return []
    with open(files[0], newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def run_mode(label, **kwargs):
    print(f"\n{'=' * 70}\n  DRY RUN: {label}\n{'=' * 70}")
    stdout_text, log_dir = run_capture_captured(stop_after=5, **kwargs)
    fake = FakeELM327.instances[-1] if FakeELM327.instances else None
    return {
        "label": label,
        "stdout": stdout_text,
        "log_dir": log_dir,
        "decoded": read_csv_rows(log_dir, "decoded"),
        "raw": read_csv_rows(log_dir, "raw"),
        "stream": read_csv_rows(log_dir, "stream"),
        "fake": fake,
    }


ALL_PIDS_HEX = {f"0x{p:02X}" for p in (0x0C, 0x0D, 0x05, 0x04, 0x11, 0x2F, 0x10, 0x0F, 0x46, 0x0B, 0x01)}


def assert_common(res, expect_raw, expect_fast):
    label = res["label"]
    decoded = res["decoded"]
    stdout_text = res["stdout"]
    fake = res["fake"]

    check(f"[{label}] initialise_elm327 returns True despite ATH0='?'",
          "ELM327 initialised successfully." in stdout_text)

    check(f"[{label}] 0100 probe fired exactly once",
          fake is not None and fake.probe_0100_count == 1,
          f"probe_0100_count={fake.probe_0100_count if fake else '?'}")
    check(f"[{label}] 0100 raw reply printed",
          "41 00 BE 3E B8 11" in stdout_text)
    check(f"[{label}] 0100 raw reply logged via log_stream",
          any(r["event"] == "supported_pids" and "41 00 BE 3E B8 11" in r["detail"] for r in res["stream"]))

    check(f"[{label}] exactly 5 decoded cycles logged", len(decoded) == 5, f"got {len(decoded)}")

    if decoded:
        first = decoded[0]
        check(f"[{label}] first-cycle RPM decodes to 2092.5 (SEARCHING... recovered, not null)",
              first.get("rpm") == "2092.5", f"got {first.get('rpm')!r}")
        check(f"[{label}] fuel_level_pct is empty (None), not 0",
              first.get("fuel_level_pct", "x") == "", f"got {first.get('fuel_level_pct')!r}")
        check(f"[{label}] ambient_temp_c empty -- Fronx refuses PID 0x46",
              first.get("ambient_temp_c", "x") == "", f"got {first.get('ambient_temp_c')!r}")
        check(f"[{label}] map_kpa empty -- Fronx refuses PID 0x0B",
              first.get("map_kpa", "x") == "", f"got {first.get('map_kpa')!r}")
        check(f"[{label}] mil_on is True", first.get("mil_on") == "True", f"got {first.get('mil_on')!r}")
        check(f"[{label}] dtc_count is 3", first.get("dtc_count") == "3", f"got {first.get('dtc_count')!r}")

        packet_hex = first.get("packet_hex", "")
        try:
            raw_bytes = bytes.fromhex(packet_hex.replace(" ", ""))
            unpacked = obd_decoder.unpack_packet(raw_bytes)
            check(f"[{label}] packet is 32 bytes", len(raw_bytes) == 32, f"got {len(raw_bytes)}")
            check(f"[{label}] unpacked crc_valid is True", unpacked["crc_valid"] is True)
            check(f"[{label}] battery_v is 12.4 from ATRV (round-tripped through the packet)",
                  unpacked["vehicle"]["battery_v"] == 12.4, f"got {unpacked['vehicle']['battery_v']}")
            print(f"  packet_hex (cycle 1): {packet_hex}")
        except Exception as e:
            check(f"[{label}] packet_hex decodes cleanly", False, str(e))

    if fake:
        check(f"[{label}] SEARCHING... prefix path was actually exercised",
              fake._rpm_first_seen, "flag never set")

    if expect_raw:
        check(f"[{label}] raw CSV has 11 rows/cycle x 5 cycles = 55 rows",
              len(res["raw"]) == 55, f"got {len(res['raw'])}")
        seen_pids = {r["pid"] for r in res["raw"]}
        check(f"[{label}] all 11 PIDs present in raw log", seen_pids == ALL_PIDS_HEX,
              f"got {sorted(seen_pids)}")
        fuel_rows = [r for r in res["raw"] if r["pid"] == "0x2F"]
        rpm_rows = [r for r in res["raw"] if r["pid"] == "0x0C"]
        check(f"[{label}] fuel (0x2F) logged as status='unsupported'",
              bool(fuel_rows) and all(r["status"] == "unsupported" for r in fuel_rows))
        check(f"[{label}] RPM (0x0C) logged as status='ok'",
              bool(rpm_rows) and all(r["status"] == "ok" for r in rpm_rows))
    else:
        check(f"[{label}] no raw CSV written (raw_mode=False)", len(res["raw"]) == 0)

    if expect_fast:
        cmds = fake.commands_seen if fake else []
        check(f"[{label}] --fast request format seen (e.g. '01 0C 1')",
              any(c.replace(" ", "") == "010C1" for c in cmds))
    elif fake:
        cmds = fake.commands_seen
        check(f"[{label}] plain request format used ('01 0C', no frame-count suffix)",
              any(c.replace(" ", "") == "010C" for c in cmds))


def run_modes_1_to_4():
    print("#" * 70)
    print("# DRY RUN: modes 1-4, no backend, no hardware")
    print("#" * 70)

    res = run_mode("1. plain", raw_mode=False, fast_mode=False, stream_mode=False)
    assert_common(res, expect_raw=False, expect_fast=False)

    res = run_mode("2. --raw", raw_mode=True, fast_mode=False, stream_mode=False)
    assert_common(res, expect_raw=True, expect_fast=False)

    res = run_mode("3. --fast", raw_mode=False, fast_mode=True, stream_mode=False)
    assert_common(res, expect_raw=False, expect_fast=True)

    res = run_mode("4. --raw --fast", raw_mode=True, fast_mode=True, stream_mode=False)
    assert_common(res, expect_raw=True, expect_fast=True)

    # tyre/envelope shape can only be checked under stream_mode=True, since
    # the telemetry_packet dict is only ever built inside that branch --
    # see run_stream_test().


def wait_for_health(url, timeout_s=15):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as r:
                if r.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(0.5)
    return False


def run_stream_test(cycles=65, watchdog_s=180):
    print("\n" + "#" * 70)
    print(f"# DRY RUN: --stream against a REAL backend, {cycles} cycles")
    print("#" * 70)

    db_path = BACKEND_DIR / "telemetry.db"
    if db_path.exists():
        db_path.unlink()

    log_file_path = Path(tempfile.mktemp(prefix="dryrun_backend_", suffix=".log"))
    log_file = open(log_file_path, "w", encoding="utf-8")
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"],
        cwd=str(BACKEND_DIR), stdout=log_file, stderr=subprocess.STDOUT,
    )
    try:
        up = wait_for_health("http://127.0.0.1:8000/api/health")
        if not check("[--stream] real backend came up", up):
            return

        elm327_bt.BACKEND_WS_URL = "ws://127.0.0.1:8000/ws"

        box = {}

        def target():
            box["stdout"], box["log_dir"] = run_capture_captured(
                stop_after=cycles, raw_mode=False, fast_mode=False, stream_mode=True
            )

        t = threading.Thread(target=target, daemon=True)
        start = time.time()
        t.start()
        t.join(timeout=watchdog_s)
        elapsed = time.time() - start

        hung = t.is_alive()
        check(f"[--stream] capture completed within {watchdog_s}s (drain thread did not deadlock)",
              not hung, f"elapsed={elapsed:.1f}s, still_running={hung}")

        if not hung and "log_dir" in box:
            decoded = read_csv_rows(box["log_dir"], "decoded")
            check(f"[--stream] all {cycles} cycles completed and logged", len(decoded) == cycles,
                  f"got {len(decoded)}")
            check("[--stream] no WS send/connect failures logged",
                  not any(r["event"] in ("send_failed", "connect_failed")
                          for r in read_csv_rows(box["log_dir"], "stream")))

        time.sleep(1.0)  # let the last WS message land and get stored
        with urllib.request.urlopen("http://127.0.0.1:8000/api/telemetry/latest", timeout=3) as r:
            latest = json.loads(r.read())
        print("\nLatest telemetry stored by the real backend:")
        print(json.dumps(latest, indent=2))

        check("[--stream] schema_version is '2.0.0'", latest.get("schema_version") == "2.0.0")
        tyres = latest.get("tyres", {})
        leaf_ok = all(
            isinstance(tyres.get(k), dict)
            and tyres[k].get("pressure_kpa") is None
            and tyres[k].get("temp_c") is None
            for k in ("fl", "fr", "rl", "rr")
        )
        check("[--stream] tyres are four null-LEAF objects, not \"fl\": None", leaf_ok, json.dumps(tyres))
        check("[--stream] gps.fix key present", "fix" in latest.get("gps", {}))
        check("[--stream] vehicle.battery_v is 12.4 (ATRV, round-tripped over the wire)",
              latest.get("vehicle", {}).get("battery_v") == 12.4)

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
        log_file.close()
        backend_log_text = log_file_path.read_text(errors="ignore")
        check("[--stream] backend logged NO schema mismatch",
              "SCHEMA MISMATCH" not in backend_log_text)
        if db_path.exists():
            db_path.unlink()
        log_file_path.unlink(missing_ok=True)


if __name__ == "__main__":
    run_modes_1_to_4()

    if "--stream" in sys.argv:
        run_stream_test()
    else:
        print("\n(Skipping --stream/backend test -- pass --stream to run it.)")

    n_fail = sum(1 for _, ok in results if not ok)
    print(f"\n{'=' * 70}")
    if n_fail == 0:
        print(f"ALL {len(results)} CHECKS PASSED")
    else:
        print(f"{n_fail} of {len(results)} CHECKS FAILED:")
        for label, ok in results:
            if not ok:
                print(f"  FAIL: {label}")
    print("=" * 70)
    sys.exit(0 if n_fail == 0 else 1)
