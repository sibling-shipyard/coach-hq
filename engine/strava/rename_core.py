"""Shared renaming rules for Coach Phelps Strava activities.

Used by rename_single.py and rename_activities.py.

Counters reset every calendar year — each category's numbering (Run #N,
Weight Training #N, etc.) starts fresh at #1 for each year, derived from
an activity's start_date_local, not the file it lives in.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Optional, Tuple


def get_activity_year(data: dict) -> int:
    """Extract the calendar year an activity happened in, from start_date_local."""
    start = data.get("start_date_local", "")
    return datetime.fromisoformat(start.replace("Z", "+00:00")).year

# Patterns that indicate an activity has already been renamed
RENAMED_PATTERNS = [
    re.compile(r"^Run #\d+"),
    re.compile(r"^Foundation #\d+"),
    re.compile(r"^Weight Training #\d+"),
    re.compile(r"^Calisthenics #\d+"),
    re.compile(r"^Badminton: Ranked #\d+"),
    re.compile(r"^Badminton: League #\d+"),
    re.compile(r"^Badminton: Friendly #\d+"),
    re.compile(r"^Badminton: Casual #\d+"),
    re.compile(r"^Recovery #\d+"),
    re.compile(r"^Realign #\d+"),
    re.compile(r"^Swim #\d+"),
]

# Patterns to extract counter numbers from existing names
COUNTER_PATTERNS = {
    "run": re.compile(r"^Run #(\d+)"),
    "foundation": re.compile(r"^Foundation #(\d+)"),
    "weight": re.compile(r"^Weight Training #(\d+)"),
    "calisthenics": re.compile(r"^Calisthenics #(\d+)"),
    "badminton_ranked": re.compile(r"^Badminton: Ranked #(\d+)"),
    "badminton_league": re.compile(r"^Badminton: League #(\d+)"),
    "badminton_friendly": re.compile(r"^Badminton: Friendly #(\d+)"),
    "badminton_casual": re.compile(r"^Badminton: Casual #(\d+)"),
    "recovery": re.compile(r"^Recovery #(\d+)"),
    "realign": re.compile(r"^Realign #(\d+)"),
    "swim": re.compile(r"^Swim #(\d+)"),
}

# Sport types to skip (non-training activities)
SKIP_SPORTS = {
    "Ride", "Walk", "Hike", "Surfing", "Kayaking",
    "EBikeRide", "VirtualRun", "VirtualRide", "Workout",
    "Soccer", "Pickleball",
}


def is_already_renamed(name: str) -> bool:
    return any(p.match(name) for p in RENAMED_PATTERNS)


def classify_activity(
    data: dict,
) -> Tuple[str, Optional[str], Optional[str]]:
    """Classify an activity. Returns (category, detail, counter_key).

    Categories:
      run, swim, foundation, weight, recovery, realign,
      badminton_ranked, badminton_league, badminton_friendly, badminton_casual, skip
    """
    sport = data.get("sport_type", data.get("type", ""))
    name = data.get("name", "")
    desc = (data.get("description") or "").lower()
    start = data.get("start_date_local", "")
    dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
    dow = dt.weekday()  # 0=Mon, 6=Sun
    dur_min = data.get("elapsed_time", 0) / 60
    name_lower = name.lower()

    if sport in SKIP_SPORTS:
        return ("skip", None, None)

    if "cricket" in name_lower:
        return ("skip", None, None)

    # Run
    if sport == "Run":
        return ("run", None, "run")

    # Swim
    if sport == "Swim":
        return ("swim", None, "swim")

    # Badminton — classify by keywords in name/description
    if sport == "Badminton":
        if "ranked" in name_lower or "ranked" in desc:
            return ("badminton_ranked", None, "badminton_ranked")
        if "league" in name_lower or "league" in desc:
            return ("badminton_league", None, "badminton_league")
        if "friendly" in name_lower or "friendly" in desc:
            return ("badminton_friendly", None, "badminton_friendly")
        return ("badminton_casual", None, "badminton_casual")

    # Yoga — recovery on weekdays, realign on Sunday
    if sport == "Yoga":
        if dow == 6:  # Sunday = Realign
            return ("realign", None, "realign")
        return ("recovery", None, "recovery")

    # WeightTraining / Workout
    if sport in ("WeightTraining", "Workout"):
        if "calisthenics" in name_lower:
            focus = None
            if "upper" in name_lower:
                focus = "Upper Body"
            elif "lower" in name_lower:
                focus = "Lower Body & Core"
            return ("calisthenics", focus, "calisthenics")

    if sport == "WeightTraining":
        if dur_min < 25:
            return ("foundation", None, "foundation")

        if "mobility" in name_lower or "recovery" in name_lower:
            if dow == 6:
                return ("realign", None, "realign")
            return ("recovery", None, "recovery")

        if dow == 6 and dur_min < 50:
            return ("realign", None, "realign")

        focus = None
        if "upper" in name_lower or "pull" in name_lower or "push" in name_lower:
            focus = "Upper"
        elif "lower" in name_lower or "leg" in name_lower or "squat" in name_lower:
            focus = "Lower"

        return ("weight", focus, "weight")

    return ("skip", None, None)


def generate_name(category: str, detail: Optional[str], counter: int) -> Optional[str]:
    """Generate the new name given category, detail, and counter number."""
    names = {
        "run": lambda: f"Run #{counter}",
        "swim": lambda: f"Swim #{counter}",
        "foundation": lambda: f"Foundation #{counter}: {'Core' if counter <= 9 else 'Kickstart'}",
        "weight": lambda: f"Weight Training #{counter}: {detail or 'General'}",
        "recovery": lambda: f"Recovery #{counter}",
        "realign": lambda: f"Realign #{counter}",
        "calisthenics": lambda: f"Calisthenics #{counter}: {detail or 'General'}",
        "badminton_ranked": lambda: f"Badminton: Ranked #{counter}",
        "badminton_league": lambda: f"Badminton: League #{counter}",
        "badminton_friendly": lambda: f"Badminton: Friendly #{counter}",
        "badminton_casual": lambda: f"Badminton: Casual #{counter}",
    }
    fn = names.get(category)
    return fn() if fn else None