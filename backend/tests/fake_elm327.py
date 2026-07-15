# backend/tests/fake_elm327.py
# A fake serial.Serial replacement that quacks exactly like the real
# ELM327-over-Bluetooth link, from elm327_bt.py's point of view.
#
# elm327_bt.py only ever calls four things on a serial.Serial instance
# (verified by reading the source, not guessed):
#   ser.write(data)                   -- send_at(), query_pid(), run_capture()
#   ser.read(ser.in_waiting or 1)     -- read_until_prompt()
#   ser.reset_input_buffer()          -- before every write
#   ser.close()                       -- at shutdown
# This fake implements exactly that surface and nothing more.
#
# All response strings are REAL captures from our Maruti Suzuki Fronx,
# 10 July session -- not invented values. See dry_run.py for how this
# is wired into the real, unmodified elm327_bt.py.


class DryRunStop(Exception):
    """
    Raised by the fake device to end a dry run after N complete poll cycles.
    Deliberately NOT a serial.SerialException/SerialTimeoutException, so
    elm327_bt.py's reconnect-and-retry logic does not catch it -- it
    propagates straight out of run_capture(), the same as an operator
    pulling the plug at a clean cycle boundary.
    """


# Real ELM327 replies captured 10 July from the Fronx. Keys are the
# command with ALL whitespace stripped and upper-cased, e.g. "01 0C" -> "010C".
RESPONSES = {
    "ATZ":   "ELM327 v1.5\r\r>",
    "ATE0":  "OK\r\r>",
    "ATL0":  "OK\r\r>",
    "ATSP0": "OK\r\r>",
    "ATH0":  "?\r\r>",              # clone chip rejects it -- must be skipped, not fatal
    "ATRV":  "12.4V\r\r>",
    "0100":  "41 00 BE 3E B8 11\r\r>",
    "010C":  "41 0C 20 B2\r\r>",     # 2092.5 RPM
    "010D":  "41 0D 00\r\r>",        # stationary
    "0105":  "41 05 82\r\r>",        # 90 C
    "0104":  "41 04 3D\r\r>",
    "0111":  "41 11 2E\r\r>",
    "012F":  "7F 01 2F\r\r>",        # Fronx genuinely does NOT support fuel
    "0110":  "41 10 02 0C\r\r>",
    "010F":  "41 0F 6A\r\r>",
    "0146":  "7F 01 46\r\r>",
    "010B":  "7F 01 0B\r\r>",
    "0101":  "41 01 83\r\r>",        # MIL on, 3 DTCs
}


class FakeELM327:
    """
    Drop-in stand-in for serial.Serial. One instance = one "session" (one
    open_port() call) -- that is the scope the SEARCHING... prefix and the
    cycle-based stop condition both apply to, matching how a real ELM327's
    protocol auto-detect only fires once per connection.
    """

    # Set by the test driver before each run: how many full poll cycles
    # (each starting with a "01 0C" RPM request -- TARGET_PIDS[0], always
    # first) to allow before hanging up. None = never stop.
    STOP_AFTER_CYCLES = None

    # Every constructed instance, in order -- lets the driver inspect the
    # session that just ran (probe counts, exact commands sent) after the
    # dry run completes.
    instances = []

    def __init__(self, port=None, baudrate=None, timeout=None, write_timeout=None, *args, **kwargs):
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout
        self.write_timeout = write_timeout
        self._rx = bytearray()
        self._rpm_first_seen = False   # SEARCHING... fires once per session
        self._cycle_count = 0
        self.commands_seen = []        # every command exactly as elm327_bt sent it
        self.probe_0100_count = 0
        FakeELM327.instances.append(self)

    # -- the exact surface elm327_bt.py calls --------------------------------

    @property
    def in_waiting(self):
        return len(self._rx)

    def reset_input_buffer(self):
        self._rx.clear()

    def write(self, data: bytes) -> int:
        raw_cmd = data.decode("ascii", errors="ignore").strip()
        self.commands_seen.append(raw_cmd)

        compact = raw_cmd.replace(" ", "").replace("\r", "").upper()
        # "01 0C 1" (--fast frame-count suffix) -> base key "010C". Every
        # real command is "01" + 2 hex digits, optionally + one more digit,
        # so a compact form longer than 4 chars whose first 4 chars match a
        # known key is that key with the suffix appended.
        if len(compact) > 4 and compact[:4] in RESPONSES:
            key = compact[:4]
        else:
            key = compact

        if key == "0100":
            self.probe_0100_count += 1

        if key == "010C":
            self._cycle_count += 1
            if FakeELM327.STOP_AFTER_CYCLES is not None and self._cycle_count > FakeELM327.STOP_AFTER_CYCLES:
                raise DryRunStop(
                    f"fake device: hanging up after {FakeELM327.STOP_AFTER_CYCLES} complete cycles"
                )

        body = RESPONSES.get(key, "?\r\r>")

        if key == "010C" and not self._rpm_first_seen:
            self._rpm_first_seen = True
            # Real ELM327 behaviour: the very first OBD query of a session
            # triggers protocol auto-detect and prepends this before the
            # actual data arrives. query_pid()'s SEARCHING-recovery logic
            # has never been exercised against a real byte stream until
            # this harness -- this is the single most important line here.
            body = "SEARCHING...\r" + body

        self._rx += body.encode("ascii")
        return len(data)

    def read(self, size: int = 1) -> bytes:
        if size <= 0:
            return b""
        chunk = bytes(self._rx[:size])
        del self._rx[:size]
        return chunk

    def close(self):
        pass
