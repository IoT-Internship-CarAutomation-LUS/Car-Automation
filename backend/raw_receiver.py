# raw_receiver.py -- LUS Car Automation
# Bench-test TCP receiver: listens for the 32-byte packets elm327_bt.py's
# --tcp flag sends, and prints the RAW hex of each packet -- nothing decoded,
# nothing trusted, no dependency on obd_decoder.py.
#
# This is a separate, simpler direct link from the Pi to the laptop -- not
# the --stream WebSocket path to the backend. Purpose here is only to prove
# the pipe works and to show genuinely undecoded bytes arriving.
#
# Usage:
#   python raw_receiver.py [port]      (default port 9000)

import socket
import sys

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


def handle_connection(conn: socket.socket, addr) -> None:
    print(f"[TCP] Connected: {addr[0]}:{addr[1]}")
    try:
        while True:
            packet = recv_exact(conn, PACKET_SIZE)
            if not packet:
                print(f"[TCP] Connection closed by {addr[0]}:{addr[1]}")
                return
            print(packet.hex(' ').upper())
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
    print(f"[TCP] raw_receiver listening on 0.0.0.0:{port}")

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
