# Run sheet: fleet telemetry demo (internship review)

Five cars on one screen, plus a car you drive live from a second device. Only the cars are simulated or replayed. Every message goes through the real pipeline:

```
simulator / driver console -> 32-byte packet (pack_packet, CRC-8) -> unpack -> schema v2.2.0 JSON
                           -> WebSocket -> FastAPI backend (/ws: stores, fans out) -> fleet dashboard (/fleet/)
```

## Before the review (10 minutes, once)

1. Laptop on power. Close other apps that use port 8000.
2. Connect the laptop and the second device (phone or laptop) to **the same network**. If college Wi-Fi blocks devices from seeing each other (common on campus networks), turn on a **phone hotspot** and join both to it.
3. In Windows: Settings > Network > the Wi-Fi or hotspot network > **Network profile type: Private**.
4. Run the demo once (below). If Windows Firewall asks about Python, tick **Private networks** and click **Allow**. If you missed the prompt: Windows Security > Firewall > Allow an app > Python > tick Private.
5. Test from the second device: open the driver console URL (step 3 below). If it does not load, recheck steps 2 to 4.
6. Check the map shows (it needs internet for the map tiles). Without internet the map is grey; everything else still works.

## On the day

1. **Start everything:** `python demo/run_demo.py` (or double-click `demo\run_demo.bat`). It starts the backend and the simulator and opens http://localhost:8000/fleet/. The terminal prints the driver console addresses, for example:
   ```
   [demo] Driver console:    http://localhost:8000/drive/   (this laptop, second window)
   [demo] Driver console:    http://192.168.x.x:8000/drive/   (phone / 2nd laptop, same Wi-Fi or hotspot)
   ```
2. **Fleet view** on the projector: five cars appear within a few seconds. Press **F11** for full screen. "Fit all" (top left of the map) reframes every car.
3. **Driver console on the second device:** press **P** on the fleet view. The presenter panel shows a **QR code** and the `http://<laptop IP>:8000/drive/` address. Scan it with the phone, or type the address on the second laptop.
4. On the console: pick a car, **Connect**, then **Ignition** (or key I), choose **1** (or key E), and press the **throttle** (drag the green pedal down, or hold W). The car appears on the fleet map at the Crescent campus, Vandalur, with a **Live** tag, and its speed, RPM and throttle move on the projector.
5. Press **Emergency stop** (or X): the car stops and a critical alert appears on the fleet screen.
6. **Ctrl+C** in the terminal stops everything and frees port 8000.

Console keys: W or Up = throttle, S or Down = brake, Space or C = clutch, Q / E = gear down / up, I = ignition, X = emergency stop, H = horn. On a phone, drag the pedals with a thumb; they spring back when released.

## The "How data flows" page (/flow/)

http://localhost:8000/flow/ (also linked as **How data flows** in the fleet header, and as **Trace this packet** in every car view). It follows **one value** from the car's ECU to the dashboard tile through 8 stages plus the GPS side branch. Each stage shows what happens, the data at that point, the **real code** from this repo (file and line numbers), and the matching **figure from the internship report** (click to enlarge).

- **Trace:** RPM (0x0C), speed (0x0D), coolant (0x05), throttle (0x11) or fuel (0x2F). **Source:** any car on the fleet, including a console car that joins later.
- **Pause** holds one packet while you talk. **Report example** freezes on the report's own numbers: `41 0C 0D 2E` → 843.5 rpm (Figures 4.3 and 5.13). **Summary view** puts all eight steps for the value on one screen, which is handy for questions.
- Keys: Left / Right = previous / next stage, Space = walk through (about 6 s per stage), 1 to 8 = jump.
- Stages 1 to 4 are rebuilt from each real packet (our cars send packets, not ELM327 text) and say so; stages 5 to 8 show the actual packet. Unsupported values show the honest path: NO DATA → None → FF → null → "Not supported".

## Level 3 (optional): the 3D view (/3d/)

http://localhost:8000/3d/ (also **3D** in the fleet header). One car at a time, moved **only by its telemetry**: the wheels turn at the packet's road speed, the front wheels steer from the change in GPS heading, the brake lights follow `vehicle.brake`, the body dips under braking and squats under acceleration, the road scrolls at the real speed and the compass rose turns with the heading. Each tyre has a TPMS ring (green, amber, red at the fleet's alert limits; grey where no TPMS is fitted). The bodies are generic shapes built in code, not models of the real cars.

