#!/usr/bin/env python3
"""One-time migration: legacy activity names → generic {Sport} #{N} + category field.

Reads user_data/activities/hist/*.json, derives category from the old display name via
preset regex rules, renames to {sport_type} #{N} (per-sport counters), and updates
sync_state.json counters so the next iOS sync continues numbering correctly.

Run once per athlete repo after phase 1 (generic naming) lands. Use --preset sky for
coach-akash; --preset generic for greenfield or unknown naming schemes.

Usage:
  python3 engine/scripts/migrate_activity_naming.py --dry-run --preset sky
  python3 engine/scripts/migrate_activity_naming.py --preset sky --force
"""

from __future__ import annotations

import argparse
import glob
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

_here = Path(__file__).resolve().parent
sys.path.insert(0, str(_here.parent / "lib"))
from repo_layout import hist_dir, repo_root_from_here, sync_state_path  # noqa: E402

PRESETS_DIR = _here / "presets"
GENERIC_NAME_RE = re.compile(r"^(.+) #(\d+)$")


def load_preset(name: str) -> dict[str, Any]:
    path = PRESETS_DIR / f"{name}.json"
    if not path.is_file():
        raise FileNotFoundError(f"Preset not found: {path}")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def compile_rules(preset: dict[str, Any]) -> list[tuple[re.Pattern[str], str]]:
    rules: list[tuple[re.Pattern[str], str]] = []
    for entry in preset.get("name_rules", []):
        rules.append((re.compile(entry["pattern"]), entry.get("category", "")))
    return rules


def derive_category(
    old_name: str,
    sport_type: str,
    rules: list[tuple[re.Pattern[str], str]],
    sport_defaults: dict[str, str],
) -> str:
    for pattern, category in rules:
        if pattern.search(old_name):
            return category
    return sport_defaults.get(sport_type, "")


def counter_key(sport_type: str) -> str:
    return sport_type.lower()


def is_generic_name(name: str, sport_type: str) -> bool:
    m = GENERIC_NAME_RE.match(name)
    return bool(m and m.group(1) == sport_type)


def parse_start_date(data: dict[str, Any]) -> datetime:
    start = data.get("start_date_local", "")
    dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    return dt


def load_sync_state(path: Path) -> dict[str, Any]:
    if path.is_file():
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return {}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Migrate legacy activity names to generic {Sport} #{N} + category."
    )
    parser.add_argument(
        "--preset",
        choices=["sky", "skanda", "generic"],
        default="generic",
        help="Regex preset for old-name → category mapping (default: generic)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned changes without writing files",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-migrate activities already in generic {Sport} #{N} format",
    )
    args = parser.parse_args()

    root = repo_root_from_here(__file__)
    h_dir = hist_dir(root)
    state_path = sync_state_path(root)

    preset = load_preset(args.preset)
    rules = compile_rules(preset)
    sport_defaults: dict[str, str] = preset.get("sport_defaults", {})

    files = sorted(glob.glob(str(h_dir / "*.json")))
    if not files:
        print(f"No activity files in {h_dir}")
        return

    activities: list[tuple[Path, dict[str, Any]]] = []
    for fp in files:
        path = Path(fp)
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        activities.append((path, data))

    activities.sort(key=lambda item: parse_start_date(item[1]))

    counters: dict[str, int] = {}
    changed = 0
    skipped = 0

    for path, data in activities:
        old_name = data.get("name", "")
        sport_type = data.get("sport_type", data.get("type", ""))
        if not sport_type:
            print(f"Skip {path.name}: missing sport_type", file=sys.stderr)
            skipped += 1
            continue

        key = counter_key(sport_type)

        if is_generic_name(old_name, sport_type) and not args.force:
            m = GENERIC_NAME_RE.match(old_name)
            assert m is not None
            counters[key] = max(counters.get(key, 0), int(m.group(2)))
            if data.get("category"):
                skipped += 1
                continue
            category = sport_defaults.get(sport_type, "")
            new_name = old_name
            if not category:
                skipped += 1
                continue
        else:
            category = derive_category(old_name, sport_type, rules, sport_defaults)
            counters[key] = counters.get(key, 0) + 1
            new_name = f"{sport_type} #{counters[key]}"

        if args.dry_run:
            print(
                f"[dry-run] {path.name}: {old_name!r} → {new_name!r}, "
                f"category={category!r}"
            )
        else:
            data["name"] = new_name
            if category:
                data["category"] = category
            elif "category" in data and args.force:
                del data["category"]
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
                f.write("\n")
            print(f"Updated {path.name}: {old_name!r} → {new_name!r}, category={category!r}")

        changed += 1

    sync_state = load_sync_state(state_path)
    existing = sync_state.get("counters") or {}
    merged = {**existing, **counters}
    for k, v in counters.items():
        merged[k] = max(merged.get(k, 0), v)

    if args.dry_run:
        print(f"\n[dry-run] Would set sync_state counters: {json.dumps(merged, sort_keys=True)}")
    else:
        sync_state["counters"] = merged
        state_path.parent.mkdir(parents=True, exist_ok=True)
        with open(state_path, "w", encoding="utf-8") as f:
            json.dump(sync_state, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(f"\nUpdated {state_path} counters: {json.dumps(merged, sort_keys=True)}")

    print(f"\nDone. Changed: {changed}, Skipped: {skipped}")


if __name__ == "__main__":
    main()
