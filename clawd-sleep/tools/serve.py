#!/usr/bin/env python3
"""Tiny static server for the web app.  python3 tools/serve.py [port]"""
import functools, http.server, os, socketserver, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")


class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".webmanifest": "application/manifest+json"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), functools.partial(H, directory=ROOT)) as httpd:
        print(f"clawd sleep -> http://localhost:{PORT}/  (root {ROOT})")
        httpd.serve_forever()
