# mock_obd.py — LUS Car Automation
# Simulates raw OBD-II hex responses from a car ECU via ELM327.
# Produces the exact hex strings a real ELM327 would return —
# e.g. "41 0C 0B 34" for RPM — so obd_decoder.py can be tested
# with realistic raw input before any hardware is in hand.
#
# Run with:
#   python mock_obd.py        ← prints 5 ticks of raw hex responses
#
# UNSUPPORTED_PIDS: PIDs in this list always return a 7F negative
# response, simulating a car model that doesn't expose those sensors
# (e.g. many Toyotas don't expose MAF on 0x10).
# Set to [] to simulate a car that supports all 8 target PIDs.
#
# This file generates raw hex ONLY. It never decodes — that is
# obd_decoder.py's job.

import random

# ── Configuration ──────────────────────────────────────────────────────────────

UNSUPPORTED_PIDS = [0x10]   # MAF unsupported by default (Toyota-like)
                             # Change to [] to simulate full PID support

# ── PID hex response generators ────────────────────────────────────────────────
# Each function picks a realistic random value, applies the REVERSE of
# the OBD decode formula to get raw ECU bytes, then formats the hex string.

def _rpm_response() -> str:
    """PID 0x0C — RPM. Range: idle (~800) to moderate (~5000)."""
    rpm = random.randint(800, 5000)
    raw = rpm * 4                          # decode is ((A*256)+B) / 4
    A = (raw >> 8) & 0xFF
    B = raw & 0xFF
    return f"41 0C {A:02X} {B:02X}"

def _speed_response() -> str:
    """PID 0x0D — Vehicle speed km/h. Range: 0–120."""
    speed = random.randint(0, 120)
    return f"41 0D {speed:02X}"

def _coolant_response() -> str:
    """PID 0x05 — Engine coolant temp. Range: 75–98 °C (warm engine)."""
    temp_c = random.randint(75, 98)
    A = temp_c + 40                        # decode is A - 40
    return f"41 05 {A:02X}"

def _load_response() -> str:
    """PID 0x04 — Calculated engine load. Range: 20–70 %."""
    pct = random.randint(20, 70)
    A = round(pct * 2.55)                  # decode is A / 2.55
    A = min(A, 255)
    return f"41 04 {A:02X}"

def _throttle_response() -> str:
    """PID 0x11 — Throttle position. Range: 10–60 %."""
    pct = random.randint(10, 60)
    A = round(pct * 2.55)
    A = min(A, 255)
    return f"41 11 {A:02X}"

def _fuel_response() -> str:
    """PID 0x2F — Fuel level. Range: 30–90 %."""
    pct = random.randint(30, 90)
    A = round(pct * 2.55)
    A = min(A, 255)
    return f"41 2F {A:02X}"

def _maf_response() -> str:
    """PID 0x10 — MAF air flow rate. Range: 5.0–20.0 g/s."""
    maf = round(random.uniform(5.0, 20.0), 2)
    raw = round(maf * 100)                 # decode is ((A*256)+B) / 100
    A = (raw >> 8) & 0xFF
    B = raw & 0xFF
    return f"41 10 {A:02X} {B:02X}"

def _intake_response() -> str:
    """PID 0x0F — Intake air temp. Range: 25–45 °C."""
    temp_c = random.randint(25, 45)
    A = temp_c + 40                        # decode is A - 40
    return f"41 0F {A:02X}"


# ── PID dispatch table ─────────────────────────────────────────────────────────

_PID_GENERATORS = {
    0x0C: _rpm_response,
    0x0D: _speed_response,
    0x05: _coolant_response,
    0x04: _load_response,
    0x11: _throttle_response,
    0x2F: _fuel_response,
    0x10: _maf_response,
    0x0F: _intake_response,
}

ALL_PIDS = list(_PID_GENERATORS.keys())


# ── Public interface ───────────────────────────────────────────────────────────

def get_response(pid: int) -> str:
    """
    Return the raw OBD-II hex response string for a single PID.
    If the PID is in UNSUPPORTED_PIDS, returns a 7F negative response.

    Example:
        get_response(0x0C) → "41 0C 0B 34"
        get_response(0x10) → "7F 01 10"   (if 0x10 is unsupported)
    """
    if pid in UNSUPPORTED_PIDS:
        return f"7F 01 {pid:02X}"
    generator = _PID_GENERATORS.get(pid)
    if generator is None:
        return f"7F 01 {pid:02X}"   # unknown PID also returns 7F
    return generator()


def get_all_responses() -> dict:
    """
    Return a dict of raw OBD-II hex responses for all 8 target PIDs.
    This simulates one full poll cycle from the ELM327.

    Returns:
        { 0x0C: "41 0C 0B 34", 0x0D: "41 0D 3C", 0x10: "7F 01 10", ... }
    """
    return {pid: get_response(pid) for pid in ALL_PIDS}


# ── Manual demo ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("mock_obd.py — raw ELM327 response simulator")
    print(f"Unsupported PIDs: {[hex(p) for p in UNSUPPORTED_PIDS] or 'none'}")
    print("=" * 55)

    PID_NAMES = {
        0x0C: "RPM",
        0x0D: "Speed",
        0x05: "Coolant",
        0x04: "Load",
        0x11: "Throttle",
        0x2F: "Fuel",
        0x10: "MAF",
        0x0F: "Intake Temp",
    }

    for tick in range(1, 6):
        print(f"\n--- Tick {tick} ---")
        responses = get_all_responses()
        for pid, raw in responses.items():
            name = PID_NAMES.get(pid, f"PID {hex(pid)}")
            print(f"  [{hex(pid)}] {name:<12} → {raw}")
