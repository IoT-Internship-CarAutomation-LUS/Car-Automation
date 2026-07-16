#!/usr/bin/env python3
"""
gps_neo6m_pi.py — LUS Car Automation (Job 2: Raspberry Pi NEO-6M GPS Reader)

Connects to a u-blox NEO-6M GPS module via the Raspberry Pi serial port (/dev/serial0),
parses real-time NMEA sentences ($GPGGA, $GPRMC, $GPVTG, $GPGSA, $GPGSV), and outputs
live GPS coordinates, speed, altitude, and satellite fix status.

========================================================================================
WIRING (NEO-6M Module -> Raspberry Pi 4 GPIO):
----------------------------------------------------------------------------------------
  NEO-6M Pin    Pi Physical Pin    Pi Function / GPIO
  ----------    ---------------    ------------------
  VCC           Pin 2 or 4         5V Power (or 3.3V Pin 1)
  GND           Pin 6              Ground (GND)
  TX            Pin 10             GPIO 15 (RXD0 - Serial Receive)
  RX            Pin 8              GPIO 14 (TXD0 - Serial Transmit)
----------------------------------------------------------------------------------------
IMPORTANT CROSS-OVER NOTE:
  GPS TX -> Pi RX (Pin 10)
  GPS RX -> Pi TX (Pin 8)
  If cat /dev/serial0 outputs nothing, swapping TX and RX is the first thing to try!
========================================================================================

RASPBERRY PI SETUP & PREREQUISITES:
----------------------------------------------------------------------------------------
1. Enable Serial Hardware on Raspberry Pi:
     $ sudo raspi-config
     Go to: 3 Interface Options -> I6 Serial Port
     Question: "Would you like a login shell to be accessible over serial?" -> NO
     Question: "Would you like the serial port hardware to be enabled?"     -> YES
     Exit and reboot:
     $ sudo reboot

2. Verify Serial Stream:
     $ cat /dev/serial0
     You should see text lines starting with $GP... or $GN...

3. Install Python Dependencies:
     $ pip install pyserial
     (or: sudo apt update && sudo apt install python3-serial)
========================================================================================

Usage:
  python3 gps_neo6m_pi.py                 # Clean interactive live display
  python3 gps_neo6m_pi.py --raw           # Print raw NMEA sentences alongside decoded data
  python3 gps_neo6m_pi.py --json          # Output one JSON object per second (pipeline friendly)
  python3 gps_neo6m_pi.py --mock          # Test parser with simulated GPS data (no hardware needed)
"""

import sys
import time
import argparse
import json
from datetime import datetime
from typing import Optional, Dict, Any, Tuple

try:
    import serial
except ImportError:
    serial = None  # Handled gracefully in get_serial_connection()


# ── NMEA Coordinate & Data Helpers ──────────────────────────────────────────────────

def parse_nmea_lat_lng(coord_str: str, direction: str) -> Optional[float]:
    """
    Convert NMEA degree-minute coordinate format to Decimal Degrees.
    
    Format:
      Latitude:  DDMM.MMMM (e.g., '1255.2218', 'N') -> 12 + 55.2218/60 = 12.920363
      Longitude: DDDMM.MMMM (e.g., '08007.8998', 'E') -> 80 + 07.8998/60 = 80.131663
      
    Args:
        coord_str: The raw NMEA coordinate string from the sentence.
        direction: 'N', 'S', 'E', or 'W'.
        
    Returns:
        Decimal degree float (negative for S/W), or None if parsing fails.
    """
    if not coord_str or not direction or len(coord_str) < 4:
        return None
    try:
        # Latitude has 2 degree digits before MM.MMMM; Longitude has 3 degree digits
        if direction in ('N', 'S'):
            deg_len = 2
        elif direction in ('E', 'W'):
            deg_len = 3
        else:
            return None

        # Handle potential zero-padding issues gracefully
        if len(coord_str.split('.')[0]) <= deg_len:
            # Fallback split if standard formatting slightly deviates
            deg_len = len(coord_str.split('.')[0]) - 2

        degrees = float(coord_str[:deg_len])
        minutes = float(coord_str[deg_len:])
        decimal_degrees = degrees + (minutes / 60.0)

        if direction in ('S', 'W'):
            decimal_degrees = -decimal_degrees

        return round(decimal_degrees, 6)
    except (ValueError, IndexError):
        return None


