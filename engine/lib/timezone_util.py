"""Resolve "today" in the athlete's own timezone instead of the host machine's clock.

Issue #45: scripts/generate_quest_log.py and generate_quest_history.py used bare
date.today() - correct on a developer's laptop, wrong on a GitHub Actions runner (UTC),
which can disagree with the athlete's own wall-clock day by several hours right at the
UTC rollover. current_week.json's `timezone` field is a required, schema-validated field
(engine/lib/current-week.mts's REQUIRED_FIELDS + validateTimeZone) - already the same
source of truth the dashboard and Coach's own boot sequence use.
"""
from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from repo_layout import ledger_dir

DEFAULT_TIMEZONE = "UTC"


def resolve_athlete_timezone(repo: Path) -> str:
    """Read `timezone` from current_week.json. Falls back to UTC if the file, field, or
    zone name is missing/invalid - same graceful-degradation current-week.mts's own
    validation and coach-chat.ts's extractTimezone() both already use."""
    current_week_path = ledger_dir(repo) / "current_week.json"
    if not current_week_path.exists():
        return DEFAULT_TIMEZONE
    try:
        data = json.loads(current_week_path.read_text())
    except (json.JSONDecodeError, OSError):
        return DEFAULT_TIMEZONE
    tz_name = data.get("timezone")
    if not tz_name or not isinstance(tz_name, str):
        return DEFAULT_TIMEZONE
    try:
        ZoneInfo(tz_name)  # validate - raises if unresolvable
    except (ZoneInfoNotFoundError, ValueError):
        return DEFAULT_TIMEZONE
    return tz_name


def today_in_timezone(tz_name: str) -> date:
    """Today's date in the given IANA zone. Falls back to UTC on an invalid zone name."""
    return now_in_timezone(tz_name).date()


def now_in_timezone(tz_name: str) -> datetime:
    """Current wall-clock time in the given IANA zone, returned naive (tzinfo stripped) so
    it's directly comparable to start_date_local timestamps, which are naive local time
    themselves (see rename_core.py's parse_local_start / query_history.py's parse_start -
    same issue #45 root cause: don't mix a tz-aware boundary against naive local
    timestamps). Falls back to UTC on an invalid zone name."""
    try:
        tz = ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError):
        tz = ZoneInfo(DEFAULT_TIMEZONE)
    return datetime.now(tz).replace(tzinfo=None)
