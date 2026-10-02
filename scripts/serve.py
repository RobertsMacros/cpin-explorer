"""Serve the repository for the prototypes: python3 scripts/serve.py [port]

Python's `http.server` queues only 5 pending connections, so a page that opens a dozen requests
at once (fonts, data, map, flags) sees some of them refused as "Failed to fetch". This raises the
queue and otherwise behaves the same.
"""
import functools
import http.server
import sys
from pathlib import Path


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 128
    daemon_threads = True


class Handler(http.server.SimpleHTTPRequestHandler):
    # Revalidate every time (a cheap 304 when nothing changed), so an edited script is never stale.
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8781
    root = Path(__file__).resolve().parents[1]
    handler = functools.partial(Handler, directory=str(root))
    with Server(("127.0.0.1", port), handler) as httpd:
        print(f"serving {root} at http://localhost:{port}/", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