- **Pick a car:** the buttons under the header, or keys **1** to **9**. A console car appears as soon as it connects. Link straight to one with `/3d/#car=corolla`.
- **Camera:** drag to orbit, scroll to zoom. **C** chase, **S** side, **T** top, **R** reset. An idle car slowly orbits after 6 s (it holds still while the mouse is over the view).
- **X** = **Show our hardware**: the body turns see-through and shows the OBD-II port under the dashboard (driver's side) with the ELM327, the Bluetooth link to the Raspberry Pi 4 on the dashboard, the NEO-6M antenna under the windscreen, and a pulse per packet going out to the backend. Placement is illustrative. **Each label opens that stage on /flow/.**
- **Inside the car view:** "3D view" in the *Engine and speed* panel swaps the gauges for the same 3D view; "Gauges" swaps back. Nothing 3D loads until it is pressed.
- Honest states to point at: the **Fronx** and **Omni** brake lights stay dark and the readout says *Brake: Unknown (not found on CAN bus)*; the Fronx says *TPMS not fitted*. **Corolla puncture** (press P) turns its front-left ring red (use the chase or default view: FL is on the far side in the side view).
- Needs WebGL (any laptop GPU; ~60 fps at 1080p on the review laptop). Without it the page says so and the 2D views keep working.

**Where it fits in the talk:** as a 30 s closer after live driving (4:00), or during it: open `/3d/` on the projector, pick the console car while the examiner drives, and the wheels, brake lights and pedal bars follow their phone. Press **X** to show where the real kit sits, and click the ELM327 label to jump back into /flow/ if asked how the data gets out of the car.

## Backups

- **No second device or the network fails:** open http://localhost:8000/drive/ in a **second browser window** on the same laptop, side by side with the fleet view (Win + Left / Win + Right).
- **Backend will not start or the laptop has no Python:** open `demo/fleet-dashboard/index.html` directly, or add `?mode=standalone` to the fleet URL. An in-browser simulator produces the same JSON through a JavaScript copy of pack_packet and CRC-8, shown by a "Standalone mode" badge. The driver console needs the backend.
- **Port 8000 busy:** `python demo/run_demo.py --kill-existing`.
- **Projector shows a cramped layout:** use browser zoom 100 % and full screen (F11). The layout is checked at 1920x1080, 1536x864 (125 % scaling) and 1366x768.

## Suggested 5-minute talk order

The flow page fits best **right after the fleet view and before live driving**: it explains how one number gets onto the screen, so the live drive that follows is understood as the same pipeline, not a trick.

1. **(0:00) The problem and the real pipeline, 40 s.** We read a real car (Maruti Fronx) over OBD-II with a Raspberry Pi and GPS, pack each sample into a 32-byte packet with a CRC-8, and stream it to our FastAPI backend. No live cars are allowed today, so only the cars are simulated; the packing, backend and dashboard are the real code.
2. **(0:40) The fleet view, 50 s.** Five cars on Chennai roads. The **Fronx is real recorded data** (31 July, idling, no GPS, so it is parked at a fixed point); the other four are simulated. Point at the packet ribbon: hatched cells are bytes the car did not report (the Omni reports almost nothing; the Corolla reports everything). Click the Corolla, hover two bytes, show the provenance tags.
3. **(1:30) How data flows, 75 s.** From the car view press **Trace this packet** (or open /flow/). Press **Report example**: stage 2 (the CAN request and reply, report Figure 4.3), stage 4 (`41 0C 0D 2E` → ((0x0D × 256) + 0x2E) / 4 = 843.5 rpm), stage 5 (the 32 bytes and the CRC), stage 7 (the backend stores and fans out). Each stage shows our real code and the report figure. Switch Trace to Fuel on the Fronx for the honest "Not supported" path.
4. **(2:45) Live driving, 75 s.** Hand the phone to an examiner (QR code, press P). They connect, turn the ignition on and press the throttle; the live car joins the fleet within a second. Optionally pick it as the Source on /flow/ to show its packets passing through the same stages. Press Emergency stop and show the alert.
5. **(4:00) Alerts and wrap-up, 60 s.** Press P and trigger "Omni overheats" or "Corolla puncture"; the alert appears. Close on what is next: TPMS hardware (the 16-byte packet is already designed and implemented), CAN sniffing for brake/clutch/AC on the real Fronx, and moving the backend to the company cloud. Keep the /flow/ **Summary view** ready for questions.

## Checks (developer)

```
python demo/tests/verify_dashboard.py                 # Level 1, demo running
python demo/tests/verify_level2.py                    # Level 2 + map/card sizes, demo running
python demo/tests/verify_flow.py                      # /flow/ page, demo running
python demo/tests/verify_level3.py                    # /3d/ + embedded 3D view, demo running
python demo/tests/test_flow_roundtrip.py              # reconstruction round trip (no browser)
python demo/obd-flow/build_snippets.py                # re-extract the code shown on /flow/ (--check to verify)
python backend/tests/dry_run.py                       # 74 checks (add --stream with port 8000 free)
python backend/tpms_codec.py ; python backend/obd_decoder.py
```

Data preparation (already done, only re-run to refresh): `python demo/simulator/build_data.py`.
