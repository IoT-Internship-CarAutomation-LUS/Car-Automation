# websocket_handler.py — LUS Car Automation Backend
# Manages all WebSocket connections.
# One /ws endpoint for everyone: hardware, dashboards, mock senders.
#
# Message routing:
#   telemetry    → save to DB + fan-out to all other clients
#   demo_control → fan-out only, NOT saved (v2.1.0, fleet demo presenter panel)
#   vehicle_left → sent BY the backend when a socket that streamed a live,
#                  person-driven car (source.control == "manual") disconnects (v2.2.0)

import json
import time
from fastapi import WebSocket, WebSocketDisconnect
from database import save_telemetry
import config
from obd_decoder import calculate_gear

# Set of all currently connected WebSocket clients
connected_clients: set[WebSocket] = set()

# v2.2.0: live, person-driven cars streamed by each socket (vehicle_id -> name),
# so the fleet dashboard can be told when that car leaves.
live_cars: dict[WebSocket, dict[str, str]] = {}


async def websocket_endpoint(websocket: WebSocket):
    """Handle a single WebSocket connection for its entire lifetime."""
    await websocket.accept()
    connected_clients.add(websocket)
    client = websocket.client
    print(f"[WS] Client connected: {client.host}:{client.port} | Total: {len(connected_clients)}")

    try:
        while True:
            raw = await websocket.receive_text()

            # Parse the incoming message
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                print(f"[WS] Bad JSON from {client.host} — ignoring.")
                continue

            msg_type = message.get("type")
            ts = message.get("ts", 0)
            schema_ver = message.get("schema_version")

            if schema_ver != config.SCHEMA_VERSION:
                print(f"[WS] ⚠ SCHEMA MISMATCH: Client {client.host} sent version '{schema_ver}' (expected '{config.SCHEMA_VERSION}'). Forwarding as-is.")

            # ── Route by message type ──────────────────────────────────────
            if msg_type == "telemetry":
                vehicle = message.get("vehicle")
                source = message.get("source")
                is_ev = isinstance(source, dict) and source.get("powertrain") == "ev"
                # v2.2.0: a person drives this car from the Control Console and the gear
                # comes from the lever (0 = neutral even while rolling): never overwrite it.
                is_manual = isinstance(source, dict) and source.get("control") == "manual"
                if is_manual and source.get("vehicle_id"):
                    live_cars.setdefault(websocket, {})[str(source["vehicle_id"])] = str(source.get("name") or source["vehicle_id"])
                if isinstance(vehicle, dict) and not is_ev and not is_manual:
                    # Automatically estimate/inject gear if missing or 0 while moving.
                    # v2.1.0: never for EVs (single-speed, no gearbox to estimate), and
                    # a null speed/rpm is "unavailable", so it cannot drive an estimate.
                    speed = vehicle.get("speed_kmh")
                    rpm = vehicle.get("rpm")
                    if not vehicle.get("gear") and speed is not None and rpm is not None and speed >= 3:
                        vehicle["gear"] = calculate_gear(rpm, speed)
                        raw = json.dumps(message)

                save_telemetry(ts, message)
                await fan_out(raw, sender=websocket)

            elif msg_type == "demo_control":
                # v2.1.0: presenter scenario from the fleet dashboard to the simulator.
                # Relayed to every other client, never saved -- it is not telemetry.
                print(f"[WS] demo_control '{message.get('scenario')}' target={message.get('target')} -- relaying")
                await fan_out(raw, sender=websocket)

            else:
                print(f"[WS] Unknown message type: '{msg_type}' — ignoring.")

    except WebSocketDisconnect:
        print(f"[WS] Client disconnected: {client.host}:{client.port} | Total: {len(connected_clients) - 1}")
    finally:
        connected_clients.discard(websocket)
        # v2.2.0: tell everyone else that this socket's live car(s) left the fleet.
        for vehicle_id, name in live_cars.pop(websocket, {}).items():
            await fan_out(json.dumps({
                "type": "vehicle_left", "schema_version": config.SCHEMA_VERSION,
                "ts": int(time.time() * 1000), "vehicle_id": vehicle_id, "name": name,
            }), sender=websocket)


async def fan_out(raw_message: str, sender: WebSocket):
    """Send a message to every connected client except the sender."""
    dead_clients = set()

    # Iterate over a snapshot: another client can connect or disconnect while
    # this coroutine is suspended in send_text(), which would otherwise raise
    # "Set changed size during iteration" and drop the sender's connection.
    for client in list(connected_clients):
        if client is sender:
            continue
        try:
            await client.send_text(raw_message)
        except Exception:
            # Client dropped without a clean disconnect
            dead_clients.add(client)

    # Clean up any dead connections found during fan-out
    for dead in dead_clients:
        connected_clients.discard(dead)
        print(f"[WS] Removed dead client during fan-out.")