def calculate_nmea_checksum(sentence: str) -> str:
    """
    Calculate two-character hex XOR checksum of an NMEA string (between '$' and '*').
    """
    checksum = 0
    for char in sentence:
        checksum ^= ord(char)
    return f"{checksum:02X}"


def verify_nmea_checksum(line: str) -> bool:
    """
    Verify if an NMEA sentence has a valid XOR checksum after '*'.
    If no '*' is present, returns False unless running in lenient mode.
    """
    if not line.startswith('$'):
        return False
    parts = line[1:].split('*')
    if len(parts) != 2:
        return False
    body, expected_checksum = parts[0], parts[1].strip().upper()
    return calculate_nmea_checksum(body) == expected_checksum


# ── NMEA Parser Class ───────────────────────────────────────────────────────────────

class NMEAParser:
    """
    Parses NMEA sentences ($GPGGA, $GPRMC, $GPVTG, $GPGSA, etc.) from the NEO-6M GPS.
    Maintains current live state of GPS telemetry.
    """

    def __init__(self):
        self.state: Dict[str, Any] = {
            "lat": None,
            "lng": None,
            "altitude_m": None,
            "speed_kmh": 0.0,
            "speed_knots": 0.0,
            "sats": 0,
            "fix": False,
            "fix_quality": 0,       # 0=Invalid, 1=GPS Fix (SPS), 2=DGPS
            "fix_type": "No Fix",   # Text description
            "utc_time": None,       # HH:MM:SS UTC
            "utc_date": None,       # YYYY-MM-DD
            "pdop": None,           # Position Dilution of Precision
            "last_sentence_ts": 0.0,
            "sentences_processed": 0,
            "sentences_failed": 0
        }

    def parse_sentence(self, raw_line: str) -> bool:
        """
        Parse a single NMEA string and update state.
        Returns True if a known sentence was successfully parsed.
        """
        line = raw_line.strip()
        if not line.startswith('$'):
            return False

        # Optional strict checksum check
        if '*' in line and not verify_nmea_checksum(line):
            self.state["sentences_failed"] += 1
            return False

        body = line[1:].split('*')[0]
        fields = body.split(',')
        if not fields:
            return False

        sentence_id = fields[0]
        self.state["sentences_processed"] += 1
        self.state["last_sentence_ts"] = time.time()

        # Handle u-blox multi-GNSS prefixes ($GP, $GN, $GL, $GA)
        if len(sentence_id) >= 5 and sentence_id[:2] in ('GP', 'GN', 'GL', 'GA'):
            msg_type = sentence_id[2:]
        else:
            msg_type = sentence_id

        try:
            if msg_type == 'GGA':
                self._parse_gga(fields)
                return True
            elif msg_type == 'RMC':
                self._parse_rmc(fields)
                return True
            elif msg_type == 'VTG':
                self._parse_vtg(fields)
                return True
            elif msg_type == 'GSA':
                self._parse_gsa(fields)
                return True
        except Exception:
            self.state["sentences_failed"] += 1
            return False

        return False

    def _parse_gga(self, fields: list):
        """Parse $GPGGA (Global Positioning System Fix Data)"""
        # [0]=$GPGGA, [1]=UTC Time, [2]=Lat, [3]=N/S, [4]=Lng, [5]=E/W, [6]=Fix quality, [7]=Sat count, [8]=HDOP, [9]=Altitude, ...
        if len(fields) < 10:
            return

        # UTC Time
        if fields[1] and len(fields[1]) >= 6:
            t = fields[1]
            self.state["utc_time"] = f"{t[0:2]}:{t[2:4]}:{t[4:6]}"

        # Fix quality
        try:
            fq = int(fields[6]) if fields[6] else 0
            self.state["fix_quality"] = fq
            self.state["fix"] = (fq > 0)
            if fq == 0:
                self.state["fix_type"] = "No Fix"
            elif fq == 1:
                self.state["fix_type"] = "3D Fix (GPS)"
            elif fq == 2:
                self.state["fix_type"] = "DGPS Fix"
            else:
                self.state["fix_type"] = f"Fix Mode {fq}"
        except ValueError:
            self.state["fix"] = False
            self.state["fix_quality"] = 0

        # Satellites
        try:
            self.state["sats"] = int(fields[7]) if fields[7] else 0
        except ValueError:
            pass

        # Coordinates & Altitude (only update if fix valid or fields non-empty)
        if fields[2] and fields[3]:
            lat = parse_nmea_lat_lng(fields[2], fields[3])
            if lat is not None:
                self.state["lat"] = lat
        if fields[4] and fields[5]:
            lng = parse_nmea_lat_lng(fields[4], fields[5])
            if lng is not None:
                self.state["lng"] = lng

        try:
            if fields[9]:
                self.state["altitude_m"] = round(float(fields[9]), 1)
        except ValueError:
            pass

    def _parse_rmc(self, fields: list):
        """Parse $GPRMC (Recommended Minimum Specific GNSS Data)"""
        # [0]=$GPRMC, [1]=UTC Time, [2]=Status (A/V), [3]=Lat, [4]=N/S, [5]=Lng, [6]=E/W, [7]=Speed knots, [8]=Track angle, [9]=Date (DDMMYY), ...
        if len(fields) < 10:
            return

        # UTC Time
        if fields[1] and len(fields[1]) >= 6:
            t = fields[1]
            self.state["utc_time"] = f"{t[0:2]}:{t[2:4]}:{t[4:6]}"

        # Status: 'A' = Active (Fix valid), 'V' = Void (No Fix)
        status = fields[2].upper()
        if status == 'A':
            self.state["fix"] = True
            if self.state["fix_quality"] == 0:
                self.state["fix_quality"] = 1
                self.state["fix_type"] = "3D Fix (GPS)"
        elif status == 'V':
            self.state["fix"] = False
            self.state["fix_quality"] = 0
            self.state["fix_type"] = "No Fix (Status V)"

        # Coordinates
        if fields[3] and fields[4]:
            lat = parse_nmea_lat_lng(fields[3], fields[4])
            if lat is not None:
                self.state["lat"] = lat
        if fields[5] and fields[6]:
            lng = parse_nmea_lat_lng(fields[5], fields[6])
            if lng is not None:
                self.state["lng"] = lng

        # Speed (knots -> km/h)
        try:
            if fields[7]:
                knots = float(fields[7])
                self.state["speed_knots"] = round(knots, 1)
                self.state["speed_kmh"] = round(knots * 1.852, 1)
        except ValueError:
            pass

        # Date
        if fields[9] and len(fields[9]) == 6:
            d = fields[9]
            # DDMMYY -> YYYY-MM-DD (assuming 20xx)
            self.state["utc_date"] = f"20{d[4:6]}-{d[2:4]}-{d[0:2]}"

    def _parse_vtg(self, fields: list):
        """Parse $GPVTG (Course Over Ground & Ground Speed)"""
        # Usually: [1]=True track, [2]='T', [3]=Mag track, [4]='M', [5]=Speed knots, [6]='N', [7]=Speed kmh, [8]='K'
        for i in range(len(fields) - 1):
            if fields[i] == 'K' and i > 0 and fields[i - 1]:
                try:
                    self.state["speed_kmh"] = round(float(fields[i - 1]), 1)
                except ValueError:
                    pass
            elif fields[i] == 'N' and i > 0 and fields[i - 1]:
                try:
                    self.state["speed_knots"] = round(float(fields[i - 1]), 1)
                except ValueError:
                    pass

    def _parse_gsa(self, fields: list):
        """Parse $GPGSA (GNSS DOP and Active Satellites)"""
        # [0]=$GPGSA, [1]=Mode 1 (M/A), [2]=Mode 2 (1=No fix, 2=2D, 3=3D), [3..14]=Sats used, [15]=PDOP, [16]=HDOP, [17]=VDOP
        if len(fields) >= 16 and fields[15]:
            try:
                self.state["pdop"] = round(float(fields[15]), 2)
            except ValueError:
                pass

    def get_telemetry_dict(self) -> Dict[str, Any]:
        """Return current snapshot matching MESSAGE_SCHEMA.md telemetry.gps specifications."""
        return {
            "lat": self.state["lat"],
            "lng": self.state["lng"],
            "speed_kmh": self.state["speed_kmh"],
            "altitude_m": self.state["altitude_m"],
            "sats": self.state["sats"],
            "fix": self.state["fix"],
            "fix_type": self.state["fix_type"],
            "utc_time": self.state["utc_time"],
            "utc_date": self.state["utc_date"]
        }


