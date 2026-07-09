# elm327_bt.py -- LUS Car Automation
# Connects to a Bluetooth ELM327 OBD-II adapter over a Windows virtual
# COM port, polls all 8 target PIDs once per second, decodes them using
# obd_decoder.py, and:
#   1. Sends a telemetry JSON packet to the backend WebSocket
#   2. Appends decoded values to a local CSV file as a session backup
#
# ── First-time setup ────────────────────────────────────────────────────────
# 1. Pair the ELM327 in Windows Bluetooth settings (PIN is usually 1234 or 0000)
# 2. Open Device Manager > Ports (COM & LPT) -- note the "Outgoing" COM port
# 3. Set COM_PORT below to that port (e.g. "COM5")
# 4. If responses are garbled, try BAUD_RATE = 9600
#
# Run with:
#   python elm327_bt.py
#
# Requires: pip install pyserial websockets
#
# ── Known issues with cheap/fake ELM327 chips ───────────────────────────────
# Many Bluetooth ELM327 adapters use clone chips. This script handles:
#   - ATH0 returning "?" (unknown command) -- skipped silently
#   - Partial responses due to BT latency -- read until ">" prompt
#   - Connection drops -- auto-reconnect loop, never crashes

import asyncio
import csv
import json
import os
import time
import serial
import websockets

from obd_decoder import decode_pid, pack_packet, unpack_packet

# ── Configuration ──────────────────────────────────────────────────────────────
COM_PORT        = "COM5"                     # << Update after checking Device Manager
BAUD_RATE       = 38400                      # Try 9600 if responses are garbled
READ_TIMEOUT    = 5                          # seconds to wait per PID response
POLL_INTERVAL   = 1.0                        # seconds between full polling cycles
BACKEND_WS_URL  = "wss://api.nalusa.space/ws"
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
# Each entry is (command, skip_if_unknown).
# skip_if_unknown=True means if the chip returns "?" we warn and move on
# instead of aborting -- fake chip protection.
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


def read_until_prompt(ser: serial.Serial) -> str:
    """
    Read bytes from the serial port until we see the ELM327 '>' prompt,
    which signals the adapter is ready for the next command.

    Bluetooth adds latency so we can't rely on a single readline().
    We accumulate bytes until '>' appears or the timeout fires.
    """
    buf = b""
    deadline = time.time() + READ_TIMEOUT
    while time.time() < deadline:
        chunk = ser.read(ser.in_waiting or 1)
        if chunk:
            buf += chunk
            if b">" in buf:
                break
    response = buf.decode("ascii", errors="ignore")
    # Strip prompt, whitespace, and any echoed command text
    response = response.replace(">", "").strip()
    return response


