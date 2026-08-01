"""Badminton activity taxonomy — single source for rename + analytics."""

from __future__ import annotations

from typing import Final

# Sport type
BADMINTON_SPORT: Final = "Badminton"

# Rename categories (rename_core.py classify_activity, same directory)
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


from datetime import datetime
from typing import Optional, List, Dict

def get_training_category(activity: dict, config: Optional[List[Dict]] = None) -> str:
    """Classify activity into a training category (Python port of dashboard TS logic)."""
    cat = activity.get("category")
    if cat and len(cat) == 3 and cat.isupper():
        return cat
        
    if config is not None:
        try:
            from .category_resolver import resolve_from_activity
        except ImportError:
            from category_resolver import resolve_from_activity
        return resolve_from_activity(activity, config)
        
    if cat:
        return BADMINTON_CASUAL if cat == "badminton" else cat

    sport = activity.get("sport_type", activity.get("type", ""))
    start = activity.get("start_date_local", "")
    if start:
        dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
    else:
        dt = datetime.now()
    dow = dt.weekday()
    dur_sec = activity.get("elapsed_time", 0)

    if sport == "WeightTraining":
        return "foundation" if dur_sec < 1500 else "calisthenics"
    elif sport == "Yoga":
        return "realign" if dow == 6 else "recovery"
    elif sport == "Badminton":
        return BADMINTON_CASUAL
    elif sport == "Run":
        return "run"
    elif sport == "Ride":
        return "ride"
    elif sport == "Swim":
        return "swim"
    
    return sport.lower() if sport else "other"
