# main.py — LUS Car Automation Backend
# Entry point. Creates the FastAPI app, wires everything together, and starts the server.
#
# Run with:
#   uvicorn main:app --host 0.0.0.0 --port 8000 --reload

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

import config
import database
from routes import router
from websocket_handler import websocket_endpoint

# ── App setup ─────────────────────────────────────────────────────────────────

app = FastAPI(
    title="LUS Car Automation Backend",
    description="WebSocket relay, data storage, and REST API for the LUS car automation project.",
    version="1.0.0"
)

# CORS — allow all origins so team members can access from any machine/browser
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Startup ───────────────────────────────────────────────────────────────────

@app.on_event("startup")
def on_startup():
    database.init_db()
    print(f"[SERVER] LUS Backend running on http://{config.HOST}:{config.PORT}")
    print(f"[SERVER] WebSocket endpoint: ws://{config.HOST}:{config.PORT}/ws")
    print(f"[SERVER] API docs: http://{config.HOST}:{config.PORT}/docs")

# ── Routes ────────────────────────────────────────────────────────────────────

app.include_router(router)            # REST API at /api/...
app.add_api_websocket_route("/ws", websocket_endpoint)  # WebSocket at /ws

# ── Run ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run("main:app", host=config.HOST, port=config.PORT, reload=True)
