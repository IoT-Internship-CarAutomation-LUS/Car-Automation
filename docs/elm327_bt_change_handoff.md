# elm327_bt.py: Change Handoff (Track 1 OBD Acquisition)

## Purpose of this document

This is a handoff for whoever edits `backend/elm327_bt.py`. It lists every change to make, why each one matters, and how to test the result. Read the whole thing once before touching the file. The changes are ordered by importance: items 1 to 3 must be done before any car session, 4 to 6 are tuning, 7 to 9 add the run modes, and 10 is parked for later.

## Context (so the changes make sense)

We are in Stage 1 of Track 1: read real OBD-II data from a car using a Bluetooth ELM327 adapter plugged into the car, over a Windows COM port, on a laptop. No ESP32 yet, and for the first session no backend either. The goal of Stage 1 is simply to prove we can talk to the car and decode the data correctly, with a CSV backup that survives no matter what.

There are two files:

`obd_decoder.py` is the translator. It turns raw hex responses into numbers, packs them into the 32-byte packet, and unpacks them back. It has no hardware code and it already works. Do not change it. The embedded ESP32 path later has to produce byte-identical output, so any edit here risks breaking that guarantee.

`elm327_bt.py` is the hardware driver. It opens the Bluetooth port, runs the AT init sequence, polls the eight PIDs once per second, decodes each with `obd_decoder.py`, and logs plus optionally streams the result. All the changes below are in this file.

## Hardware notes (things that trip people up)

The adapter is a Careflection ELM327 Mini, Bluetooth, clone chip. It has no power of its own: it draws 12V from the car's OBD port (pin 16). On a desk with nothing plugged in it is completely dead and will not even appear in Windows Bluetooth. So real testing needs a car, or a bench rig feeding 12V into the OBD connector.

Pair it in Windows Bluetooth settings first (PIN is usually 1234 or 0000). Windows then creates a COM port. Important: one Bluetooth adapter usually shows up as two COM ports (outgoing and incoming), and only the outgoing one carries a conversation. If the wrong one is set, the port opens but nothing ever answers. This is why change 7 prints the available ports.

## Target shape after the changes: four ways to run

After the changes, the script should support these:

1. `python elm327_bt.py --test` : prove the adapter is alive, then quit. A few seconds, no loop.
2. `python elm327_bt.py` : the real capture session. Loops once per second, decodes, writes CSV. No network. This is what the first car trip uses.
3. `python elm327_bt.py --stream` : same as the default, plus best-effort streaming to the backend WebSocket.
4. `--raw` : a modifier that can be added to any of the above. It prints the raw hex bytes from the adapter so we can show that the data is real.

The key structural idea: capture (serial read, decode, CSV) must always work on its own. The network is an optional layer on top, never a dependency.

## The changes

### Must fix before the car

**1. Capture must not depend on the network.**

Right now the entire polling loop lives inside `async with websockets.connect(...)`. If there is no internet in the car, or the WebSocket handshake fails, the script raises an error before reading a single PID, and no CSV is written either. That would waste a whole car session.

Fix: make the default run fully synchronous. A plain `while` loop, no `asyncio`, no `websockets` import in the default path. Serial read, decode, and CSV logging always run. WebSocket comes back only under the `--stream` flag (change 8), wrapped so that a network failure just prints a warning and capture continues.

**2. Recover data after SEARCHING, and reject real noise, in `query_pid`.**

After `ATSP0`, the first PID request makes the adapter auto-detect the car's protocol, so it replies with a prefix, for example `SEARCHING... 41 0C 0B 34`. The current code passes that whole string on, the decoder sees it does not start with `41`, and it throws away a perfectly good reading.

Fix: after cleaning whitespace, find the `41` token in the response and slice from there, so `SEARCHING... 41 0C 0B 34` becomes `41 0C 0B 34`. If there is no `41` anywhere (for example `NO DATA`, `UNABLE TO CONNECT`, `STOPPED`, `?`), return the null sentinel string `7F 01 XX` so the decoder returns `None` instead of crashing. Also confirm the byte right after `41` matches the PID that was requested; if it does not, treat it as null. That last check stops a leftover frame from the previous PID being misread as this one.

Illustrative shape (adjust to match the existing function):

