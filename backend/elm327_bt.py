# elm327_bt.py -- LUS Car Automation
# Connects to a Bluetooth ELM327 OBD-II adapter over a Windows virtual
# COM port, polls all 11 target PIDs once per second, decodes them using
# obd_decoder.py, and logs them via session_logger.py.
#
# ── First-time setup ────────────────────────────────────────────────────────
# 1. Pair the ELM327 in Windows Bluetooth settings (PIN is usually 1234 or 0000)
# 2. Open Device Manager > Ports (COM & LPT) -- note the "Outgoing" COM port
# 3. Set COM_PORT below to that port (e.g. "COM5")
# 4. If responses are garbled, try BAUD_RATE = 9600
#
# Run modes:
#   python elm327_bt.py --scan          : Probe every COM port for the ELM327 and report hits
#   python elm327_bt.py --test          : Prove adapter is alive, list COM ports, and quit
#   python elm327_bt.py                 : Synchronous capture session, logs to logs/
#   python elm327_bt.py --raw           : Print raw hex responses alongside decoded values
#   python elm327_bt.py --fast          : Faster polling ("01 0C 1" frame count suffix)
#   python elm327_bt.py --raw --fast    : Combine modifiers
#   python elm327_bt.py --stream        : Also forward telemetry to the backend over WebSocket
#
# Requires: pip install pyserial

import json
import sys
import threading
import time
from pathlib import Path
import serial
import serial.tools.list_ports

from obd_decoder import decode_pid, decode_atrv, pack_packet, unpack_packet, TARGET_PIDS, calculate_gear
from session_logger import SessionLogger

# ── Configuration ──────────────────────────────────────────────────────────────
COM_PORT        = "COM15"                     # Outgoing COM port (from Windows Bluetooth Settings)
BAUD_RATE       = 38400                      # Try 9600 if responses are garbled
READ_TIMEOUT    = 2.0                        # seconds to wait per PID response (Change 5)
POLL_INTERVAL   = 1.0                        # seconds between full polling cycles
BACKEND_WS_URL  = "wss://api.nalusa.space/ws" # WebSocket streaming URL (Change 8)
# Anchored to <repo root>/logs -- a relative "logs" resolves against the
# CWD, not the script, so running from the repo root vs. from backend/
# would silently split one car session's data across two directories.
LOG_DIR         = str(Path(__file__).resolve().parent.parent / "logs")
SCHEMA_VERSION  = "2.0.0"

# Target PIDs to poll each cycle -- imported from obd_decoder.py, the source
# of truth for the wire format. Eleven PIDs now, up from eight.
PID_NAMES = {
    0x0C: "rpm", 0x0D: "speed_kmh", 0x05: "coolant_c",
    0x04: "engine_load_pct", 0x11: "throttle_pct",
    0x2F: "fuel_level_pct", 0x10: "maf_gps", 0x0F: "intake_temp_c",
    0x46: "ambient_temp_c", 0x0B: "map_kpa", 0x01: "mil_dtc",
}

# AT commands to send on connect.
AT_INIT_SEQUENCE = [
    (b"ATZ\r",    False),   # reset -- always required
    (b"ATE0\r",   False),   # echo off -- required for clean parsing
    (b"ATL0\r",   False),   # linefeeds off -- cleaner responses
    (b"ATSP0\r",  False),   # auto-detect OBD protocol (CAN/KWP etc.)
    (b"ATH0\r",   True),    # hide CAN headers -- fake chips may reject this
]

# ── Serial helpers ─────────────────────────────────────────────────────────────

def open_port(max_attempts: int = None) -> "serial.Serial | None":
    """
    Open the Bluetooth COM port.

    max_attempts=None (default): retry forever. Correct for run_capture --
    the car may not be powered on yet, so there is no "give up" point.

    max_attempts=N: give up and return None after N failed attempts.
    Used by run_test_mode, which is a diagnostic and should give an answer
    instead of sitting in an infinite retry loop under a dashboard.
    """
    attempt = 0
    while True:
        attempt += 1
        try:
            ser = serial.Serial(
                COM_PORT,
                baudrate=BAUD_RATE,
                timeout=READ_TIMEOUT,
                write_timeout=2,
            )
            print(f"[BT] Opened {COM_PORT} at {BAUD_RATE} baud.")
            return ser
        except serial.SerialException as e:
            print(f"[BT] Cannot open {COM_PORT}: {e}")
            if max_attempts is not None and attempt >= max_attempts:
                return None
            print(f"[BT] Retrying in 3s... (check Bluetooth pairing and Device Manager)")
            time.sleep(3)


