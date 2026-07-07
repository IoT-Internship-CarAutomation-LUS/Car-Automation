Brief — OBD Decode & Packet-Packing Logic (→ Shaahir + Saptha)
Goal: Build and test the code that turns raw OBD-II responses into our 32-byte vehicle packet — before the hardware arrives — so that when the ELM327 is in hand, we're only wiring it in, not writing logic under pressure. This follows the "fake-data-first" pattern we used for the backend.
Source of truth: the Vehicle Data Acquisition Standard v1.0.0 — use its exact byte layout and decode formulas. Do not invent field positions or formulas; they're defined there.
Build three pieces:
1. The PID decoder. A function that takes a raw OBD hex response and returns the decoded value. For example, given the RPM response 41 0C 0B 34, it applies ((A×256)+B) ÷ 4 and returns 717. Cover all 8 target PIDs (RPM 0x0C, speed 0x0D, coolant 0x05, load 0x04, throttle 0x11, fuel 0x2F, MAF 0x10, intake 0x0F) with their correct formulas from the standard.
2. The "not supported" handler. When a response is a negative reply (7F 01 …), the decoder returns null for that field (not a crash, not a zero). This is the null-on-unavailable rule — test it explicitly with a fake 7F response.
3. The packet packer. A function that takes all the decoded values (plus placeholder GPS values for now) and packs them into the exact 32-byte binary layout from the standard, including the XOR checksum in byte 31. Then an unpacker that reverses it back to JSON — so you can round-trip test: pack → unpack → confirm you get the same values out.
Test it with fake data (no hardware needed):

Feed in a set of fake but realistic OBD responses (e.g. RPM 41 0C 0B 34, speed 41 0D 3C, coolant 41 05 7B, plus one 7F 01 11 for an unsupported PID).
Confirm the decoder produces the right numbers (717 RPM, 60 km/h, 83°C, and null for the unsupported one).
Confirm pack → unpack round-trips cleanly and the checksum validates.

Definition of done:

Decoder handles all 8 PIDs with correct values, verified against hand-calculated expected outputs.
7F responses produce null, don't crash.
32-byte pack/unpack round-trips correctly with a valid checksum.
A small test script demonstrates all of the above with fake data — show me it running.

Explicitly NOT in this brief (blocked until decided):

Talking to a real ELM327 (needs the adapter + the connection-method decision from the data-path research).
The AT init sequence and serial reading (depends on connection method — USB vs UART).
Testing on a real car (needs a confirmed vehicle).

Report to: me — show the test script running against fake data. Once the connection method is decided and the adapter's here, this logic drops straight in behind the serial reader.