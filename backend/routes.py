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