def read_until_prompt(ser: serial.Serial, timeout: float = READ_TIMEOUT) -> str:
    """
    Read bytes from the serial port until we see the ELM327 '>' prompt,
    which signals the adapter is ready for the next command.
    """
    buf = b""
    deadline = time.time() + timeout
    while time.time() < deadline:
        chunk = ser.read(ser.in_waiting or 1)
        if chunk:
            buf += chunk
            if b">" in buf:
                break
    response = buf.decode("ascii", errors="ignore")
    response = response.replace(">", "").strip()
    return response


def send_at(ser: serial.Serial, cmd: bytes, skip_if_unknown: bool = False) -> str:
    """Send an AT command and return the response string."""
    try:
        ser.reset_input_buffer()
        ser.write(cmd)
    except (serial.SerialTimeoutException, serial.SerialException) as e:
        cmd_str = cmd.decode().strip()
        print(f"[BT] ERROR: Write failed for {cmd_str} ({e}) -- check if ELM327 is powered and connected.")
        return ""

    response = read_until_prompt(ser)
    cmd_str = cmd.decode().strip()

    if "?" in response:
        if skip_if_unknown:
            print(f"[BT] WARN: {cmd_str} returned '?' (fake chip) -- skipping.")
        else:
            print(f"[BT] ERROR: {cmd_str} returned '?' -- adapter may be incompatible.")
    elif "OK" in response or "ELM" in response:
        print(f"[BT] {cmd_str} -> OK")
    else:
        print(f"[BT] {cmd_str} -> {response!r}")

    return response


def initialise_elm327(ser: serial.Serial) -> bool:
    """
    Send the AT init sequence to the ELM327 with warm-up (Change 4).
    Returns True if essential commands succeeded, False if adapter is unusable.
    """
    print("[BT] Initialising ELM327...")
    time.sleep(1.5)   # Change 4: Bluetooth warm-up pause (raise from 0.5s to 1.5s)

    # Change 4: Send throwaway ATZ to clean dirty initial BT link
    try:
        ser.reset_input_buffer()
        ser.write(b"ATZ\r")
        time.sleep(1.0)
        ser.reset_input_buffer()
    except Exception:
        pass

    for cmd, skip_if_unknown in AT_INIT_SEQUENCE:
        resp = send_at(ser, cmd, skip_if_unknown=skip_if_unknown)
        # If write failed or timed out completely on essential commands, abort
        if not resp and not skip_if_unknown:
            print(f"[BT] Init failed (no response/timeout on {cmd.decode().strip()}) -- check if adapter is powered.")
            return False
        if cmd == b"ATZ\r":
            time.sleep(1.5)   # chip needs time to reset
            continue
        if "?" in resp and not skip_if_unknown:
            print(f"[BT] Init failed on {cmd.decode().strip()} -- aborting.")
            return False

    print("[BT] ELM327 initialised successfully.")
    return True


def query_pid(ser: serial.Serial, pid: int, fast: bool = False, is_first: bool = False) -> str:
    """
    Send a Mode 01 PID request and return the cleaned OBD response string.
    Implements Change 2 (SEARCHING prefix recovery) and Change 5/6 (timeout & fast mode).
    """
    try:
        ser.reset_input_buffer()
        # Change 6: Optional faster polling suffix ("1")
        cmd_str = f"01 {pid:02X} 1\r" if fast else f"01 {pid:02X}\r"
        ser.write(cmd_str.encode())
    except (serial.SerialTimeoutException, serial.SerialException) as e:
        print(f"[BT] ERROR: Write failed for PID {hex(pid)} ({e}) -- check BT link.")
        return f"7F 01 {pid:02X}"

    # Change 5: 5s timeout on very first request (where SEARCHING occurs), 2s otherwise
    timeout = 5.0 if is_first else READ_TIMEOUT
    response = read_until_prompt(ser, timeout=timeout).strip().upper()

    if not response:
        return f"7F 01 {pid:02X}"

    # Change 2: Recover data after SEARCHING... prefix and verify requested PID
    response = " ".join(response.split())
    idx = response.find("41 ")
    if idx == -1:
        return f"7F 01 {pid:02X}"   # no usable Mode 01 data -> null

    response = response[idx:]
    tokens = response.split()
    if len(tokens) < 2 or tokens[1] != f"{pid:02X}":
        return f"7F 01 {pid:02X}"   # echoed PID mismatch -> null

    return response


# ── Mode 0: Port Scan ──────────────────────────────────────────────────────────

