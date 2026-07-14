# elm327_bt.py -- LUS Car Automation
# Connects to a Bluetooth ELM327 OBD-II adapter over a Windows virtual
# COM port, polls all 8 target PIDs once per second, decodes them using
# obd_decoder.py, and logs them to a durable CSV session file.
#
# ── First-time setup ────────────────────────────────────────────────────────
# 1. Pair the ELM327 in Windows Bluetooth settings (PIN is usually 1234 or 0000)
# 2. Open Device Manager > Ports (COM & LPT) -- note the "Outgoing" COM port
# 3. Set COM_PORT below to that port (e.g. "COM5")
# 4. If responses are garbled, try BAUD_RATE = 9600
#
# Run modes:
#   python elm327_bt.py --test          : Prove adapter is alive, list COM ports, and quit
#   python elm327_bt.py                 : Synchronous capture session, logs to CSV
#   python elm327_bt.py --raw           : Print raw hex responses alongside decoded values
#   python elm327_bt.py --fast          : Faster polling ("01 0C 1" frame count suffix)
#   python elm327_bt.py --raw --fast    : Combine modifiers
#
# Requires: pip install pyserial

import csv
import json
import os
import sys
import time
import serial
import serial.tools.list_ports

from obd_decoder import decode_pid, pack_packet, unpack_packet

# ── Configuration ──────────────────────────────────────────────────────────────
COM_PORT        = "COM15"                     # Outgoing COM port (from Windows Bluetooth Settings)
BAUD_RATE       = 38400                      # Try 9600 if responses are garbled
READ_TIMEOUT    = 2.0                        # seconds to wait per PID response (Change 5)
POLL_INTERVAL   = 1.0                        # seconds between full polling cycles
BACKEND_WS_URL  = "wss://api.nalusa.space/ws" # WebSocket streaming URL (Change 8)
CSV_LOG_PATH    = "obd_session.csv"          # local backup file, created in cwd
SCHEMA_VERSION  = "1.0.0"

# GPS placeholder -- replace with real GPS module values when available
GPS_PLACEHOLDER = {
    "lat":       0.0,
    "lng":       0.0,
    "speed_kmh": 0,
    "sats":      0,
}

# Target PIDs to poll each cycle (all 8 from Brief 4 / MESSAGE_SCHEMA.md)
TARGET_PIDS = [0x0C, 0x0D, 0x05, 0x04, 0x11, 0x2F, 0x10, 0x0F]

