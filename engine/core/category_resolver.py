import json
from datetime import datetime
from typing import Union, Dict, Any

def load_config(config_path: str) -> Union[Dict[str, Any], list]:
    """Load categories.json and return the config object."""
    with open(config_path, "r", encoding="utf-8") as f:
        return json.load(f)

def resolve_category(sport_type: str, elapsed_time: int, start_date_local: str, config: Union[Dict[str, Any], list]) -> str:
    """Resolve 3-letter category code from config.
    
    Supports both dictionary format:
      { "Badminton": { "RNK": { "label": "Ranked", "rule": ... } } }
    and list format:
      [ { "sport": "Badminton", "categories": [ { "code": "RNK", ... } ] } ]
    """
    if not sport_type:
        return "OTH"

    weekday_str = None
    if start_date_local:
        try:
            dt = datetime.fromisoformat(start_date_local.replace("Z", "+00:00"))
            weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
            weekday_str = weekdays[dt.weekday()]
        except ValueError:
            pass

    # Dictionary format
    if isinstance(config, dict):
        sport_map = config.get(sport_type)
        if not sport_map or not isinstance(sport_map, dict):
            return sport_type[:3].upper()

        codes = list(sport_map.keys())
        if not codes:
            return sport_type[:3].upper()

        for code, info in sport_map.items():
            rule = info.get("rule") if isinstance(info, dict) else None
            if not rule:
                return code

            conditions_met = True
            if "duration_lt" in rule and elapsed_time >= rule["duration_lt"]:
                conditions_met = False
            if "duration_gte" in rule and elapsed_time < rule["duration_gte"]:
                conditions_met = False
            if "weekday" in rule and weekday_str != rule["weekday"]:
                conditions_met = False

            if conditions_met:
                return code

        return codes[0]

    # Array format (legacy / fallback)
    if isinstance(config, list):
        sport_config = next((item for item in config if item.get("sport") == sport_type), None)
        if not sport_config:
            return sport_type[:3].upper()

        categories = sport_config.get("categories", [])
        if not categories:
            return sport_type[:3].upper()

        for entry in categories:
            rule = entry.get("rule")
            if not rule:
                return entry["code"]

            conditions_met = True
            if "duration_lt" in rule and elapsed_time >= rule["duration_lt"]:
                conditions_met = False
            if "duration_gte" in rule and elapsed_time < rule["duration_gte"]:
                conditions_met = False
            if "weekday" in rule and weekday_str != rule["weekday"]:
                conditions_met = False

            if conditions_met:
                return entry["code"]

        return categories[0]["code"]

    return sport_type[:3].upper()

def resolve_from_activity(activity: Dict[str, Any], config: Union[Dict[str, Any], list]) -> str:
    """Convenience: resolve category from an activity dict."""
    sport_type = activity.get("sport_type", activity.get("type", ""))
    elapsed_time = activity.get("elapsed_time", 0)
    start_date_local = activity.get("start_date_local", "")
    return resolve_category(sport_type, elapsed_time, start_date_local, config)