# ── Serial Connection & Auto-Baud Diagnostics Management ────────────────────────
def scan_and_diagnose_serial(port: str, requested_baud: int, timeout: float = 1.0):
    """
    Perform deep diagnostic scanning across multiple baud rates on the Raspberry Pi
    to detect exact framing errors (\x00 null bytes), baud rate mismatches, or live NMEA streams.
    """
    if serial is None:
        print("\n[ERROR] Python package 'pyserial' is not installed.")
        print("To install it, run:\n    pip install pyserial\nor:\n    sudo apt update && sudo apt install python3-serial\n")
        sys.exit(1)

    # Prioritize requested baud, then check the most common u-blox factory rates
    baud_candidates = [requested_baud] + [b for b in [9600, 38400, 115200, 4800, 19200, 57600] if b != requested_baud]
    
    print(f"\n\033[1m========================================================================\033[0m")
    print(f"\033[1m  LUS CAR AUTOMATION — RASPBERRY PI GPS DEEP DIAGNOSTIC & AUTO-SCAN  \033[0m")
    print(f"\033[1m========================================================================\033[0m")
    print(f"[INFO] Target Port: {port} | Primary Requested Speed: {requested_baud} baud\n")

    for baud in baud_candidates:
        print(f"\033[96m─── [TESTING BAUD RATE: {baud} BPS] ───\033[0m")
        try:
            ser = serial.Serial(
                port=port,
                baudrate=baud,
                bytesize=serial.EIGHTBITS,
                parity=serial.PARITY_NONE,
                stopbits=serial.STOPBITS_ONE,
                timeout=0.3
            )
            ser.reset_input_buffer()
        except serial.SerialException as e:
            print(f"\033[91m[ERROR] Could not open {port} at {baud}: {e}\033[0m\n")
            continue

        start_ts = time.time()
        raw_bytes = bytearray()
        valid_nmea_lines = []

        # Sample for 1.2 seconds at this baud rate
        while time.time() - start_ts < 1.2:
            if ser.in_waiting > 0:
                chunk = ser.read(ser.in_waiting)
                raw_bytes.extend(chunk)
                
                # Try decoding as ASCII to spot $GP / $GN prefixes
                text_try = raw_bytes.decode('ascii', errors='replace')
                for line in text_try.split('\n'):
                    line = line.strip()
                    if any(line.startswith(prefix) for prefix in ('$GP', '$GN', '$GL', '$GA', '$GB')):
                        valid_nmea_lines.append(line)
            time.sleep(0.05)

        byte_count = len(raw_bytes)
        if byte_count == 0:
            print(f"  [\033[93mRESULT\033[0m] 0 Bytes Received (Silence)")
            ser.close()
        else:
            hex_dump = " ".join(f"{b:02X}" for b in raw_bytes[:24])
            ascii_dump = "".join(chr(b) if 32 <= b <= 126 else "." for b in raw_bytes[:24])
            print(f"  [\033[92mRESULT\033[0m] Received {byte_count} total bytes.")
            print(f"  \033[1mRaw Hex Dump (First 24B):\033[0m {hex_dump}")
            print(f"  \033[1mRaw ASCII Sample:\033[0m         {ascii_dump}")

            if valid_nmea_lines:
                print(f"\n  \033[92m\033[1m★ SUCCESS! VALID NMEA SENTENCES DETECTED AT {baud} BAUD! ★\033[0m")
                for l in valid_nmea_lines[:2]:
                    print(f"    -> \033[92m{l}\033[0m")
                print(f"\033[1m========================================================================\033[0m\n")
                ser.timeout = timeout
                return ser, baud
            elif all(b == 0x00 for b in raw_bytes):
                print(f"  [\033[91mDIAGNOSIS\033[0m] 100% NULL BYTES (0x00 / \\0\\0\\0 boxes).")
                print(f"              -> This happens when the GPS is running at a HIGHER baud rate,")
                print(f"                 or if the GND wire isn't making solid contact. Scanning next speed...")
            else:
                print(f"  [\033[93mDIAGNOSIS\033[0m] Garbled framing bytes. Speed mismatch. Scanning next speed...")
            ser.close()
        print()

    print(f"\033[91m\033[1m[CRITICAL WARNING] No clean NMEA sentences ($GP...) found across all speeds.\033[0m")
    print("Defaulting back to requested speed. If only \\0\\0\\0 boxes appear, double-check your GND wire!")
    ser = serial.Serial(port, requested_baud, timeout=timeout)
    return ser, requested_baud


