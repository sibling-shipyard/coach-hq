"""Normalize challenge_v2.json v2 (challenge) and v3 (season) shapes."""
from __future__ import annotations

from datetime import date, datetime


def parse_date(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


def challenge_window(data: dict) -> dict:
    """Return {name, start_date, end_date, duration_days} from v2 or v3 ledger."""
    if "challenge" in data:
        ch = data["challenge"]
        start = parse_date(ch["start_date"])
        end = parse_date(ch["end_date"])
        duration = ch.get("duration_days")
        if duration is None:
            duration = (end - start).days + 1
        return {
            "name": ch["name"],
            "start_date": ch["start_date"],
            "end_date": ch["end_date"],
            "duration_days": duration,
            "label": "Challenge",
        }
    if "season" in data:
        s = data["season"]
        start = parse_date(s["start_date"])
        end = parse_date(s["end_date"])
        return {
            "name": s["name"],
            "start_date": s["start_date"],
            "end_date": s["end_date"],
            "duration_days": (end - start).days + 1,
            "label": "Season",
        }
    raise KeyError("challenge_v2.json must include 'challenge' (v2) or 'season' (v3)")


def season_start_date(data: dict) -> str:
    return challenge_window(data)["start_date"]
