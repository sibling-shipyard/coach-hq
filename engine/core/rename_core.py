"""Shared naming rules for Coach Phelps activities.

Naming convention source of truth — mirrored client-side by
ios/CoachHQ/CoachHQ/Services/ActivityNamer.swift.

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
    re.compile(r"^[A-Za-z0-9_ -]+ #\d+$"),
]

# Patterns to extract counter numbers from existing names (fallback or unused)
COUNTER_PATTERNS = {}

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
    config: Optional[Union[dict, list]] = None
) -> Tuple[str, Optional[str], Optional[str]]:
    """Classify an activity and attach the 'category' to the dictionary.
    
    Returns (category, detail (sport_type), counter_key (sport_type)).
    """
    sport = data.get("sport_type", data.get("type", ""))
    if sport in SKIP_SPORTS:
        return ("skip", None, None)

    if config is None:
        try:
            from repo_layout import categories_path, repo_root_from_here
            from .category_resolver import load_config
            root = repo_root_from_here(__file__)
            cfg_path = categories_path(root)
            config = load_config(str(cfg_path)) if cfg_path.is_file() else []
        except Exception:
            config = []

    try:
        from .category_resolver import resolve_from_activity
    except ImportError:
        from category_resolver import resolve_from_activity
        
    category = resolve_from_activity(data, config)
    data["category"] = category
    return (category, sport, sport)


def generate_name(category: str, detail: Optional[str], counter: int) -> Optional[str]:
    """Generate the new name. detail is expected to be the sport_type."""
    if not detail:
        return None
    return f"{detail} #{counter}"