PID_NAMES = {
    0x0C: "rpm",
    0x0D: "speed_kmh",
    0x05: "coolant_c",
    0x04: "engine_load_pct",
    0x11: "throttle_pct",
    0x2F: "fuel_level_pct",
    0x10: "maf_gps",
    0x0F: "intake_temp_c",
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

def open_port() -> serial.Serial:
    """Open the Bluetooth COM port. Blocks until successful."""
    while True:
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


# ── CSV logging (Durable -- Change 3) ──────────────────────────────────────────

def init_csv(path: str):
    """Open session CSV with line buffering and flush after headers."""
    file_exists = os.path.exists(path)
    # Change 3: buffering=1 ensures line-buffered output in text mode
    f = open(path, "a", newline="", buffering=1)
    fieldnames = [
        "ts_ms", "rpm", "speed_kmh", "coolant_c", "engine_load_pct",
        "throttle_pct", "fuel_level_pct", "maf_gps", "intake_temp_c",
    ]
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    if not file_exists:
        writer.writeheader()
        f.flush()
        print(f"[CSV] Created session log: {path}")
    else:
        print(f"[CSV] Appending to existing session log: {path}")
    return f, writer


def log_csv(f, writer: csv.DictWriter, ts_ms: int, decoded: dict):
    """Write one decoded polling cycle and immediately flush to disk (Change 3)."""
    row = {"ts_ms": ts_ms}
    for pid, name in PID_NAMES.items():
        row[name] = decoded.get(pid)
    writer.writerow(row)
    f.flush()   # Change 3: flush after every row so data survives hard kill/power loss


# ── Mode 1: Test Mode (Change 7) ───────────────────────────────────────────────

def run_test_mode():
    """Prove adapter is alive, list available COM ports, and exit cleanly."""
    print("=" * 55)
    print("  ELM327 Bluetooth -- TEST MODE (--test)")
    print("=" * 55)
    
    ports = list(serial.tools.list_ports.comports())
    print("[BT] Available COM Ports on system:")
    if not ports:
        print("     None found!")
    for p in ports:
        print(f"     {p.device}: {p.description}")
    print("-" * 55)
    
    print(f"[BT] Opening configured port ({COM_PORT})...")
    ser = open_port()
    try:
        ok = initialise_elm327(ser)
        if not ok:
            print("[BT] Test failed during AT initialization.")
            return

        print("\n[BT] Sending test query 0100 (Supported PIDs)...")
        try:
            ser.reset_input_buffer()
            ser.write(b"01 00\r")
            resp_00 = read_until_prompt(ser, timeout=5.0)
            print(f"     Raw reply for 0100 -> {resp_00!r}")

            print("\n[BT] Sending test query 010C (RPM)...")
            ser.reset_input_buffer()
            ser.write(b"01 0C\r")
            resp_0c = read_until_prompt(ser, timeout=2.0)
            print(f"     Raw reply for 010C -> {resp_0c!r}")
            print("\n[BT] Test check complete. Adapter is alive and responsive.")
        except (serial.SerialTimeoutException, serial.SerialException) as e:
            print(f"\n[BT] ERROR during test write ({e}).")
            print("     Ensure the ELM327 is plugged into a 12V OBD port / car and paired.")
    finally:
        ser.close()
        print("[BT] Port closed cleanly.")


# ── Mode 2: Synchronous Capture Session (Changes 1, 8, & 9) ────────────────────

def run_capture(raw_mode: bool = False, fast_mode: bool = False, stream_mode: bool = False):
    """Synchronous capture loop decoupled from network dependency."""
    f_csv, csv_writer = init_csv(CSV_LOG_PATH)
    
    # Change 8: Only import websockets and set up client if --stream flag passed
    ws_client = None
    ws_connect = None
    if stream_mode:
        try:
            from websockets.sync.client import connect as ws_connect
            print(f"[WS] --stream enabled. Will stream best-effort to {BACKEND_WS_URL}")
        except ImportError:
            print("[WS] ERROR: 'websockets' package not installed (`pip install websockets`). Running CSV only.")
            stream_mode = False

    try:
        while True:
            ser = open_port()
            ok = initialise_elm327(ser)
            if not ok:
                print("[BT] Re-init failed. Closing port and retrying in 5s...")
                ser.close()
                time.sleep(5)
                continue

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
                        raw_hex = query_pid(ser, pid, fast=fast_mode, is_first=is_first)
                        
                        # Change 9: --raw demo view
                        if raw_mode:
                            print(f"[RAW] 01{pid:02X} -> {raw_hex}")
                        
                        decoded[pid] = decode_pid(raw_hex)

                    first_cycle = False

                    # Print live terminal readout
                    print(
                        f"[OBD] RPM={decoded.get(0x0C)} "
                        f"spd={decoded.get(0x0D)}km/h "
                        f"cool={decoded.get(0x05)}C "
                        f"fuel={decoded.get(0x2F)}% "
                        f"maf={decoded.get(0x10)}"
                    )

                    # Pack/Unpack roundtrip verification per standard
                    raw_bytes   = pack_packet(decoded, GPS_PLACEHOLDER)
                    print(f"[PACKET] {raw_bytes.hex(' ').upper()}")   # <-- add this
                    vehicle_gps = unpack_packet(raw_bytes)

                    # Write and flush to CSV (durable - always runs regardless of network)
                    log_csv(f_csv, csv_writer, ts_ms, decoded)

                    # Change 8: Best-effort WebSocket streaming (decoupled from serial capture)
                    if stream_mode and ws_connect is not None:
                        telemetry_packet = {
                            "type":           "telemetry",
                            "schema_version": SCHEMA_VERSION,
                            "ts":             ts_ms,
                            "vehicle":        vehicle_gps["vehicle"],
                            "tyres": {
                                "fl": None, "fr": None, "rl": None, "rr": None,
                            },
                            "gps":            vehicle_gps["gps"],
                        }
                        # Reconnect if socket is closed or not yet opened
                        if ws_client is None:
                            try:
                                ws_client = ws_connect(BACKEND_WS_URL, open_timeout=1.5, close_timeout=1.0)
                                print(f"[WS] Connected to {BACKEND_WS_URL}")
                            except Exception as e:
                                print(f"[WS] Connect warning ({e}) -- continuing offline CSV capture.")
                                ws_client = None

                        if ws_client is not None:
                            try:
                                ws_client.send(json.dumps(telemetry_packet))
                            except Exception as e:
                                print(f"[WS] Send failed ({e}) -- connection dropped. Continuing CSV capture.")
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
        # Change 3: Close CSV cleanly on exit or Ctrl+C
        try:
            f_csv.close()
            print("\n[CSV] Session log closed cleanly.")
        except Exception:
            pass
        # Change 8: Close WebSocket cleanly on exit
        if stream_mode and ws_client is not None:
            try:
                ws_client.close()
                print("[WS] WebSocket connection closed.")
            except Exception:
                pass


if __name__ == "__main__":
    test_mode   = "--test" in sys.argv
    raw_mode    = "--raw" in sys.argv
    fast_mode   = "--fast" in sys.argv
    stream_mode = "--stream" in sys.argv

    if test_mode:
        run_test_mode()
    else:
        print("=" * 55)
        print("  ELM327 Bluetooth OBD-II Acquisition Script")
        print(f"  COM Port : {COM_PORT}  |  Baud: {BAUD_RATE}")
        print(f"  CSV Log  : {CSV_LOG_PATH}")
        print(f"  Backend  : {BACKEND_WS_URL if stream_mode else 'DISABLED (offline mode)'}")
        print(f"  Modes    : stream={stream_mode}, raw={raw_mode}, fast={fast_mode}")
        print("=" * 55)
        try:
            run_capture(raw_mode=raw_mode, fast_mode=fast_mode, stream_mode=stream_mode)
        except KeyboardInterrupt:
            print("\n[OBD] Stopped by user.")
