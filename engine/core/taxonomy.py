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


from typing import Optional, Union, List, Dict

def get_training_category(activity: dict, config: Optional[Union[Dict, List]] = None) -> str:
    """Classify activity into a training category code via category_resolver."""
    cat = activity.get("category")
    if cat:
        return cat

    try:
        from .category_resolver import resolve_from_activity
    except ImportError:
        from category_resolver import resolve_from_activity

    if config is None:
        try:
            from repo_layout import categories_path, repo_root_from_here
            from .category_resolver import load_config
            root = repo_root_from_here(__file__)
            cfg_path = categories_path(root)
            config = load_config(str(cfg_path)) if cfg_path.is_file() else []
        except Exception:
            config = []

    return resolve_from_activity(activity, config)
