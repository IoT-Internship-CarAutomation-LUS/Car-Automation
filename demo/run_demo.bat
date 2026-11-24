@echo off
rem Fleet telemetry demo: backend + simulator + browser. Ctrl+C to stop.
rem Extra options pass through, e.g.  run_demo.bat --fronx-mode simulated
cd /d "%~dp0.."
python demo\run_demo.py %*
if errorlevel 1 pause
