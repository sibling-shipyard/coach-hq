#!/usr/bin/env python3
"""Authorize (or re-authorize) Strava with activity:write scope.

First-time setup: reads STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET from .env.
Re-authorization: reads from strava/strava_tokens.json if it already exists.

Steps:
1. Opens a local server on port 8765
2. User visits the auth URL and grants permission
3. Strava redirects back with auth code
4. Script exchanges code for tokens and saves them
"""

import json
import os
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from pathlib import Path

import requests

TOKENS_PATH = Path(__file__).resolve().parent / "strava_tokens.json"
REPO_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = REPO_DIR / ".env"


def load_env_file(path: Path) -> dict:
    """Parse a .env file into a dict."""
    env = {}
    if not path.exists():
        return env
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip()
    return env


# Load credentials — prefer existing tokens file, fall back to .env
if TOKENS_PATH.exists():
    _tokens = json.loads(TOKENS_PATH.read_text())
    CLIENT_ID = str(_tokens["client_id"])
    CLIENT_SECRET = _tokens["client_secret"]
else:
    _env = load_env_file(ENV_PATH)
    CLIENT_ID = os.environ.get("STRAVA_CLIENT_ID") or _env.get("STRAVA_CLIENT_ID", "")
    CLIENT_SECRET = os.environ.get("STRAVA_CLIENT_SECRET") or _env.get("STRAVA_CLIENT_SECRET", "")
    if not CLIENT_ID or not CLIENT_SECRET:
        sys.exit(
            "No credentials found.\n"
            "Copy .env.example to .env and fill in STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET."
        )

REDIRECT_URI = "http://localhost:8765/callback"
SCOPE = "activity:read_all,activity:write"

AUTH_URL = (
    f"https://www.strava.com/oauth/authorize"
    f"?client_id={CLIENT_ID}"
    f"&redirect_uri={REDIRECT_URI}"
    f"&response_type=code"
    f"&scope={SCOPE}"
    f"&approval_prompt=auto"
)

print(f"\n=== Strava Authorization ===")
print(f"\nOpen this URL in your browser:\n")
print(AUTH_URL)
print(f"\nWaiting for callback on port 8765...\n")


class CallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path != "/callback":
            self.send_response(404)
            self.end_headers()
            return

        params = parse_qs(parsed.query)
        code = params.get("code", [None])[0]
        scope = params.get("scope", [""])[0]

        if not code:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b"No code received.")
            return

        # Exchange code for tokens
        r = requests.post("https://www.strava.com/oauth/token", data={
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "code": code,
            "grant_type": "authorization_code",
        })
        r.raise_for_status()
        data = r.json()

        new_tokens = {
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "access_token": data["access_token"],
            "refresh_token": data["refresh_token"],
            "expires_at": data["expires_at"],
        }

        TOKENS_PATH.write_text(json.dumps(new_tokens, indent=2) + "\n")
        # Also save to home dir
        (Path.home() / "strava_tokens.json").write_text(json.dumps(new_tokens, indent=2) + "\n")

        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(b"<h1>Done!</h1><p>Tokens saved. You can close this tab.</p>")

        print(f"\nScope granted: {scope}")
        print(f"Tokens saved to {TOKENS_PATH}")
        print("You can stop this server now (Ctrl+C).")

        # Shutdown after handling
        import threading
        threading.Thread(target=self.server.shutdown).start()

    def log_message(self, format, *args):
        pass  # Suppress default logging


server = HTTPServer(("0.0.0.0", 8765), CallbackHandler)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
server.server_close()
