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

## Backups

- **No second device or the network fails:** open http://localhost:8000/drive/ in a **second browser window** on the same laptop, side by side with the fleet view (Win + Left / Win + Right).
- **Backend will not start or the laptop has no Python:** open `demo/fleet-dashboard/index.html` directly, or add `?mode=standalone` to the fleet URL. An in-browser simulator produces the same JSON through a JavaScript copy of pack_packet and CRC-8, shown by a "Standalone mode" badge. The driver console needs the backend.
- **Port 8000 busy:** `python demo/run_demo.py --kill-existing`.
- **Projector shows a cramped layout:** use browser zoom 100 % and full screen (F11). The layout is checked at 1920x1080, 1536x864 (125 % scaling) and 1366x768.

## Suggested 5-minute talk order

1. **(0:00) The problem and the real pipeline, 45 s.** We read a real car (Maruti Fronx) over OBD-II with a Raspberry Pi and GPS, pack each sample into a 32-byte packet with a CRC-8, and stream it to our FastAPI backend. No live cars are allowed today, so only the cars are simulated; the packing, backend and dashboard are the real code.
2. **(0:45) The fleet view, 60 s.** Five cars on Chennai roads. The **Fronx is real recorded data** (31 July, idling, no GPS, so it is parked at a fixed point); the other four are simulated. Point at the packet ribbon on each card: hatched cells are bytes the car did not report (the Omni reports almost nothing; the Corolla reports everything).
3. **(1:45) One car in depth, 60 s.** Click the Corolla. Hover the bytes: each one names its field and decoded value, and the CRC is checked again in the browser. Every value is tagged measured, simulated, derived, not supported or not applicable (EV). Show the Veyron's "OBD limit" (speed is one byte, so 254 km/h is the most the wire can carry) and the Roadster's "Not applicable (EV)".
4. **(2:45) Live driving, 90 s.** Hand the phone to an examiner (QR code). They connect, turn the ignition on and press the throttle; the live car joins the fleet and its numbers move on the projector within a second. Open its car view to show the Driver inputs panel, then press Emergency stop and show the alert.
5. **(4:15) Alerts and wrap-up, 45 s.** Press P and trigger "Omni overheats" or "Corolla puncture"; the alert appears. Close on what is next: TPMS hardware (the 16-byte packet is already designed and implemented), CAN sniffing for brake/clutch/AC on the real Fronx, and moving the backend to the company cloud.

## Checks (developer)

```
python demo/tests/verify_dashboard.py                 # Level 1, demo running
python demo/tests/verify_level2.py                    # Level 2 + map/card sizes, demo running
python backend/tests/dry_run.py                       # 74 checks (add --stream with port 8000 free)
python backend/tpms_codec.py ; python backend/obd_decoder.py
```

Data preparation (already done, only re-run to refresh): `python demo/simulator/build_data.py`.
