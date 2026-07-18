#!/usr/bin/env python3
"""
can_sniffer.py - LUS Car Automation
A utility to reverse-engineer proprietary CAN bus signals (Brake, Clutch, etc.)
using an ELM327 Bluetooth adapter.

This script puts the ELM327 into Monitor All (AT MA) mode and creates a static,
in-place terminal dashboard. When a byte changes, it highlights it in RED for
a second so you can correlate physical actions with hex data.
"""

import serial
import sys
import time
import argparse
import os

# Configuration (matches elm327_bt.py)
DEFAULT_COM_PORT = "COM15"
BAUD_RATE = 38400

# ANSI Colors
RED = "\033[91m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
RESET = "\033[0m"
CLEAR_SCREEN = "\033[2J\033[H"

class CanSniffer:
    def __init__(self, port, filter_id=None):
        self.port = port
        self.filter_id = filter_id
        
        # State tracking: { can_id: { "data": [0x00, ...], "last_changed": [ts, ts, ...] } }
        self.frames = {}
        
        try:
            self.ser = serial.Serial(self.port, BAUD_RATE, timeout=0.1)
            print(f"{GREEN}[OK]{RESET} Connected to ELM327 on {self.port}")
        except Exception as e:
            print(f"{RED}[ERROR]{RESET} Could not open {self.port}: {e}")
            sys.exit(1)

    def send_cmd(self, cmd, wait=0.5):
        """Send AT command to ELM327 and wait for response."""
        self.ser.write((cmd + "\r").encode())
        time.sleep(wait)
        resp = self.ser.read_all().decode(errors="ignore").replace("\r", "\n").strip()
        return resp

    def setup_elm(self):
        print(f"[{CYAN}INIT{RESET}] Configuring ELM327 for CAN sniffing...")
        
        # Reset and standard config
        self.send_cmd("AT Z", 1.0)
        self.send_cmd("AT E0")     # Echo off
        self.send_cmd("AT S1")     # Spaces on (easier parsing)
        self.send_cmd("AT AL")     # Allow long messages
        self.send_cmd("AT H1")     # Headers on (shows CAN ID)
        self.send_cmd("AT CAF0")   # CAN Auto Formatting off (raw mode)

        # Apply hardware filter if requested to prevent BUFFER FULL
        if self.filter_id:
            print(f"[{CYAN}FILTER{RESET}] Setting CAN Receive Address to {self.filter_id}")
            self.send_cmd(f"AT CRA {self.filter_id}")
        
        print(f"[{CYAN}START{RESET}] Starting Monitor mode (AT MA)...")
        print(f"{YELLOW}Warning: ELM327 may output 'BUFFER FULL' over Bluetooth on busy buses.{RESET}")
        print(f"{YELLOW}If this happens, run with '--filter <CAN_ID>' to monitor a specific module.{RESET}")
        time.sleep(2)
        
        self.ser.write(b"AT MA\r")
        
    def render_dashboard(self):
        """Render the static terminal UI."""
        # Move cursor to top-left instead of clearing screen to prevent flickering
        sys.stdout.write("\033[H")
        
        now = time.time()
        print(f"{CYAN}=== ELM327 CAN BUS SNIFFER ==={RESET}")
        print(f"Port: {self.port} | Filter: {self.filter_id or 'NONE (AT MA)'}")
        print("Press Ctrl+C to stop. Changed bytes highlight in RED.")
        print("-" * 50)
        print(f"{'CAN ID':<8} | {'DATA BYTES':<24} | LAST SEEN")
        print("-" * 50)
        
        # Sort by CAN ID for stable rendering
        for can_id in sorted(self.frames.keys()):
            frame = self.frames[can_id]
            data_str = ""
            for i, byte in enumerate(frame["data"]):
                # Highlight if changed in the last 1.0 seconds
                if now - frame["last_changed"][i] < 1.0:
                    data_str += f"{RED}{byte:02X}{RESET} "
                else:
                    data_str += f"{byte:02X} "
                    
            seen_ago = now - frame["last_seen"]
            print(f"{can_id:<8} | {data_str:<30} | {seen_ago:.1f}s ago\033[K") # \033[K clears the rest of the line
            
        # Clear any remaining lines below the dashboard
        print("\033[J", end="")
        sys.stdout.flush()

    def parse_line(self, line):
        """Parse a line from AT MA output."""
        line = line.strip()
        if not line or line == ">" or "BUFFER FULL" in line or "CAN ERROR" in line:
            return
            
        # Expected format: "ID  D1 D2 D3 D4 D5 D6 D7 D8"
        # Example: "015  00 00 00 00 00 00 00 00"
        tokens = line.split()
        if len(tokens) < 2:
            return
            
        can_id = tokens[0]
        try:
            # Try parsing the rest as hex bytes
            data_bytes = [int(b, 16) for b in tokens[1:]]
        except ValueError:
            # Likely a junk line or error message we didn't catch
            return
            
        now = time.time()
        
        if can_id not in self.frames:
            # First time seeing this ID
            self.frames[can_id] = {
                "data": data_bytes,
                "last_changed": [now] * len(data_bytes),
                "last_seen": now
            }
        else:
            # Compare and update
            frame = self.frames[can_id]
            frame["last_seen"] = now
            
            # Ensure arrays match in length (sometimes DLC changes)
            if len(data_bytes) != len(frame["data"]):
                frame["data"] = data_bytes
                frame["last_changed"] = [now] * len(data_bytes)
            else:
                for i in range(len(data_bytes)):
                    if data_bytes[i] != frame["data"][i]:
                        frame["data"][i] = data_bytes[i]
                        frame["last_changed"][i] = now
                        
    def run(self):
        self.setup_elm()
        
        # Clear screen once initially
        sys.stdout.write(CLEAR_SCREEN)
        
        buffer = ""
        last_render = time.time()
        
        try:
            while True:
                # Read whatever is available
                if self.ser.in_waiting:
                    chunk = self.ser.read(self.ser.in_waiting).decode(errors="ignore")
                    buffer += chunk
                    
                    # Process lines
                    while "\r" in buffer or "\n" in buffer:
                        # ELM327 usually uses \r
                        if "\r" in buffer:
                            line, buffer = buffer.split("\r", 1)
                        else:
                            line, buffer = buffer.split("\n", 1)
                            
                        self.parse_line(line)
                
                # Render UI at 10Hz
                if time.time() - last_render > 0.1:
                    self.render_dashboard()
                    last_render = time.time()
                    
                time.sleep(0.01)
                
        except KeyboardInterrupt:
            print(f"\n{CYAN}Stopping sniffer...{RESET}")
            # Stop the ELM327 from dumping data
            self.ser.write(b"\r")
            time.sleep(0.5)
            self.ser.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ELM327 CAN Bus Sniffer")
    parser.add_argument("--port", default=DEFAULT_COM_PORT, help="Serial port (default: COM15)")
    parser.add_argument("--filter", help="Specific CAN ID to monitor (e.g. 1F8)")
    args = parser.parse_args()
    
    sniffer = CanSniffer(args.port, args.filter)
    sniffer.run()