def run_scan():
    """
    Walk every available COM port and find the one the ELM327 answers on.
    This machine has twelve identical "Standard Serial over Bluetooth link"
    ports -- there is no way to tell them apart except by asking each one.
    Does not stop at the first hit: a stale pairing can still answer ATZ.
    """
    print("=" * 55)
    print("  ELM327 Bluetooth -- PORT SCAN (--scan)")
    print("=" * 55)

    log = SessionLogger(LOG_DIR)
    print(f"[LOG] Session logs -> {LOG_DIR}")
    print(f"[LOG] Scan session {log.session_id}")

    ports = list(serial.tools.list_ports.comports())
    if not ports:
        print("[SCAN] No COM ports found on this machine.")
        log.close()
        return

    print(f"[SCAN] {len(ports)} COM port(s) found. Probing each with ATZ...\n")
    hits = []

    for p in ports:
        print(f"[SCAN] {p.device} ({p.description}) ... ", end="", flush=True)

        try:
            ser = serial.Serial(p.device, baudrate=BAUD_RATE, timeout=1.5, write_timeout=1.5)
        except Exception as e:
            print(f"open failed ({e})")
            log.log_test("scan", "ATZ", str(e), "open_failed")
            continue

        try:
            ser.reset_input_buffer()
            ser.write(b"ATZ\r")
            resp = read_until_prompt(ser, timeout=2.0)
        except Exception as e:
            print(f"probe failed ({e})")
            log.log_test("scan", "ATZ", str(e), "open_failed")
            resp = None
        finally:
            try:
                ser.close()
            except Exception:
                pass

        if resp is None:
            continue

        if "ELM" in resp.upper() or "OK" in resp.upper():
            print(f"HIT -> {resp!r}")
            hits.append((p.device, resp))
            log.log_test("scan", "ATZ", resp, "hit")
        else:
            print(f"no response ({resp!r})")
            log.log_test("scan", "ATZ", resp or "-", "no_response")

    print("\n" + "-" * 55)
    if hits:
        print(f"[SCAN] {len(hits)} hit(s) found:")
        for device, resp in hits:
            print(f"  {device} -> {resp!r}")
        print(f"[SCAN] Set COM_PORT = \"{hits[0][0]}\" in elm327_bt.py"
              + (" (or try each hit if more than one)." if len(hits) > 1 else "."))
    else:
        print("[SCAN] No hits. Is the ELM327 powered (12V from the car's OBD port) and paired?")
    print("-" * 55)

    log.close()


# ── Mode 1: Test Mode (Change 7) ───────────────────────────────────────────────

def run_test_mode():
    """Prove adapter is alive, list available COM ports, and exit cleanly."""
    print("=" * 55)
    print("  ELM327 Bluetooth -- TEST MODE (--test)")
    print("=" * 55)

    log = SessionLogger(LOG_DIR)
    print(f"[LOG] Session logs -> {LOG_DIR}")
    print(f"[LOG] Test session {log.session_id}")

    ports = list(serial.tools.list_ports.comports())
    port_list = "; ".join(f"{p.device}: {p.description}" for p in ports) or "none found"
    print("[BT] Available COM Ports on system:")
    if not ports:
        print("     None found!")
    for p in ports:
        print(f"     {p.device}: {p.description}")
    log.log_test("list_ports", "-", port_list, "info")
    print("-" * 55)

    print(f"[BT] Opening configured port ({COM_PORT})...")
    ser = open_port(max_attempts=3)
    if ser is None:
        print(f"[BT] Could not open {COM_PORT} after 3 attempts.")
        print("[BT] The adapter is dead until it gets 12V from the car's OBD port — this is expected at a desk.")
        print("[BT] If the adapter IS powered and this still fails, the port is probably wrong.")
        print(f"[BT] There are {len(ports)} Bluetooth COM ports on this machine. Run: python elm327_bt.py --scan")
        log.log_test("open_port", COM_PORT, "-", "open_failed")
        log.close()
        return

    try:
        ok = initialise_elm327(ser)
        log.log_test("at_init", "ATZ/ATE0/ATL0/ATSP0/ATH0", "-", "pass" if ok else "fail")
        if not ok:
            print("[BT] Test failed during AT initialization.")
            return

        for step, cmd, timeout in [
            ("supported_pids", b"01 00\r", 5.0),
            ("rpm",            b"01 0C\r", 2.0),
            ("battery",        b"ATRV\r",  2.0),
        ]:
            ser.reset_input_buffer()
            ser.write(cmd)
            resp = read_until_prompt(ser, timeout=timeout)
            print(f"     {cmd.decode().strip()} -> {resp!r}")
            log.log_test(step, cmd.decode().strip(), resp,
                         "pass" if resp else "no_response")

        print("\n[BT] Test check complete. Adapter is alive and responsive.")
    except (serial.SerialTimeoutException, serial.SerialException) as e:
        print(f"\n[BT] ERROR during test write ({e}).")
        print("     Ensure the ELM327 is plugged into a 12V OBD port / car and paired.")
    finally:
        ser.close()
        log.close()
        print("[BT] Port closed cleanly.")