```python
response = read_until_prompt(ser).strip().upper()
response = " ".join(response.split())          # collapse BT whitespace

idx = response.find("41 ")                      # find start of a valid reply
if idx == -1:
    return f"7F 01 {pid:02X}"                   # no usable data -> null
response = response[idx:]

tokens = response.split()
if len(tokens) < 2 or tokens[1] != f"{pid:02X}":
    return f"7F 01 {pid:02X}"                   # echoed PID mismatch -> null

return response
```

**3. Make the CSV durable.**

The CSV file is opened but nothing flushes it, so rows sit in a buffer. On a clean Ctrl+C they usually flush, but on a hard kill or the laptop losing power, which is exactly when a backup matters, the last rows are lost.

Fix: open the file line-buffered (`buffering=1` in text mode), flush after every `writerow`, and close it cleanly on exit including on `KeyboardInterrupt` (use a `try` and `finally`).

### Should fix (tuning, not correctness)

**4. Bluetooth warm-up.**

Raise the pause after opening the port from `0.5s` to about `1.5` to `2s`. Optionally send one throwaway `ATZ` and discard its reply before the real init. The first command on a fresh Bluetooth link often comes back dirty, which can make init spuriously fail on the first try.

**5. Per-PID timeout.**

Drop `READ_TIMEOUT` from `5s` to about `1` to `2s`, but keep one longer grace (say 5s) only on the very first `0100` request, which is the one that triggers the SEARCHING step. A running engine answers in milliseconds, so a 5s timeout only bites on unsupported PIDs, and eight of those in a row is a 40s frozen cycle.

**6. Optional faster polling.**

Append the expected frame count to each request, for example `01 0C 1` instead of `01 0C`. This tells the adapter to return after one frame instead of waiting out its own timeout for more ECUs, which speeds the loop up. It is occasionally flaky on clone chips, so try it, and keep it only if this adapter behaves.

### New run modes

**7. `--test` mode.**

Open the port, run the init, send `ATZ`, then `0100`, then `010C`, print the raw replies verbatim, then exit. No decode, no packing, no CSV, no WebSocket. At the start, also print the list of available COM ports using `serial.tools.list_ports`, so the right one can be identified (see the two-ports note above).

Expected passes:
On a bench with 12V but no car: `ATZ` returns a version string like `ELM327 v1.5`. That alone is a pass. `0100` returning `UNABLE TO CONNECT` is fine, it just means no ECU is present.
On a parked car with ignition on: version string, plus `0100` returns a real supported-PID list, plus `010C` returns a plausible reply.

**8. `--stream` flag.**

Adds the WebSocket back on top of the default CSV capture, as best effort. Wrap the connect and every send in `try` and `except` so a network failure just logs a warning and capture keeps going. Without this flag, the run is CSV only. Keep sending the same JSON envelope the current code builds (`type`, `schema_version`, `ts`, `vehicle`, `tyres` as null placeholders, `gps`).

**9. `--raw` flag (the demo view).**

Each cycle, print the raw hex response for every PID, for example `[RAW] 010C -> 41 0C 0B 34`. Make it a modifier that can combine with any mode, so `--raw` alone gives a clean raw-bytes view to screenshot as proof of the real adapter output, and it can also sit next to the normal decoded readout to show both side by side (raw bytes in, decoded number out).

### Later (not for the first trip)

**10. Real battery and DTC.**

Replace the packed placeholder battery voltage and DTC count with real reads (`ATRV` for battery voltage, a Mode 03 request for DTCs) once the basics work.

## How to test your work

1. Syntax: run `python -m py_compile elm327_bt.py`. It must pass with no output.
2. Import check: confirm `obd_decoder.py` is unchanged and still imports cleanly.
3. `--test` with the adapter powered (bench 12V or a car): confirm you get a version string. If on a car with ignition on, confirm `0100` returns a real reply.
4. Default run on a car: confirm the CSV file grows one row per second, values look plausible (coolant climbs as the engine warms, speed matches the speedometer), and Ctrl+C exits cleanly with the CSV intact.
5. `--raw`: confirm the raw hex prints alongside or instead of the decoded values.

## What to send back

When done, send the updated `elm327_bt.py` plus a one line note per change confirming it is in. Do not modify `obd_decoder.py`. If anything in this document is unclear, ask before implementing, especially change 2, which is small but easy to get subtly wrong in a way that only shows up on the car.