# ── Simulated / Mock GPS Stream (For testing without hardware) ──────────────────────

def get_mock_nmea_stream():
    """
    Yields realistic simulated NMEA sentences ($GPGGA and $GPRMC) from a NEO-6M.
    Starts with 'No Fix' (like turning on outdoors) then transitions to '3D Fix achieved'.
    """
    no_fix_sentences = [
        "$GPGGA,120000.00,,,,,0,00,99.99,,,,,,*68",
        "$GPRMC,120000.00,V,,,,,,,150726,,,N*7D",
        "$GPVTG,,,,,,,,,N*30"
    ]
    acquiring_sentences = [
        "$GPGGA,120015.00,,,,,0,03,5.40,,,,,,*52",
        "$GPRMC,120015.00,V,,,,,,,150726,,,N*75"
    ]
    fix_sentences = [
        "$GPGGA,120030.00,1255.2218,N,08007.8998,E,1,07,1.10,14.5,M,-85.0,M,,*4A",
        "$GPRMC,120030.00,A,1255.2218,N,08007.8998,E,32.4,142.0,150726,,,A*64",
        "$GPVTG,142.0,T,,M,32.4,N,60.0,K,A*23"
    ]

    print("[MOCK MODE] Simulating NEO-6M GPS startup sequence...")
    print("[MOCK MODE] (Next 4 seconds: waiting for satellites without fix -> then Fix achieved!)\n")

    start_ts = time.time()
    while True:
        elapsed = time.time() - start_ts
        if elapsed < 2.0:
            for s in no_fix_sentences:
                yield s
                time.sleep(0.3)
        elif elapsed < 4.0:
            for s in acquiring_sentences:
                yield s
                time.sleep(0.3)
        else:
            dt = int(time.time() - start_ts)
            lat_min = 55.2218 + (dt % 10) * 0.0002
            lng_min = 7.8998 + (dt % 10) * 0.0003
            gga = f"$GPGGA,1201{dt:02d}.00,12{lat_min:07.4f},N,080{lng_min:07.4f},E,1,08,0.95,15.2,M,-85.0,M,,"
            gga_chk = calculate_nmea_checksum(gga)
            
            rmc = f"$GPRMC,1201{dt:02d}.00,A,12{lat_min:07.4f},N,080{lng_min:07.4f},E,33.5,145.2,150726,,,A"
            rmc_chk = calculate_nmea_checksum(rmc)
            
            yield f"{gga}*{gga_chk}"
            time.sleep(0.5)
            yield f"{rmc}*{rmc_chk}"
            time.sleep(0.5)


