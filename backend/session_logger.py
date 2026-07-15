# session_logger.py -- LUS Car Automation
# Handles all session logging for the acquisition script.
#
# Layout produced:
#
#   logs/
#     2026-07-15/
#       decoded/  decoded_2026-07-15.csv    <- always written
#       raw/      raw_2026-07-15.csv        <- only with --raw
#       stream/   stream_2026-07-15.csv     <- only with --stream
#       test/     test_2026-07-15.csv       <- only with --test
#     2026-07-16/
#       ...
#
# Rules implemented:
#   - One folder per calendar day, one sub-folder per kind of data.
#   - Header written ONCE, only when a file is first created.
#   - Repeat runs on the same day APPEND to that day's file.
#   - Every row carries session_id + ts_iso + ts_ms so runs stay separable.
#   - Line-buffered and flushed after every row (survives a hard kill).
#   - Automatic midnight rollover: a session running past 00:00 starts
#     writing into the new day's file without restarting.

import csv
import os
from datetime import datetime
from pathlib import Path

# ── Column definitions per log kind ────────────────────────────────────────────
# Every kind starts with the same three tracking columns.

_TRACKING = ["session_id", "ts_iso", "ts_ms"]

FIELDS = {
    "decoded": _TRACKING + [
        "rpm", "speed_kmh", "coolant_c", "engine_load_pct",
        "throttle_pct", "fuel_level_pct", "maf_gps", "intake_temp_c",
        "ambient_temp_c", "map_kpa", "mil_on", "dtc_count",
        "packet_hex",
    ],
    "raw": _TRACKING + [
        "pid", "request", "response", "decoded_value", "status",
    ],
    "stream": _TRACKING + [
        "event", "detail",
    ],
    "test": _TRACKING + [
        "step", "command", "response", "result",
    ],
}


class SessionLogger:
    """
    Opens log files lazily, one per kind, under a date-based folder tree.
    Files are only created for the kinds actually used, so a plain run
    does not leave behind empty raw/ or stream/ files.
    """

    def __init__(self, base_dir: str = "logs"):
        self.base = Path(base_dir)
        self.started = datetime.now()
        # Session id: time of day the run started. Distinguishes multiple
        # runs that append to the same daily file.
        self.session_id = self.started.strftime("%H%M%S")
        # kind -> (date_str, file_handle, DictWriter)
        self._open = {}

    # ── internals ──────────────────────────────────────────────────────────

    def _writer(self, kind: str):
        """Return the DictWriter for `kind`, opening or rolling over as needed."""
        if kind not in FIELDS:
            raise ValueError(f"Unknown log kind: {kind}")

        today = datetime.now().strftime("%Y-%m-%d")

        # Already open and still the same day -> reuse
        if kind in self._open:
            day, fh, writer = self._open[kind]
            if day == today:
                return fh, writer
            # Day changed mid-session: close and fall through to reopen
            fh.close()
            print(f"[LOG] Date rolled over. Starting new {kind} file for {today}.")

        path = self.base / today / kind / f"{kind}_{today}.csv"
        path.parent.mkdir(parents=True, exist_ok=True)

        is_new = not path.exists() or path.stat().st_size == 0
        fh = open(path, "a", newline="", encoding="utf-8", buffering=1)
        writer = csv.DictWriter(fh, fieldnames=FIELDS[kind], extrasaction="raise")

        if is_new:
            writer.writeheader()
            fh.flush()
            print(f"[LOG] Created {path}")
        else:
            print(f"[LOG] Appending to {path}")

        self._open[kind] = (today, fh, writer)
        return fh, writer

    def _stamp(self) -> dict:
        now = datetime.now()
        return {
            "session_id": self.session_id,
            "ts_iso": now.isoformat(timespec="milliseconds"),
            "ts_ms": int(now.timestamp() * 1000),
        }

    def _write(self, kind: str, row: dict):
        fh, writer = self._writer(kind)
        full = self._stamp()
        full.update(row)
        writer.writerow(full)
        fh.flush()   # survive a hard kill / power loss

    # ── public API ─────────────────────────────────────────────────────────

    def log_decoded(self, decoded: dict, pid_names: dict, packet_hex: str = ""):
        """One row per polling cycle. Always written."""
        row = {}
        for pid, name in pid_names.items():
            val = decoded.get(pid)
            if name == "mil_dtc":
                # PID 0x01 decodes to a (mil_on, dtc_count) tuple, or None
                row["mil_on"], row["dtc_count"] = (None, None) if val is None else val
            else:
                row[name] = val
        row["packet_hex"] = packet_hex
        self._write("decoded", row)

    def log_raw(self, pid: int, request: str, response: str, decoded_value=None):
        """One row per PID request. Only with --raw."""
        if response.startswith("7F"):
            status = "unsupported"
        elif decoded_value is None:
            status = "no_data"
        else:
            status = "ok"
        self._write("raw", {
            "pid": f"0x{pid:02X}",
            "request": request,
            "response": response,
            "decoded_value": decoded_value,
            "status": status,
        })

    def log_stream(self, event: str, detail: str = ""):
        """WebSocket events. Only with --stream."""
        self._write("stream", {"event": event, "detail": detail})

    def log_test(self, step: str, command: str, response: str, result: str):
        """One row per test step. Only with --test."""
        self._write("test", {
            "step": step,
            "command": command,
            "response": response,
            "result": result,
        })

    def close(self):
        """Close every open file cleanly."""
        for kind, (day, fh, _w) in self._open.items():
            try:
                fh.close()
                print(f"[LOG] Closed {kind} log.")
            except Exception:
                pass
        self._open.clear()
