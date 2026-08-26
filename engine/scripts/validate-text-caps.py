#!/usr/bin/env python3
"""Fail if Coach-written free text exceeds the per-entry caps.

Missing files skip — athlete repos vary. This is a backstop for the budgets in SOUL §12.

Caps:
  coach_log.json  rows[].text              2000
  memory.json     notes.*.text             1500
  injuries.json   flags[].text              500
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Numbers must match engine/lib/text-caps.mts - that TS module is the source of truth (issue
# #462); this file can't import it directly, so keep the three constants in sync by hand.
COACH_LOG_TEXT_CAP = 2000
MEMORY_NOTE_TEXT_CAP = 1500
INJURY_FLAG_TEXT_CAP = 500

MEMORY_NOTE_KEYS = (
    "fitness_baseline",
    "coaching_priorities",
    "learned_patterns.training",
    "learned_patterns.nutrition",
    "learned_patterns.mental",
    "equipment",
)


def _load(path: Path):
    try:
        with path.open() as fh:
            return json.load(fh)
    except FileNotFoundError:
        return None
    except json.JSONDecodeError as exc:
        raise SystemExit(f"{path}: invalid JSON: {exc}") from exc


def _text_len(value) -> int | None:
    if not isinstance(value, str):
        return None
    return len(value)


def check_coach_log(root: Path) -> list[str]:
    path = root / "user_data/coach/coach_log.json"
    data = _load(path)
    if data is None:
        return []
    rows = data.get("rows") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        return []
    errors = []
    for i, row in enumerate(rows):
        if not isinstance(row, dict):
            continue
        n = _text_len(row.get("text"))
        if n is not None and n > COACH_LOG_TEXT_CAP:
            errors.append(
                f"{path}: rows[{i}].text is {n} chars (max {COACH_LOG_TEXT_CAP})"
            )
    return errors


def check_memory(root: Path) -> list[str]:
    path = root / "user_data/coach/memory.json"
    data = _load(path)
    if data is None:
        return []
    notes = data.get("notes") if isinstance(data, dict) else None
    if not isinstance(notes, dict):
        return []
    errors = []
    keys = list(MEMORY_NOTE_KEYS)
    for key in notes:
        if key not in keys:
            keys.append(key)
    for key in keys:
        note = notes.get(key)
        if not isinstance(note, dict):
            continue
        n = _text_len(note.get("text"))
        if n is not None and n > MEMORY_NOTE_TEXT_CAP:
            errors.append(
                f"{path}: notes.{key}.text is {n} chars (max {MEMORY_NOTE_TEXT_CAP})"
            )
    return errors


def check_injuries(root: Path) -> list[str]:
    path = root / "user_data/coach/injuries.json"
    data = _load(path)
    if data is None:
        return []
    flags = data.get("flags") if isinstance(data, dict) else None
    if not isinstance(flags, list):
        return []
    errors = []
    for i, flag in enumerate(flags):
        if not isinstance(flag, dict):
            continue
        n = _text_len(flag.get("text"))
        if n is not None and n > INJURY_FLAG_TEXT_CAP:
            errors.append(
                f"{path}: flags[{i}].text is {n} chars (max {INJURY_FLAG_TEXT_CAP})"
            )
    return errors


def validate(root: Path) -> list[str]:
    return check_coach_log(root) + check_memory(root) + check_injuries(root)


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
        print("::error::Coach free-text exceeded a length cap:")
        for err in errors:
            print(f"  - {err}")
        return 1
    print("Validated Coach free-text caps — all present entries within budget.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
