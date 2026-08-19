"""Add historical same-sport baselines to newly synced activity files."""

from __future__ import annotations

import json
from pathlib import Path
from statistics import median


BASELINE_LIMIT = 20


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _above_threshold_seconds(activity: dict) -> float | None:
    zones = activity.get("hr_zones")
    if not isinstance(zones, dict):
        return None

    values = []
    for zone_name in ("Zone 4", "Zone 5"):
        zone = zones.get(zone_name)
        if not isinstance(zone, dict):
            return None
        seconds = _number(zone.get("seconds"))
        if seconds is None:
            return None
        values.append(seconds)
    return sum(values)


def _median(values: list[float]) -> float | int | None:
    if not values:
        return None
    result = median(values)
    return int(result) if result.is_integer() else result


def build_vs_usual(prior_activities: list[dict], limit: int = BASELINE_LIMIT) -> dict | None:
    """Build a baseline from the last ``limit`` prior same-sport activities."""
    sample = prior_activities[-limit:]
    if len(sample) < 2:
        return None

    duration_values = [
        value
        for activity in sample
        if (value := _number(activity.get("elapsed_time"))) is not None
    ]
    avg_hr_values = [
        value
        for activity in sample
        if (value := _number(activity.get("average_heartrate"))) is not None
    ]
    threshold_values = [
        value
        for activity in sample
        if (value := _above_threshold_seconds(activity)) is not None
    ]

    baseline: dict[str, float | int] = {"sample_count": len(sample)}
    for key, values in (
        ("duration_median_s", duration_values),
        ("avg_hr_median", avg_hr_values),
        ("above_threshold_median_s", threshold_values),
    ):
        value = _median(values)
        if value is not None:
            baseline[key] = value
    return baseline


def enrich_activity_files(history_dir: Path, changed_paths: list[Path]) -> int:
    """Write ``vs_usual`` only to changed activity files, returning the write count."""
    targets = {path.resolve() for path in changed_paths if path.suffix == ".json"}
    if not targets or not history_dir.is_dir():
        return 0

    activities: list[tuple[Path, dict]] = []
    for path in history_dir.glob("*.json"):
        try:
            data = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(data, dict):
            activities.append((path.resolve(), data))

    activities.sort(key=lambda item: (str(item[1].get("start_date_local", "")), item[0].name))
    prior_by_sport: dict[str, list[dict]] = {}
    writes = 0

    for path, activity in activities:
        sport = activity.get("sport_type")
        if not isinstance(sport, str) or not sport:
            continue

        if path in targets and "vs_usual" not in activity:
            baseline = build_vs_usual(prior_by_sport.get(sport, []))
            if baseline is not None:
                activity["vs_usual"] = baseline
                path.write_text(json.dumps(activity, indent=2, sort_keys=True) + "\n")
                writes += 1

        prior_by_sport.setdefault(sport, []).append(activity)

    return writes