def send_at(ser: serial.Serial, cmd: bytes, skip_if_unknown: bool = False) -> str:
    """Send an AT command and return the response string."""
    ser.reset_input_buffer()
    ser.write(cmd)
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
    Send the AT init sequence to the ELM327.
    Returns True if essential commands succeeded, False if adapter is unusable.
    """
    print("[BT] Initialising ELM327...")
    time.sleep(0.5)   # brief pause after port open before sending commands

    for cmd, skip_if_unknown in AT_INIT_SEQUENCE:
        resp = send_at(ser, cmd, skip_if_unknown=skip_if_unknown)
        # ATZ resets and responds with the chip version string, not "OK"
        if cmd == b"ATZ\r":
            time.sleep(1.5)   # chip needs time to reset
            continue
        # If a non-skippable command returns "?" the adapter is unusable
        if "?" in resp and not skip_if_unknown:
            print(f"[BT] Init failed on {cmd.decode().strip()} -- aborting.")
            return False

    print("[BT] ELM327 initialised successfully.")
    return True


def query_pid(ser: serial.Serial, pid: int) -> str:
    """
    Send a Mode 01 PID request and return the raw ELM327 response string.
    Returns a 7F negative string on timeout or error so the decoder
    returns null rather than crashing.
    """
    ser.reset_input_buffer()
    command = f"01 {pid:02X}\r".encode()
    ser.write(command)
    response = read_until_prompt(ser).strip()

    if not response:
        # Timeout -- treat as unsupported so decode_pid returns None
        print(f"[BT] TIMEOUT on PID {hex(pid)} -- treating as null")
        return f"7F 01 {pid:02X}"

    # Strip any stray whitespace or newline chars from BT buffer
    response = " ".join(response.upper().split())
    return response


# ── CSV logging ────────────────────────────────────────────────────────────────

def init_csv(path: str) -> csv.DictWriter:
    """Create or append to the session CSV log file."""
    file_exists = os.path.exists(path)
    f = open(path, "a", newline="")
    fieldnames = [
        "ts_ms", "rpm", "speed_kmh", "coolant_c", "engine_load_pct",
        "throttle_pct", "fuel_level_pct", "maf_gps", "intake_temp_c",
    ]
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    if not file_exists:
        writer.writeheader()
        print(f"[CSV] Created session log: {path}")
    else:
        print(f"[CSV] Appending to existing session log: {path}")
    return writer


def log_csv(writer: csv.DictWriter, ts_ms: int, decoded: dict):
    """Write one decoded polling cycle to the CSV log."""
    row = {"ts_ms": ts_ms}
    for pid, name in PID_NAMES.items():
        row[name] = decoded.get(pid)   # None becomes empty cell
    writer.writerow(row)


# ── WebSocket sender ───────────────────────────────────────────────────────────

async def send_to_backend(ws, packet_json: dict):
    """Send one telemetry JSON packet to the backend WebSocket."""
    await ws.send(json.dumps(packet_json))


# ── Main polling loop ──────────────────────────────────────────────────────────

async def run():
    csv_writer = init_csv(CSV_LOG_PATH)

    print(f"[WS] Connecting to backend at {BACKEND_WS_URL} ...")
    async with websockets.connect(BACKEND_WS_URL, ping_interval=None) as ws:
        print("[WS] Connected to backend.")

        # Outer loop: handles Bluetooth disconnects and re-init
        while True:
            ser = open_port()
            ok = initialise_elm327(ser)
            if not ok:
                print("[BT] Re-init failed. Closing port and retrying in 5s...")
                ser.close()
                time.sleep(5)
                continue

            print(f"[OBD] Starting polling loop (1 cycle per {POLL_INTERVAL}s)...")

            # Inner loop: one full polling cycle per iteration
            try:
                while True:
                    cycle_start = time.time()
                    ts_ms = int(time.time() * 1000)

                    # Poll all 8 PIDs sequentially
                    decoded = {}
                    for pid in TARGET_PIDS:
                        raw_hex = query_pid(ser, pid)
                        decoded[pid] = decode_pid(raw_hex)

                    # Print live terminal readout
                    print(
                        f"[OBD] RPM={decoded.get(0x0C)} "
                        f"spd={decoded.get(0x0D)}km/h "
                        f"cool={decoded.get(0x05)}C "
                        f"fuel={decoded.get(0x2F)}% "
                        f"maf={decoded.get(0x10)}"
                    )

                    # Pack into 32-byte binary, then unpack to JSON dict
                    raw_bytes   = pack_packet(decoded, GPS_PLACEHOLDER)
                    vehicle_gps = unpack_packet(raw_bytes)

                    # Build the full telemetry JSON envelope
                    telemetry_packet = {
                        "type":           "telemetry",
                        "schema_version": SCHEMA_VERSION,
                        "ts":             ts_ms,
                        "vehicle":        vehicle_gps["vehicle"],
                        "tyres": {
                            # TPMS data not yet wired -- send null placeholders
                            "fl": None, "fr": None, "rl": None, "rr": None,
                        },
                        "gps": vehicle_gps["gps"],
                    }

                    # 1. Send to backend WebSocket
                    await send_to_backend(ws, telemetry_packet)

                    # 2. Append to local CSV backup
                    log_csv(csv_writer, ts_ms, decoded)

                    # Wait until next cycle window
                    elapsed = time.time() - cycle_start
                    sleep_for = max(0, POLL_INTERVAL - elapsed)
                    await asyncio.sleep(sleep_for)

            except serial.SerialException as e:
                print(f"[BT] Connection lost: {e}")
                print("[BT] Waiting 3s then reconnecting...")
                try:
                    ser.close()
                except Exception:
                    pass
                time.sleep(3)
                # Falls back to outer while loop to re-open port and re-init


if __name__ == "__main__":
    print("=" * 55)
    print("  ELM327 Bluetooth OBD-II Acquisition Script")
    print(f"  COM Port : {COM_PORT}  |  Baud: {BAUD_RATE}")
    print(f"  Backend  : {BACKEND_WS_URL}")
    print(f"  CSV Log  : {CSV_LOG_PATH}")
    print("=" * 55)
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        print("\n[OBD] Stopped by user.")
