"""TEST ONLY CONNECT-status fixture, NOT a TLS tunnel or model provider."""
import json
from pathlib import Path
import socketserver


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        self.connection.settimeout(3)
        line = self.rfile.readline(4096).decode('ascii', errors='replace').strip()
        accepted = line == 'CONNECT opencode.ai:443 HTTP/1.1'
        # Record only the allowlisted decision, never arbitrary headers.
        with Path('/evidence/v1-reachability.jsonl').open('a') as log:
            log.write(json.dumps({'opencode_connect': accepted}) + '\n')
        self.wfile.write(b'HTTP/1.1 200 Connection established\r\n\r\n' if accepted
                         else b'HTTP/1.1 502 Bad Gateway\r\n\r\n')


with socketserver.ThreadingTCPServer(('127.0.0.1', 18829), Handler) as server:
    Path('/evidence/v1-reachability-ready').touch()
    server.serve_forever()
