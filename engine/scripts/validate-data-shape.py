#!/usr/bin/env python3
"""D2 (#736 follow-up, ccr-d2-validation-audit-lld.md): real per-field shape/enum checks for every
user_data/ file coach-chat writes to, not just the ones the Gemini schema or an applier already
constrains. This is the layer that also catches Claude/BYOB direct writes - CI runs on the commit
regardless of what produced it, the only layer that does (see the LLD's "Fix, per layer" table).

Missing files skip, same discipline as validate-text-caps.py - HQ has no live user_data/, and
athlete repos vary in which files exist.

coach_log.json row shape is deliberately NOT checked here - it depends on C2's resolution
(ccr-d2-validation-audit-lld.md's own table entry); adding a shape check now would duplicate work
once that LLD lands. sync_state.json/sync_status.json are pipeline-owned, not coach-chat's, and are
out of scope here too.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

MEMORY_NOTE_KEYS = (
    "fitness_baseline",
    "coaching_priorities",
    "learned_patterns.training",
    "learned_patterns.nutrition",
    "learned_patterns.mental",
    "equipment",
)

INJURY_STATUSES = ("active", "resolved")
SEASON_STATUSES = ("active", "completed", "retired")
QUEST_STATUSES = ("active", "graduated", "retired")
QUEST_TYPES = ("daily_streak", "progress", "count_target", "weekly_frequency")
QUEST_POLARITIES = ("default_done", "default_not_done")
QUEST_SOURCES = ("model", "athlete")
PROGRESS_STATUSES = ("completed", "missed", "excused")
PROGRESS_SOURCES = ("model", "pipeline", "athlete")


def _load(path: Path):
    try:
        with path.open() as fh:
            return json.load(fh)
    except FileNotFoundError:
        return None
    except json.JSONDecodeError as exc:
        raise SystemExit(f"{path}: invalid JSON: {exc}") from exc


def _is_date(value) -> bool:
    return isinstance(value, str) and bool(DATE_RE.match(value))


# profile.json - dob/height_cm/weight_kg type checks exist for the coach-chat path only
# (coachIntents.ts's applyProfileUpdate). A Claude/BYOB direct write bypasses that applier
# entirely, so this is genuinely the only layer that catches a malformed direct write.
def check_profile(root: Path) -> list[str]:
    path = root / "user_data/coach/profile.json"
    data = _load(path)
    if data is None or not isinstance(data, dict):
        return []
    errors = []
    dob = data.get("dob")
    if dob is not None and not _is_date(dob):
        errors.append(f"{path}: dob must be null or YYYY-MM-DD, got {dob!r}")
    for field in ("height_cm", "weight_kg"):
        value = data.get(field)
        if value is not None and not isinstance(value, (int, float)):
            errors.append(f"{path}: {field} must be null or a number, got {value!r}")
    name = data.get("name")
    if name is not None and not isinstance(name, str):
        errors.append(f"{path}: name must be a string, got {name!r}")
    timezone = data.get("timezone")
    if timezone is not None and not isinstance(timezone, str):
        errors.append(f"{path}: timezone must be a string, got {timezone!r}")
    return errors


# memory.json - D1 already fixed the label enum; this checks every note's own field shapes
# (text/updated_at/trace_id), not just the six-key label set.
def check_memory(root: Path) -> list[str]:
    path = root / "user_data/coach/memory.json"
    data = _load(path)
    if data is None or not isinstance(data, dict):
        return []
    notes = data.get("notes")
    if not isinstance(notes, dict):
        return []
    errors = []
    for key in MEMORY_NOTE_KEYS:
        note = notes.get(key)
        if note is None:
            continue
        if not isinstance(note, dict):
            errors.append(f"{path}: notes.{key} must be an object, got {type(note).__name__}")
            continue
        for field in ("text", "updated_at", "trace_id"):
            value = note.get(field)
            if value is not None and not isinstance(value, str):
                errors.append(f"{path}: notes.{key}.{field} must be a string, got {value!r}")
    sports = data.get("sports")
    if sports is not None and (
        not isinstance(sports, list) or any(not isinstance(s, str) for s in sports)
    ):
        errors.append(f"{path}: sports must be an array of strings")
    return errors


# injuries.json - flag id format/uniqueness is genuinely unenforced anywhere else today (the
# issue's own headline example). status is already schema-enforced on the Gemini path
# (coachReplySchema.ts's injury_event.status enum) - this is the applier-independent double-check.
def check_injuries(root: Path) -> list[str]:
    path = root / "user_data/coach/injuries.json"
    data = _load(path)
    if data is None or not isinstance(data, dict):
        return []
    flags = data.get("flags")
    if not isinstance(flags, list):
        return []
    errors = []
    seen_ids: set[str] = set()
    for i, flag in enumerate(flags):
        if not isinstance(flag, dict):
            errors.append(f"{path}: flags[{i}] must be an object")
            continue
        flag_id = flag.get("id")
        if not isinstance(flag_id, str) or not flag_id:
            errors.append(f"{path}: flags[{i}].id must be a non-empty string, got {flag_id!r}")
        elif flag_id in seen_ids:
            errors.append(f"{path}: flags[{i}].id {flag_id!r} is a duplicate")
        else:
            seen_ids.add(flag_id)
        status = flag.get("status")
        if status is not None and status not in INJURY_STATUSES:
            errors.append(f"{path}: flags[{i}].status must be one of {INJURY_STATUSES}, got {status!r}")
    return errors


# seasons.json - Season.status enum and real-date-format checks for start_date/end_date.
def check_seasons(root: Path) -> list[str]:
    path = root / "user_data/ledger/seasons.json"
    data = _load(path)
    if data is None or not isinstance(data, dict):
        return []
    seasons = data.get("seasons")
    if not isinstance(seasons, list):
        return []
    errors = []
    for i, season in enumerate(seasons):
        if not isinstance(season, dict):
            errors.append(f"{path}: seasons[{i}] must be an object")
            continue
        status = season.get("status")
        if status is not None and status not in SEASON_STATUSES:
            errors.append(f"{path}: seasons[{i}].status must be one of {SEASON_STATUSES}, got {status!r}")
        start_date = season.get("start_date")
        if start_date is not None and not _is_date(start_date):
            errors.append(f"{path}: seasons[{i}].start_date must be YYYY-MM-DD, got {start_date!r}")
        end_date = season.get("end_date")
        if end_date is not None and not _is_date(end_date):
            errors.append(f"{path}: seasons[{i}].end_date must be YYYY-MM-DD, got {end_date!r}")
    return errors


# quests.json - Quest.status/QuestType/polarity are schema-enforced on the Gemini path only; no
# applier check, no CI check until now.
def check_quests(root: Path) -> list[str]:
    path = root / "user_data/ledger/quests.json"
    data = _load(path)
    if data is None or not isinstance(data, dict):
        return []
    errors = []
    main_quest = data.get("main_quest")
    if isinstance(main_quest, dict):
        mq_type = main_quest.get("type")
        if mq_type is not None and mq_type not in QUEST_TYPES:
            errors.append(f"{path}: main_quest.type must be one of {QUEST_TYPES}, got {mq_type!r}")
    quests = data.get("quests")
    if not isinstance(quests, list):
        return errors
    for i, quest in enumerate(quests):
        if not isinstance(quest, dict):
            errors.append(f"{path}: quests[{i}] must be an object")
            continue
        status = quest.get("status")
        if status is not None and status not in QUEST_STATUSES:
            errors.append(f"{path}: quests[{i}].status must be one of {QUEST_STATUSES}, got {status!r}")
        q_type = quest.get("type")
        if q_type is not None and q_type not in QUEST_TYPES:
            errors.append(f"{path}: quests[{i}].type must be one of {QUEST_TYPES}, got {q_type!r}")
        polarity = quest.get("polarity")
        if polarity is not None and polarity not in QUEST_POLARITIES:
            errors.append(
                f"{path}: quests[{i}].polarity must be one of {QUEST_POLARITIES}, got {polarity!r}"
            )
        source = quest.get("source")
        if source is not None and source not in QUEST_SOURCES:
            errors.append(f"{path}: quests[{i}].source must be one of {QUEST_SOURCES}, got {source!r}")
    return errors


# progress.json - status is schema-enforced on the Gemini path; source is server-hardcoded on
# that path so it's safe there, but non-coach writers (pipeline, athlete-authored) are fully
# unchecked - this is CI's job, not an applier's, per the LLD.
def check_progress(root: Path) -> list[str]:
    path = root / "user_data/ledger/progress.json"
    data = _load(path)
    if data is None or not isinstance(data, dict):
        return []
    rows = data.get("rows")
    if not isinstance(rows, list):
        return []
    errors = []
    for i, row in enumerate(rows):
        if not isinstance(row, dict):
            errors.append(f"{path}: rows[{i}] must be an object")
            continue
        status = row.get("status")
        if status is not None and status not in PROGRESS_STATUSES:
            errors.append(f"{path}: rows[{i}].status must be one of {PROGRESS_STATUSES}, got {status!r}")
        source = row.get("source")
        if source is not None and source not in PROGRESS_SOURCES:
            errors.append(f"{path}: rows[{i}].source must be one of {PROGRESS_SOURCES}, got {source!r}")
    return errors


# progressions.json - not audited in any prior pass; check shape from scratch.
def check_progressions(root: Path) -> list[str]:
    path = root / "user_data/ledger/progressions.json"
    data = _load(path)
    if data is None or not isinstance(data, dict):
        return []
    progressions = data.get("progressions")
    if not isinstance(progressions, list):
        return []
    errors = []
    for i, prog in enumerate(progressions):
        if not isinstance(prog, dict):
            errors.append(f"{path}: progressions[{i}] must be an object")
            continue
        for field in ("id", "name", "current", "target"):
            value = prog.get(field)
            if value is not None and not isinstance(value, str):
                errors.append(f"{path}: progressions[{i}].{field} must be a string, got {value!r}")
        unit = prog.get("unit")
        if unit is not None and not isinstance(unit, str):
            errors.append(f"{path}: progressions[{i}].unit must be null or a string, got {unit!r}")
        history = prog.get("history")
        if history is None:
            continue
        if not isinstance(history, list):
            errors.append(f"{path}: progressions[{i}].history must be an array")
            continue
        for j, entry in enumerate(history):
            if not isinstance(entry, dict):
                errors.append(f"{path}: progressions[{i}].history[{j}] must be an object")
                continue
            date = entry.get("date")
            if date is not None and not _is_date(date):
                errors.append(
                    f"{path}: progressions[{i}].history[{j}].date must be YYYY-MM-DD, got {date!r}"
                )
            value = entry.get("value")
            if value is not None and not isinstance(value, str):
                errors.append(
                    f"{path}: progressions[{i}].history[{j}].value must be a string, got {value!r}"
                )
            trace_id = entry.get("trace_id")
            if trace_id is not None and not isinstance(trace_id, str):
                errors.append(
                    f"{path}: progressions[{i}].history[{j}].trace_id must be a string, got {trace_id!r}"
                )
    return errors


def validate(root: Path) -> list[str]:
    return (
        check_profile(root)
        + check_memory(root)
        + check_injuries(root)
        + check_seasons(root)
        + check_quests(root)
        + check_progress(root)
        + check_progressions(root)
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--root",
        default=".",
        help="Repo root (default: cwd). Used by tests with temp fixtures.",
    )
    args = parser.parse_args(argv)
    root = Path(args.root).resolve()
    errors = validate(root)
    if errors:
        print("::error::user_data field/enum shape check failed:")
        for err in errors:
            print(f"  - {err}")
        return 1
    print("Validated user_data field/enum shapes — all present entries within contract.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
