# routes.py — LUS Car Automation Backend
# All REST API endpoints. Mounted into the FastAPI app in main.py.

from fastapi import APIRouter
from fastapi.responses import JSONResponse
import database

router = APIRouter(prefix="/api")


@router.get("/health")
def health():
    """Connection health check — turns the dashboard's link indicator green."""
    return {"status": "ok"}


@router.get("/telemetry/latest")
def telemetry_latest():
    """Return the most recent telemetry record."""
    data = database.get_latest_telemetry()
    if data is None:
        return JSONResponse(status_code=404, content={"error": "No telemetry data yet."})
    return data


@router.get("/telemetry/history")
def telemetry_history(limit: int = 100):
    """Return the last N telemetry records (oldest first). Used for graphs."""
    return database.get_telemetry_history(limit)


@router.get("/gps/track")
def gps_track(limit: int = 200):
    """
    Return the last N GPS points as {lat, lng, ts}.
    Only includes points where gps.fix == true.
    Feeds Dashboard 1's breadcrumb trail.
    """
    return database.get_gps_track(limit)


@router.get("/platform/history")
def platform_history(limit: int = 200):
    """Return the last N platform_status records (oldest first). Used for drive replay."""
    return database.get_platform_history(limit)


@router.post("/command")
async def post_command(request: dict):
    """
    Backup command path over HTTP — used if the WebSocket drops.
    Accepts the same command format as the WebSocket message.
    Note: this stores the command but does NOT relay it to hardware
    (hardware must be connected via WebSocket for real-time relay).
    """
    valid_actions = {"forward", "set_speed", "stop", "brake", "estop"}
    action = request.get("action")

    if action not in valid_actions:
        return JSONResponse(
            status_code=400,
            content={"error": f"Unknown action '{action}'. Must be one of: {sorted(valid_actions)}"}
        )

    print(f"[REST] Command received via HTTP: {action}")
    return {"status": "received", "action": action}
