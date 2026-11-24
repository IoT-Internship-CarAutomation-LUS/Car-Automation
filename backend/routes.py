# routes.py — LUS Car Automation Backend
# All REST API endpoints. Mounted into the FastAPI app in main.py.

import re
import socket
import subprocess
import sys
import time

from fastapi import APIRouter
from fastapi.responses import JSONResponse
import config
import database

router = APIRouter(prefix="/api")


@router.get("/health")
def health():
    """Connection health check — turns the dashboard's link indicator green."""
    return {"status": "ok"}


_lan_cache = {"t": 0.0, "data": None}
_SKIP_ADAPTER = re.compile(r"vEthernet|VirtualBox|VMware|Hyper-V|WSL|Loopback|Bluetooth|Docker|Tailscale|ZeroTier|VPN", re.I)


def _windows_adapters():
    """(adapter name, IPv4) pairs from `ipconfig`, skipping virtual adapters."""
    out = subprocess.run(["ipconfig"], capture_output=True, text=True, timeout=5,
                         creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout
    pairs, adapter = [], ""
    for line in out.splitlines():
        if line and not line.startswith(" ") and line.rstrip().endswith(":"):
            adapter = line.strip().rstrip(":")
        m = re.search(r"IPv4 Address[ .]*: *([\d.]+)", line)
        if m and adapter and not _SKIP_ADAPTER.search(adapter):
            pairs.append((adapter, m.group(1)))
    return pairs


def _primary_ip():
    """The address the OS would use for outbound traffic (no packet is sent)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return None


@router.get("/lan-info")
def lan_info():
    """
    v2.2.0 fleet demo: this computer's LAN IPv4 addresses, so the presenter panel
    can show a /drive/ URL and QR code that a second device can open, even when
    the dashboard itself was opened as localhost. Wi-Fi / hotspot adapters first.
    """
    now = time.time()
    if _lan_cache["data"] and now - _lan_cache["t"] < 30:
        return _lan_cache["data"]
    addrs = []
    try:
        if sys.platform == "win32":
            addrs = [{"ip": ip, "interface": name} for name, ip in _windows_adapters()]
    except Exception:  # noqa: BLE001 -- best effort, fall back below
        addrs = []
    primary = _primary_ip()
    if primary and not primary.startswith("127.") and all(a["ip"] != primary for a in addrs):
        addrs.append({"ip": primary, "interface": "default route"})
    addrs = [a for a in addrs if not a["ip"].startswith(("127.", "169.254."))]

    def rank(a):
        name = a["interface"].lower()
        wifi = any(k in name for k in ("wi-fi", "wifi", "wireless", "wlan", "hotspot", "local area connection*"))
        return (0 if wifi else 1, 0 if a["ip"] == primary else 1)
    addrs.sort(key=rank)
    for i, a in enumerate(addrs):
        a["preferred"] = i == 0
    data = {"addresses": addrs, "port": config.PORT,
            "drive_url": f"http://{addrs[0]['ip']}:{config.PORT}/drive/" if addrs else None}
    _lan_cache.update(t=now, data=data)
    return data


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
