#!/usr/bin/env python3
"""Shared Strava API utilities.

Consolidates token management, api_get, and api_put so that
fetch_strava.py, rename_single.py, and the sync pipeline all
share one implementation.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional, Union

try:
    import requests
except ImportError:
    sys.exit("Missing 'requests' package. Run: pip3 install requests")

# ─── Paths ────────────────────────────────────────────────────────────────

REPO_DIR = Path(__file__).resolve().parent.parent
REPO_TOKENS_PATH = REPO_DIR / "strava" / "strava_tokens.json"
HOME_TOKENS_PATH = Path.home() / "strava_tokens.json"

BASE_URL = "https://www.strava.com/api/v3"


# ─── Token management ────────────────────────────────────────────────────

def _tokens_path() -> Path:
    """Prefer repo copy, fall back to home dir."""
    return REPO_TOKENS_PATH if REPO_TOKENS_PATH.exists() else HOME_TOKENS_PATH


def load_tokens() -> dict:
    """Load Strava tokens from disk."""
    path = _tokens_path()
    if not path.exists():
        sys.exit(f"Token file not found at {path}. Run OAuth flow first.")
    return json.loads(path.read_text())


def save_tokens(tokens: dict) -> None:
    """Save tokens to repo (primary) and home dir (fallback).

    In CI (CI=true env var), only git-add the token file — the pipeline's
    final commit step will include it. Locally, auto-commit + push.
    """
    token_data = json.dumps(tokens, indent=2) + "\n"
    REPO_TOKENS_PATH.write_text(token_data)
    HOME_TOKENS_PATH.write_text(token_data)

    try:
        subprocess.run(
            ["git", "add", str(REPO_TOKENS_PATH)],
            cwd=REPO_DIR, capture_output=True, timeout=10,
        )
        if not os.environ.get("CI"):
            subprocess.run(
                ["git", "commit", "-m", "auto: refresh strava token"],
                cwd=REPO_DIR, capture_output=True, timeout=10,
            )
            subprocess.run(
                ["git", "push"],
                cwd=REPO_DIR, capture_output=True, timeout=30,
            )
    except Exception:
        pass  # Non-fatal — token is saved locally regardless


def refresh_if_needed(tokens: dict) -> dict:
    """Refresh the access token if it expires within 5 minutes."""
    if time.time() >= tokens["expires_at"] - 300:
        r = requests.post("https://www.strava.com/oauth/token", data={
            "client_id": tokens["client_id"],
            "client_secret": tokens["client_secret"],
            "grant_type": "refresh_token",
            "refresh_token": tokens["refresh_token"],
        })
        r.raise_for_status()
        data = r.json()
        tokens["access_token"] = data["access_token"]
        tokens["refresh_token"] = data["refresh_token"]
        tokens["expires_at"] = data["expires_at"]
        save_tokens(tokens)
    return tokens


# ─── API helpers ──────────────────────────────────────────────────────────

def api_get(
    tokens: dict, path: str, params: Optional[dict] = None
) -> Union[dict, list]:
    """GET with automatic rate-limit retry."""
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    while True:
        r = requests.get(f"{BASE_URL}{path}", headers=headers, params=params)
        if r.status_code == 429:
            wait = int(r.headers.get("Retry-After", 900))
            print(f"  Rate limited. Waiting {wait}s...", file=sys.stderr)
            time.sleep(wait)
            tokens = refresh_if_needed(tokens)
            headers = {"Authorization": f"Bearer {tokens['access_token']}"}
            continue
        r.raise_for_status()
        return r.json()


def api_put(tokens: dict, path: str, data: dict) -> dict:
    """PUT with automatic rate-limit retry."""
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    while True:
        r = requests.put(f"{BASE_URL}{path}", headers=headers, json=data)
        if r.status_code == 429:
            wait = int(r.headers.get("Retry-After", 900))
            print(f"  Rate limited. Waiting {wait}s...", file=sys.stderr)
            time.sleep(wait)
            tokens = refresh_if_needed(tokens)
            headers = {"Authorization": f"Bearer {tokens['access_token']}"}
            continue
        r.raise_for_status()
        return r.json()
