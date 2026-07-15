# Wiring session_logger.py into elm327_bt.py

Drop `session_logger.py` next to `elm327_bt.py`. Then make these six edits.

---

## 1. Imports and config

**Remove** the old CSV constant and add the logger import.

```python
# DELETE:
CSV_LOG_PATH = "obd_session.csv"

# ADD near the other imports:
from session_logger import SessionLogger

# ADD to config:
LOG_DIR = "logs"        # base folder for all session logs
```

`import csv` and `import os` can go from `elm327_bt.py` if nothing else uses them.

---

## 2. Delete the old CSV functions entirely

Remove both `init_csv()` and `log_csv()`. The logger replaces them.

---

## 3. `run_capture()` — replace CSV setup with the logger

```python
def run_capture(raw_mode=False, fast_mode=False, stream_mode=False):
    log = SessionLogger(LOG_DIR)
    print(f"[LOG] Session {log.session_id} started.")

    ws_client = None
    ws_connect = None
    if stream_mode:
        try:
            from websockets.sync.client import connect as ws_connect
            print(f"[WS] --stream enabled. Best-effort to {BACKEND_WS_URL}")
        except ImportError:
            print("[WS] ERROR: websockets not installed. Running without stream.")
            log.log_stream("import_failed", "websockets package missing")
            stream_mode = False
    ...
```

---

## 4. Inside the poll loop — log raw per PID

```python
decoded = {}
for i, pid in enumerate(TARGET_PIDS):
    is_first = (first_cycle and i == 0)
    request  = f"01{pid:02X}"
    raw_hex  = query_pid(ser, pid, fast=fast_mode, is_first=is_first)
    value    = decode_pid(raw_hex)
    decoded[pid] = value

    if raw_mode:
        print(f"[RAW] {request} -> {raw_hex}")
        log.log_raw(pid, request, raw_hex, value)   # <-- only logged with --raw
```

---

## 5. After packing — log the decoded row

```python
raw_bytes = pack_packet(decoded, GPS_PLACEHOLDER)
packet_hex = raw_bytes.hex(' ').upper()
print(f"[PACKET] {packet_hex}")
vehicle_gps = unpack_packet(raw_bytes)

# Replaces log_csv(...)
log.log_decoded(decoded, PID_NAMES, packet_hex=packet_hex)
```

---

## 6. Stream events — log connect / send / failure

```python
if stream_mode and ws_connect is not None:
    telemetry_packet = { ... }

    if ws_client is None:
        try:
            ws_client = ws_connect(BACKEND_WS_URL, open_timeout=1.5, close_timeout=1.0)
            print(f"[WS] Connected to {BACKEND_WS_URL}")
            log.log_stream("connected", BACKEND_WS_URL)
        except Exception as e:
            print(f"[WS] Connect warning ({e}) -- continuing offline.")
            log.log_stream("connect_failed", str(e))
            ws_client = None

    if ws_client is not None:
        try:
            ws_client.send(json.dumps(telemetry_packet))
            log.log_stream("sent", f"rpm={decoded.get(0x0C)}")
        except Exception as e:
            print(f"[WS] Send failed ({e}). Continuing capture.")
            log.log_stream("send_failed", str(e))
            try:
                ws_client.close()
            except Exception:
                pass
            ws_client = None
```

---

## 7. The `finally` block — close the logger

```python
finally:
    log.close()
    if stream_mode and ws_client is not None:
        try:
            ws_client.close()
            log.log_stream("closed", "clean shutdown")
        except Exception:
            pass
```

Careful: `log.close()` must come **after** any final `log_stream` call, or the write reopens the file. Simplest is to log the close event first, then `log.close()` last.

---

## 8. `run_test_mode()` — log each step

```python
def run_test_mode():
    log = SessionLogger(LOG_DIR)
    print(f"[LOG] Test session {log.session_id}")

    ports = list(serial.tools.list_ports.comports())
    port_list = "; ".join(f"{p.device}: {p.description}" for p in ports) or "none found"
    log.log_test("list_ports", "-", port_list, "info")

    ser = open_port()
    try:
        ok = initialise_elm327(ser)
        log.log_test("at_init", "ATZ/ATE0/ATL0/ATSP0/ATH0", "-", "pass" if ok else "fail")
        if not ok:
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
    finally:
        ser.close()
        log.close()
```

Note this adds `ATRV`, which gives real battery voltage and works with no ECU present.

---

## What you get

```
logs/
  2026-07-15/
    decoded/  decoded_2026-07-15.csv
    raw/      raw_2026-07-15.csv
    stream/   stream_2026-07-15.csv
    test/     test_2026-07-15.csv
  2026-07-16/
    decoded/  decoded_2026-07-16.csv
    ...
```

- New day, new folder, automatically.
- Same day, repeat runs append. One header, never duplicated.
- `session_id` column separates runs within a day.
- `ts_iso` (human readable) and `ts_ms` (machine sortable) on every row.
- Files only created for the modes actually used. A plain run leaves no empty `raw/` folder.
- A session running past midnight rolls into the new day's file by itself.

## Filtering one run back out

```python
import pandas as pd
df = pd.read_csv("logs/2026-07-15/decoded/decoded_2026-07-15.csv")
run = df[df.session_id == 62741]        # note: reads as int
```

To keep `session_id` as text, `pd.read_csv(..., dtype={"session_id": str})`.
