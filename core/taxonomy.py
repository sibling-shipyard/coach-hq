"""Badminton activity taxonomy — single source for rename + analytics."""

from __future__ import annotations

import re
from typing import Final

# Sport type
BADMINTON_SPORT: Final = "Badminton"

# Rename categories (strava/rename_core.py classify_activity)
RENAME_LEAGUE: Final = "league"
RENAME_DRILLS: Final = "drills"
RENAME_HITRUN_RANKED: Final = "hitrun_ranked"
RENAME_HITRUN_FRIENDLY: Final = "hitrun_friendly"
RENAME_BADMINTON_CASUAL: Final = "badminton_casual"

# Analytics categories (plugins/badminton/analytics.py)
BADMINTON_LEAGUE: Final = "badminton_league"
BADMINTON_RANKED: Final = "badminton_ranked"
BADMINTON_FRIENDLY: Final = "badminton_friendly"
BADMINTON_CASUAL: Final = "badminton_casual"

BADMINTON_CATEGORIES = {
    BADMINTON_RANKED,
    BADMINTON_LEAGUE,
    BADMINTON_FRIENDLY,
    BADMINTON_CASUAL,
}


def get_training_category(activity: dict) -> str:
    """Classify activity into a training category (Python port of dashboard TS logic)."""
    name = activity.get("name", "")
    sport = activity.get("sport_type", activity.get("type", ""))

    if re.match(r"^League\s*#", name, re.IGNORECASE):
        return BADMINTON_LEAGUE
    if re.match(r"^Hit\s*&\s*Run\s*#", name, re.IGNORECASE):
        if re.search(r"ranked", name, re.IGNORECASE):
            return BADMINTON_RANKED
        if re.search(r"friendly", name, re.IGNORECASE):
            return BADMINTON_FRIENDLY
        return BADMINTON_RANKED  # default H&R to ranked
    if re.match(r"^Badminton:", name, re.IGNORECASE):
        return BADMINTON_CASUAL
    if sport == BADMINTON_SPORT:
        return BADMINTON_CASUAL
    return "other"
