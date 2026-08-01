"""Activity category classification via category_resolver."""

from __future__ import annotations

from typing import Final, Optional, Union, List, Dict

# Sport type
BADMINTON_SPORT: Final = "Badminton"



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