# ── Output Dashboard Formatting ─────────────────────────────────────────────────────

def format_live_dashboard(parser: NMEAParser, last_raw: str, active_baud: int, is_mock: bool = False):
    """
    Print a clean, refreshing ASCII status display of the GPS telemetry with diagnostic info.
    """
    d = parser.get_telemetry_dict()
    fix_status = d["fix"]
    
    CLEAR_SCREEN = "\033[2J\033[H"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    RED = "\033[91m"
    CYAN = "\033[96m"
    BOLD = "\033[1m"
    RESET = "\033[0m"

    mode_tag = f"{YELLOW}[MOCK SIMULATION]{RESET}" if is_mock else f"{CYAN}[LIVE HARDWARE @ {active_baud} BPS]{RESET}"

    print(CLEAR_SCREEN, end="")
    print(f"{BOLD}========================================================================{RESET}")
    print(f"{BOLD}  LUS CAR AUTOMATION — RASPBERRY PI NEO-6M GPS SENSOR READER {RESET}")
    print(f"{BOLD}========================================================================{RESET}")
    print(f"Mode: {mode_tag} | Sentences Read: {parser.state['sentences_processed']}")
    print(f"Last NMEA Sentence: {CYAN}{last_raw[:65]}{RESET}")
    print("-" * 72)

    if fix_status:
        status_banner = f"{GREEN}{BOLD}● SATELLITE FIX ACHIEVED (LED on module should be BLINKING){RESET}"
    else:
        status_banner = f"{YELLOW}{BOLD}○ WAITING FOR SATELLITE FIX... (LED on module solid / OFF){RESET}"
    print(status_banner)
    print("-" * 72)

    if fix_status and d["lat"] is not None and d["lng"] is not None:
        print(f"  {BOLD}Latitude:{RESET}    {GREEN}{d['lat']:.6f} °{RESET}")
        print(f"  {BOLD}Longitude:{RESET}   {GREEN}{d['lng']:.6f} °{RESET}")
        print(f"  {BOLD}Altitude:{RESET}    {d['altitude_m'] if d['altitude_m'] is not None else '--'} m")
        print(f"  {BOLD}Speed:{RESET}       {d['speed_kmh']:.1f} km/h")
        print(f"  {BOLD}Satellites:{RESET}  {GREEN}{d['sats']}{RESET} connected")
        print(f"  {BOLD}Fix Quality:{RESET} {d['fix_type']}")
        print(f"  {BOLD}UTC Time:{RESET}    {d['utc_time'] or '--:--:--'} ({d['utc_date'] or 'YYYY-MM-DD'})")
    else:
        print(f"  {YELLOW}Status Details:{RESET}")
        print(f"    • Satellites in view: {d['sats']} (Requires >= 3 for 2D fix, >= 4 for 3D fix)")
        print(f"    • Fix state:          {d['fix_type']}")
        print(f"    • UTC Time:           {d['utc_time'] or 'Syncing...'}")
        print("\n  [TIPS WHILE WAITING FOR FIRST FIX outdoors or near a window]:")
        print("    1. First fix ('Cold Start') can take 1 to 5 minutes outdoors.")
        print("    2. Ensure the ceramic patch antenna is securely snapped onto the module.")
        print("    3. Ensure the antenna is facing UP towards the open sky.")
        print("    4. If text ($GP...) is streaming above, your wiring is 100% correct!")
    print(f"{BOLD}========================================================================{RESET}")
    print("Press Ctrl+C to stop reading.")


