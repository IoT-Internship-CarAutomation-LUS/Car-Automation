# run_demo.py -- start the fleet telemetry demo with one command.
#
#   python demo/run_demo.py                       # backend + simulator + browser
#   python demo/run_demo.py --fronx-mode simulated
#   python demo/run_demo.py --no-sim              # backend only (e.g. a second laptop drives the cars)
#   python demo/run_demo.py --no-browser
#
# Starts the real FastAPI backend (backend/main.py) on port 8000, waits for
# GET /api/health, starts demo/simulator/fleet_sim.py, and opens
# http://localhost:8000/fleet/. Ctrl+C stops both. On Windows the children
# are placed in a Job Object that kills them when this launcher exits for
# any reason, so nothing is left holding port 8000.

import argparse
import json
import os
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
SIM = ROOT / "demo" / "simulator" / "fleet_sim.py"
IS_WIN = os.name == "nt"


# -- Windows: kill-on-close Job Object -----------------------------------------
class _Job:
    def __init__(self):
        self.handle = None
        if not IS_WIN:
            return
        try:
            import ctypes
            from ctypes import wintypes
            k32 = ctypes.WinDLL("kernel32", use_last_error=True)

            class IO_COUNTERS(ctypes.Structure):
                _fields_ = [(n, ctypes.c_ulonglong) for n in (
                    "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
                    "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

            class BASIC(ctypes.Structure):
                _fields_ = [("PerProcessUserTimeLimit", ctypes.c_longlong),
                            ("PerJobUserTimeLimit", ctypes.c_longlong),
                            ("LimitFlags", wintypes.DWORD),
                            ("MinimumWorkingSetSize", ctypes.c_size_t),
                            ("MaximumWorkingSetSize", ctypes.c_size_t),
                            ("ActiveProcessLimit", wintypes.DWORD),
                            ("Affinity", ctypes.c_size_t),
                            ("PriorityClass", wintypes.DWORD),
                            ("SchedulingClass", wintypes.DWORD)]

            class EXTENDED(ctypes.Structure):
                _fields_ = [("BasicLimitInformation", BASIC), ("IoInfo", IO_COUNTERS),
                            ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                            ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

            k32.CreateJobObjectW.restype = wintypes.HANDLE
            k32.OpenProcess.restype = wintypes.HANDLE
            job = k32.CreateJobObjectW(None, None)
            info = EXTENDED()
            info.BasicLimitInformation.LimitFlags = 0x2000   # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if not k32.SetInformationJobObject(wintypes.HANDLE(job), 9, ctypes.byref(info), ctypes.sizeof(info)):
                return
            self.k32, self.handle, self.wintypes = k32, job, wintypes
        except Exception:  # noqa: BLE001 -- the job is a safety net, not a requirement
            self.handle = None

    def add(self, proc):
        if not self.handle:
            return
        h = self.k32.OpenProcess(0x0001 | 0x0100, False, proc.pid)   # PROCESS_TERMINATE | PROCESS_SET_QUOTA
        if h:
            self.k32.AssignProcessToJobObject(self.wintypes.HANDLE(self.handle), self.wintypes.HANDLE(h))
            self.k32.CloseHandle(self.wintypes.HANDLE(h))


def port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def port_owner_pids(port):
    if not IS_WIN:
        return []
    try:
        out = subprocess.run(["netstat", "-ano", "-p", "TCP"], capture_output=True, text=True, timeout=10).stdout
    except Exception:  # noqa: BLE001
        return []
    pids = set()
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 5 and parts[1].endswith(f":{port}") and parts[3] == "LISTENING":
            pids.add(parts[4])
    return sorted(pids)


def kill_tree(proc):
    if proc is None or proc.poll() is not None:
        return
    if IS_WIN:
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
    else:
        proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()


def pump(proc, tag):
    for line in iter(proc.stdout.readline, ""):
        sys.stdout.write(f"[{tag}] {line}" if not line.startswith("[") else f"{tag:>7} | {line}")
    proc.stdout.close()


def lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return None


def wait_health(port, timeout=25):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1) as r:
                if r.status == 200:
                    return True
        except Exception:  # noqa: BLE001
            time.sleep(0.4)
    return False


def main():
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except AttributeError:
        pass
    ap = argparse.ArgumentParser(description="Start the fleet telemetry demo.")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="0.0.0.0", help="0.0.0.0 lets a second laptop on the same Wi-Fi connect")
    ap.add_argument("--fronx-mode", choices=("recorded", "simulated"), default="recorded")
    ap.add_argument("--no-sim", action="store_true", help="start the backend only")
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--kill-existing", action="store_true",
                    help="if something already listens on the port, stop it first (Windows)")
    args = ap.parse_args()

    if port_in_use(args.port):
        pids = port_owner_pids(args.port)
        if args.kill_existing and pids:
            for pid in pids:
                subprocess.run(["taskkill", "/PID", pid, "/T", "/F"], capture_output=True)
            time.sleep(1.0)
        if port_in_use(args.port):
            print(f"[demo] Port {args.port} is already in use (PID {', '.join(pids) or 'unknown'}).")
            print("[demo] Stop that process, or run again with --kill-existing.")
            return 2

    env = dict(os.environ, PYTHONUNBUFFERED="1", PYTHONIOENCODING="utf-8")
    flags = subprocess.CREATE_NEW_PROCESS_GROUP if IS_WIN else 0
    job = _Job()
    backend = sim = None
    try:
        print(f"[demo] starting backend on port {args.port} ...")
        backend = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "main:app", "--host", args.host, "--port", str(args.port),
             "--log-level", "warning"],
            cwd=BACKEND, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            encoding="utf-8", errors="replace", creationflags=flags)
        job.add(backend)
        threading.Thread(target=pump, args=(backend, "backend"), daemon=True).start()
        if not wait_health(args.port):
            print("[demo] backend did not answer /api/health within 25 s -- see the log above.")
            return 1
        print(f"[demo] backend healthy: http://localhost:{args.port}/api/health")

        if not args.no_sim:
            sim = subprocess.Popen(
                [sys.executable, str(SIM), "--ws", f"ws://127.0.0.1:{args.port}/ws", "--fronx-mode", args.fronx_mode],
                cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                encoding="utf-8", errors="replace", creationflags=flags)
            job.add(sim)
            threading.Thread(target=pump, args=(sim, "sim"), daemon=True).start()

        url = f"http://localhost:{args.port}/fleet/"
        # Same answer the presenter panel's QR code uses (Wi-Fi / hotspot adapter first).
        ips = []
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{args.port}/api/lan-info", timeout=5) as r:
                ips = [a["ip"] for a in json.loads(r.read()).get("addresses", [])]
        except Exception:  # noqa: BLE001
            ips = [lan_ip()] if lan_ip() else []
        print("")
        print(f"[demo] Fleet dashboard:   {url}")
        print(f"[demo] Driver console:    http://localhost:{args.port}/drive/   (this laptop, second window)")
        for i, ip in enumerate(ips):
            tag = "phone / 2nd laptop" if i == 0 else "other adapter"
            print(f"[demo] Driver console:    http://{ip}:{args.port}/drive/   ({tag}, same Wi-Fi or hotspot)")
        if not ips:
            print("[demo] No LAN address found: connect to Wi-Fi or a phone hotspot to drive from another device.")
        print("[demo] Press P in the dashboard for the presenter panel (QR code for the driver console).")
        print("[demo] Windows Firewall: if asked, allow Python on PRIVATE networks. Ctrl+C here stops everything.")
        print("")
        if not args.no_browser:
            webbrowser.open(url)

        while True:
            time.sleep(0.5)
            if backend.poll() is not None:
                print(f"[demo] backend exited with code {backend.returncode}")
                return 1
            if sim is not None and sim.poll() is not None:
                print(f"[demo] simulator exited with code {sim.returncode} -- restarting it")
                sim = subprocess.Popen(
                    [sys.executable, str(SIM), "--ws", f"ws://127.0.0.1:{args.port}/ws", "--fronx-mode", args.fronx_mode],
                    cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                    encoding="utf-8", errors="replace", creationflags=flags)
                job.add(sim)
                threading.Thread(target=pump, args=(sim, "sim"), daemon=True).start()
    except KeyboardInterrupt:
        print("\n[demo] stopping ...")
    finally:
        kill_tree(sim)
        kill_tree(backend)
        for _ in range(10):
            if not port_in_use(args.port):
                break
            time.sleep(0.3)
        if port_in_use(args.port):
            for pid in port_owner_pids(args.port):
                subprocess.run(["taskkill", "/PID", pid, "/T", "/F"], capture_output=True)
        print(f"[demo] stopped. Port {args.port} is {'still busy!' if port_in_use(args.port) else 'free'}.")
    return 0


if __name__ == "__main__":
    if IS_WIN:
        signal.signal(signal.SIGBREAK, signal.default_int_handler)   # closing the console = Ctrl+C
    sys.exit(main())
