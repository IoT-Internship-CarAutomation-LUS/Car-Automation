# database.py — LUS Car Automation Backend
# Handles all SQLite operations: setup, writes, and reads.

import sqlite3
import json
from config import DB_PATH


def get_connection():
    """Open a connection to the SQLite database."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row  # lets us access columns by name
    return conn


def init_db():
    """Create tables if they don't already exist. Called once on startup."""
    conn = get_connection()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS telemetry (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            ts      INTEGER,
            payload TEXT
        );
    """)
    conn.commit()
    conn.close()
    print("[DB] Tables ready.")


# ── Writes ────────────────────────────────────────────────────────────────────

def save_telemetry(ts: int, payload: dict):
    """Save a telemetry message to the database."""
    conn = get_connection()
    conn.execute(
        "INSERT INTO telemetry (ts, payload) VALUES (?, ?)",
        (ts, json.dumps(payload))
    )
    conn.commit()
    conn.close()


# ── Reads ─────────────────────────────────────────────────────────────────────

def get_latest_telemetry():
    """Return the most recent telemetry record as a dict, or None."""
    conn = get_connection()
    row = conn.execute(
        "SELECT payload FROM telemetry ORDER BY id DESC LIMIT 1"
    ).fetchone()
    conn.close()
    return json.loads(row["payload"]) if row else None


def get_telemetry_history(limit: int = 100):
    """Return the last N telemetry records, oldest first."""
    conn = get_connection()
    rows = conn.execute(
        "SELECT payload FROM telemetry ORDER BY id DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    # Reverse so oldest is first (better for graphing)
    return [json.loads(r["payload"]) for r in reversed(rows)]


def get_gps_track(limit: int = 200):
    """Return the last N GPS points as {lat, lng, ts} — feeds the map trail."""
    conn = get_connection()
    rows = conn.execute(
        "SELECT ts, payload FROM telemetry ORDER BY id DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()

    track = []
    for row in reversed(rows):
        try:
            data = json.loads(row["payload"])
            gps = data.get("gps", {})
            # Only include points where we have a valid GPS fix
            if gps and gps.get("fix") is True and gps.get("lat") is not None:
                track.append({
                    "lat": gps["lat"],
                    "lng": gps["lng"],
                    "ts":  row["ts"]
                })
        except (json.JSONDecodeError, KeyError):
            continue
    return track
