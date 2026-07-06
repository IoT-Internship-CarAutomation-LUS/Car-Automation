# websocket_handler.py — LUS Car Automation Backend
# Manages all WebSocket connections.
# One /ws endpoint for everyone: hardware, dashboards, mock senders.
#
# Message routing:
#   telemetry       → save to DB + fan-out to all clients
#   platform_status → save to DB + fan-out to all clients
#   command         → fan-out to all clients (reaches hardware/platform)

import json
from fastapi import WebSocket, WebSocketDisconnect
from database import save_telemetry, save_platform_status
import config

# Set of all currently connected WebSocket clients
connected_clients: set[WebSocket] = set()


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
                save_telemetry(ts, message)
                await fan_out(raw, sender=websocket)

            elif msg_type == "platform_status":
                save_platform_status(ts, message)
                await fan_out(raw, sender=websocket)

            elif msg_type == "command":
                # Don't store commands — just relay them
                print(f"[WS] Command received: {message.get('action')}")
                await fan_out(raw, sender=websocket)

            else:
                print(f"[WS] Unknown message type: '{msg_type}' — ignoring.")

    except WebSocketDisconnect:
        connected_clients.discard(websocket)
        print(f"[WS] Client disconnected: {client.host}:{client.port} | Total: {len(connected_clients)}")


async def fan_out(raw_message: str, sender: WebSocket):
    """Send a message to every connected client, including the sender."""
    dead_clients = set()

    for client in connected_clients:
        try:
            await client.send_text(raw_message)
        except Exception:
            # Client dropped without a clean disconnect
            dead_clients.add(client)

    # Clean up any dead connections found during fan-out
    for dead in dead_clients:
        connected_clients.discard(dead)
        print(f"[WS] Removed dead client during fan-out.")
