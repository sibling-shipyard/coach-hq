"""Heart-rate zone boundaries stored in the athlete repo."""
from __future__ import annotations

import json
from pathlib import Path

from repo_layout import health_dir, is_hq_monorepo

DEFAULT_HR_ZONES: list[int] = [131, 145, 158, 172]


def load_hr_zones(repo: Path) -> list[int]:
    """Return four inclusive zone uppers, or today's defaults when unavailable."""
    if is_hq_monorepo(repo):
        return list(DEFAULT_HR_ZONES)

    path = health_dir(repo) / "zones.json"
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return list(DEFAULT_HR_ZONES)

    boundaries = data.get("boundaries") if isinstance(data, dict) else None
    if (
        not isinstance(boundaries, list)
        or len(boundaries) != 4
        or any(isinstance(value, bool) or not isinstance(value, int) for value in boundaries)
        or any(left >= right for left, right in zip(boundaries, boundaries[1:]))
    ):
        return list(DEFAULT_HR_ZONES)
    return boundaries.copy()
