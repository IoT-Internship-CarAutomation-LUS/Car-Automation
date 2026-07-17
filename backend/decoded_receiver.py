# decoded_receiver.py -- LUS Car Automation
# Bench-test TCP receiver: listens for the 32-byte packets elm327_bt.py's
# --tcp flag sends, decodes each one with obd_decoder.unpack_packet(), and
# prints a clean one-line readout. A failed CRC prints a WARNING instead of
# being silently trusted.
#
# This is a separate, simpler direct link from the Pi to the laptop -- not
# the --stream WebSocket path to the backend.
#
# Usage:
#   python decoded_receiver.py [port]      (default port 9000)

import socket
import sys

from obd_decoder import unpack_packet

PACKET_SIZE = 32
DEFAULT_PORT = 9000


def recv_exact(conn: socket.socket, size: int) -> bytes:
    """Read exactly `size` bytes, or return b"" if the connection closed early."""
    buf = b""
    while len(buf) < size:
        chunk = conn.recv(size - len(buf))
        if not chunk:
            return b""
        buf += chunk
    return buf


def format_line(decoded: dict) -> str:
    v = decoded["vehicle"]
    g = decoded["gps"]
    return (
        f"RPM={v['rpm']} speed={v['speed_kmh']} coolant={v['coolant_c']} "
        f"fuel={v['fuel_level_pct']} lat={g['lat']} lng={g['lng']} "
        f"fix={g['fix']} crc_valid={decoded['crc_valid']}"
    )


def handle_connection(conn: socket.socket, addr) -> None:
    print(f"[TCP] Connected: {addr[0]}:{addr[1]}")
    try:
        while True:
            packet = recv_exact(conn, PACKET_SIZE)
            if not packet:
                print(f"[TCP] Connection closed by {addr[0]}:{addr[1]}")
                return
            decoded = unpack_packet(packet)
            if not decoded["crc_valid"]:
                print(f"[TCP] WARNING: CRC check failed, packet may be corrupted -- {packet.hex(' ').upper()}")
                continue
            print(format_line(decoded))
    except (ConnectionResetError, OSError) as e:
        print(f"[TCP] Connection dropped ({e}).")
    finally:
        conn.close()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("0.0.0.0", port))
    server.listen(1)
    print(f"[TCP] decoded_receiver listening on 0.0.0.0:{port}")

    try:
        while True:
            print("[TCP] Waiting for a connection...")
            conn, addr = server.accept()
            handle_connection(conn, addr)
    except KeyboardInterrupt:
        print("\n[TCP] Stopped by user.")
    finally:
        server.close()


if __name__ == "__main__":
    main()