# ── Main Entry Point ────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Raspberry Pi NEO-6M GPS Reader & Telemetry Decoder with Auto-Baud Diagnostics"
    )
    parser.add_argument(
        "-p", "--port",
        default="/dev/serial0",
        help="Serial port for NEO-6M GPS (default: /dev/serial0)"
    )
    parser.add_argument(
        "-b", "--baudrate",
        type=int,
        default=9600,
        help="Target baud rate for GPS module (default: 9600)"
    )
    parser.add_argument(
        "-r", "--raw",
        action="store_true",
        help="Print deep diagnostic raw NMEA logs with timestamps alongside decoded output"
    )
    parser.add_argument(
        "-j", "--json",
        action="store_true",
        help="Output JSON object per second matching MESSAGE_SCHEMA.md telemetry.gps"
    )
    parser.add_argument(
        "-m", "--mock",
        action="store_true",
        help="Run in simulated mock mode without physical GPS hardware"
    )
    parser.add_argument(
        "--no-scan",
        action="store_true",
        help="Disable automatic baud-rate scanning on startup"
    )

    args = parser.parse_args()
    nmea_parser = NMEAParser()
    active_baud = args.baudrate

    if args.mock:
        stream = get_mock_nmea_stream()
        ser = None
    else:
        if args.no_scan:
            print(f"Opening serial port {args.port} directly at {args.baudrate} baud...")
            ser = serial.Serial(args.port, args.baudrate, timeout=1.0)
        else:
            ser, active_baud = scan_and_diagnose_serial(args.port, args.baudrate)

    last_display_time = 0.0
    last_raw_sentence = ""

    try:
        while True:
            if args.mock:
                line = next(stream)
            else:
                try:
                    raw_bytes = ser.readline()
                    # Try clean decoding, if garbled preserve hex/null indication
                    try:
                        line = raw_bytes.decode('ascii').strip()
                    except UnicodeDecodeError:
                        if all(b == 0x00 for b in raw_bytes if b != 0x0A and b != 0x0D):
                            line = f"\\0\\0\\0 [NULL BOXES: {len(raw_bytes)} bytes @ {active_baud} baud]"
                        else:
                            line = f"[GARBLED HEX: {' '.join(f'{b:02X}' for b in raw_bytes[:16])}]"
                except Exception:
                    time.sleep(0.1)
                    continue

            if not line:
                continue

            last_raw_sentence = line
            parsed = nmea_parser.parse_sentence(line)

            # Option 1: Deep Diagnostic / Raw Log mode (--raw)
            if args.raw:
                ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
                if parsed:
                    d = nmea_parser.get_telemetry_dict()
                    status_tag = "\033[92m[★ 3D FIX ★]\033[0m" if d['fix'] else "\033[93m[NO FIX YET]\033[0m"
                    print(f"[{ts}] \033[96mRAW:\033[0m {line:<62} {status_tag} Sats:{d['sats']} Lat:{d['lat']} Lng:{d['lng']}")
                else:
                    print(f"[{ts}] \033[93mRAW LOG:\033[0m {line}")

            # Option 2: JSON streaming mode (--json)
            elif args.json:
                now = time.time()
                if now - last_display_time >= 1.0:
                    d = nmea_parser.get_telemetry_dict()
                    payload = {
                        "ts": int(now * 1000),
                        "gps": d
                    }
                    print(json.dumps(payload))
                    last_display_time = now

            # Option 3: Clean interactive dashboard display (default)
            else:
                now = time.time()
                if now - last_display_time >= 0.5:
                    format_live_dashboard(nmea_parser, last_raw_sentence, active_baud, is_mock=args.mock)
                    last_display_time = now

    except KeyboardInterrupt:
        print("\n[INFO] Stopped GPS reader by user (Ctrl+C). Exiting cleanly.")
        if ser and ser.is_open:
            ser.close()
        sys.exit(0)


if __name__ == "__main__":
    main()

