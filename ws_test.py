import sys
from websockets.sync.client import connect

print("Attempting connection to wss://api.nalusa.space/ws...")
try:
    with connect(
        "wss://api.nalusa.space/ws",
        open_timeout=8.0,
        additional_headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Origin": "https://api.nalusa.space"
        }
    ) as websocket:
        print("Successfully connected!")
        websocket.close()
except Exception as e:
    print(f"Failed to connect: {type(e).__name__} - {e}")