# ── Mode 2: Synchronous Capture Session (Changes 1, 8, & 9) ────────────────────

def run_capture(raw_mode: bool = False, fast_mode: bool = False, stream_mode: bool = False):
    """Synchronous capture loop decoupled from network dependency."""
    log = SessionLogger(LOG_DIR)
    print(f"[LOG] Session logs -> {LOG_DIR}")
    print(f"[LOG] Session {log.session_id} started.")

    seq = 0
    ws_client = None
    ws_connect = None
    if stream_mode:
        try:
            from websockets.sync.client import connect as ws_connect
            print(f"[WS] --stream enabled. Will stream best-effort to {BACKEND_WS_URL}")
        except ImportError:
            print("[WS] ERROR: 'websockets' package not installed (`pip install websockets`). Running offline.")
            log.log_stream("import_failed", "websockets package missing")
            stream_mode = False

    def drain_incoming():
        """
        The backend echoes every message back to the sender. Nothing here
        ever reads those echoes, so without draining, the socket receive
        buffer fills and the capture loop freezes mid-session -- roughly
        the length of a car test. Runs for the life of the process; a
        recv error must never kill the capture, only pause this thread briefly.
        """
        while True:
            if ws_client is None:
                time.sleep(0.5)
                continue
            try:
                ws_client.recv(timeout=0.5)
            except TimeoutError:
                continue
            except Exception:
                time.sleep(0.5)

    if stream_mode:
        threading.Thread(target=drain_incoming, daemon=True).start()

    try:
        while True:
            ser = open_port()
            ok = initialise_elm327(ser)
            if not ok:
                print("[BT] Re-init failed. Closing port and retrying in 5s...")
                ser.close()
                time.sleep(5)
                continue

            # Change 8 (B2c): probe the car's own statement of supported PIDs.
            # Required deliverable -- captured but never gates polling.
            ser.reset_input_buffer()
            ser.write(b"0100\r")
            resp_0100 = read_until_prompt(ser, timeout=5.0)
            print("[OBD] ===== SUPPORTED PIDS (0100) =====")
            print(f"[OBD] {resp_0100!r}")
            print("[OBD] ==================================")
            log.log_stream("supported_pids", resp_0100)

            print(f"[OBD] Starting synchronous capture loop (1 cycle per {POLL_INTERVAL}s)...")
            if raw_mode:
                print("[OBD] --raw modifier enabled: printing raw hex bytes")
            if fast_mode:
                print("[OBD] --fast modifier enabled: appending frame count suffix ('1')")
            if stream_mode:
                print("[OBD] --stream modifier enabled: live WebSocket forwarding active")

            first_cycle = True
            try:
                while True:
                    cycle_start = time.time()
                    ts_ms = int(time.time() * 1000)

                    decoded = {}
                    for i, pid in enumerate(TARGET_PIDS):
                        # Give 5s grace only on the very first PID request of a fresh session
                        is_first = (first_cycle and i == 0)
                        request = f"01{pid:02X}"
                        raw_hex = query_pid(ser, pid, fast=fast_mode, is_first=is_first)
                        value = decode_pid(raw_hex)
                        decoded[pid] = value

                        if raw_mode:
                            print(f"[RAW] {request} -> {raw_hex}")
                            log.log_raw(pid, request, raw_hex, value)

                    first_cycle = False

                    # Real battery reading via ATRV -- works even with no ECU present.
                    ser.reset_input_buffer()
                    ser.write(b"ATRV\r")
                    battery_v = decode_atrv(read_until_prompt(ser, timeout=2.0))

                    # Print live terminal readout
                    print(
                        f"[OBD] RPM={decoded.get(0x0C)} "
                        f"spd={decoded.get(0x0D)}km/h "
                        f"cool={decoded.get(0x05)}C "
                        f"fuel={decoded.get(0x2F)}% "
                        f"maf={decoded.get(0x10)} "
                        f"batt={battery_v}V"
                    )

                    estimated_gear = calculate_gear(
                        decoded.get(0x0C) or 0,
                        decoded.get(0x0D) or 0
                    )

                    seq = (seq + 1) & 0xFF
                    gps = {"lat": None, "lng": None, "sats": 0, "fix": False}   # until GPS is wired
                    extras = {
                        "battery_v": battery_v,
                        "gear": estimated_gear,
                        "seq": seq,
                        "can": {"brake": None, "clutch": None, "ac": None},   # not found yet
                        "health": {"power_ok": True, "gps_ok": gps["fix"], "can_ok": False},
                    }

                    # Pack/unpack roundtrip verification per standard --
                    # validates the CRC against real car data before the ESP32 stage needs it.
                    raw_bytes  = pack_packet(decoded, gps, extras)
                    packet_hex = raw_bytes.hex(' ').upper()
                    unpacked   = unpack_packet(raw_bytes)
                    if not unpacked["crc_valid"]:
                        print("[PACKET] WARNING: round-trip CRC check failed!")
                    print(f"[PACKET] {packet_hex}")

                    # Durable log -- always runs regardless of network
                    log.log_decoded(decoded, PID_NAMES, packet_hex=packet_hex)

                    # Change 8: Best-effort WebSocket streaming (decoupled from serial capture)
                    if stream_mode and ws_connect is not None:
                        telemetry_packet = {
                            "type":           "telemetry",
                            "schema_version": SCHEMA_VERSION,
                            "ts":             ts_ms,
                            "vehicle":        unpacked["vehicle"],
                            "tyres": {
                                "fl": {"pressure_kpa": None, "temp_c": None},
                                "fr": {"pressure_kpa": None, "temp_c": None},
                                "rl": {"pressure_kpa": None, "temp_c": None},
                                "rr": {"pressure_kpa": None, "temp_c": None},
                            },
                            "gps":            unpacked["gps"],
                            "device":         unpacked["device"],
                        }
                        # Reconnect if socket is closed or not yet opened
                        if ws_client is None:
                            try:
                                ws_client = ws_connect(BACKEND_WS_URL, open_timeout=1.5, close_timeout=1.0)
                                print(f"[WS] Connected to {BACKEND_WS_URL}")
                                log.log_stream("connected", BACKEND_WS_URL)
                            except Exception as e:
                                print(f"[WS] Connect warning ({e}) -- continuing offline capture.")
                                log.log_stream("connect_failed", str(e))
                                ws_client = None

                        if ws_client is not None:
                            try:
                                ws_client.send(json.dumps(telemetry_packet))
                                log.log_stream("sent", f"rpm={decoded.get(0x0C)}")
                            except Exception as e:
                                print(f"[WS] Send failed ({e}) -- connection dropped. Continuing capture.")
                                log.log_stream("send_failed", str(e))
                                try:
                                    ws_client.close()
                                except Exception:
                                    pass
                                ws_client = None

                    elapsed = time.time() - cycle_start
                    sleep_for = max(0, POLL_INTERVAL - elapsed)
                    time.sleep(sleep_for)

            except serial.SerialException as e:
                print(f"[BT] Connection lost: {e}")
                print("[BT] Waiting 3s then reconnecting...")
                try:
                    ser.close()
                except Exception:
                    pass
                time.sleep(3)
    finally:
        # Close WebSocket cleanly on exit (log the close event before log.close(),
        # or the write would reopen the file)
        if stream_mode and ws_client is not None:
            try:
                ws_client.close()
                log.log_stream("closed", "clean shutdown")
                print("[WS] WebSocket connection closed.")
            except Exception:
                pass
        log.close()


if __name__ == "__main__":
    scan_mode   = "--scan" in sys.argv
    test_mode   = "--test" in sys.argv
    raw_mode    = "--raw" in sys.argv
    fast_mode   = "--fast" in sys.argv
    stream_mode = "--stream" in sys.argv

    if scan_mode:
        run_scan()
    elif test_mode:
        run_test_mode()
    else:
        print("=" * 55)
        print("  ELM327 Bluetooth OBD-II Acquisition Script")
        print(f"  COM Port : {COM_PORT}  |  Baud: {BAUD_RATE}")
        print(f"  Log Dir  : {LOG_DIR}")
        print(f"  Backend  : {BACKEND_WS_URL if stream_mode else 'DISABLED (offline mode)'}")
        print(f"  Modes    : stream={stream_mode}, raw={raw_mode}, fast={fast_mode}")
        print("=" * 55)
        try:
            run_capture(raw_mode=raw_mode, fast_mode=fast_mode, stream_mode=stream_mode)
        except KeyboardInterrupt:
            print("\n[OBD] Stopped by user.")
