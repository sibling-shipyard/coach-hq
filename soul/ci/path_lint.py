#!/usr/bin/env python3
"""Path-lint — the target layout is fully described and no legacy path leaks.

Checks paths.contract.json against the frozen §6.4 target layout:
  (a) every REQUIRED target path (the §6.4 table) is present as an instance_path,
  (b) no instance_path leaks a legacy root (training/**, root templates/sessions/docs/…),
  (c) instance_paths are unique and every entry carries the five contract fields,
  (d) every legacy_path sits under a known legacy root (or is a SOUL section / null).

Exit 0 = green, exit 1 = red. Design doc §6.4-6.5 (path contract is consumed by the lint).
"""
from __future__ import annotations

import sys

from ledger import load_contract

# The §6.4 target layout. If the contract stops describing one of these, CI goes red.
# Directory targets keep their trailing slash; file targets are normalised without a #fragment.
REQUIRED_TARGETS = {
    "SOUL.md",
    "coach/state.md",
    "coach/notes.md",
    "coach/reference/",
    "coach/archive/",
    "coach/config.yaml",
    "ledger/current_week.json",
    "ledger/quests.json",
    "gen/quest_log.md",
    "gen/analytics.json",
    "activities/history/",
    "activities/workout_templates/",
    "activities/workout_plans/",
    "propagated/contracts/",
    "propagated/voice/",
}

# Legacy prefixes that must never appear in a *target* (instance_path).
LEGACY_TARGET_PREFIXES = (
    "training/",
    "templates/",
    "sessions/",
    "docs/",
    "strava/",
    "scripts/",
    "ui/",
    "ios/",
)

# Where a legacy_path is allowed to live.
LEGACY_SOURCE_PREFIXES = (
    "training/",
    "templates/",
    "sessions/",
    "docs/",
    "strava/",
    "scripts/",
    "propagated/",
    "SOUL.md",
)

REQUIRED_FIELDS = ("pointer", "instance_path", "group", "writer", "legacy_path")


def norm(instance_path: str) -> str:
    """Drop a #fragment; keep a normalised target key for the required-set check."""
    base = instance_path.split("#", 1)[0]
    return base


def main() -> int:
    contract = load_contract()
    entries = contract.get("entries", [])
    errors: list[str] = []

    seen: set[str] = set()
    present_targets: set[str] = set()

    for e in entries:
        pid = e.get("pointer", "<no-pointer>")

        for f in REQUIRED_FIELDS:
            if f not in e:
                errors.append(f"{pid}: missing required field `{f}`")

        ip = e.get("instance_path")
        if not ip:
            errors.append(f"{pid}: empty instance_path")
            continue

        # (b) legacy leak in a target
        for pref in LEGACY_TARGET_PREFIXES:
            if ip.startswith(pref):
                errors.append(
                    f"{pid}: instance_path {ip!r} leaks legacy root {pref!r} — targets "
                    "live in the new layout only"
                )
                break

        # (c) uniqueness
        if ip in seen:
            errors.append(f"{pid}: duplicate instance_path {ip!r}")
        seen.add(ip)
        present_targets.add(norm(ip))

        # (d) legacy_path sanity
        lp = e.get("legacy_path")
        if lp is not None and not any(lp.startswith(p) for p in LEGACY_SOURCE_PREFIXES):
            errors.append(f"{pid}: legacy_path {lp!r} is not under a known legacy root")

    # (a) required-target coverage. A directory requirement (trailing slash) is met by an
    # exact entry or by any instance_path living under it; a file requirement is met exactly.
    for target in sorted(REQUIRED_TARGETS):
        if target.endswith("/"):
            met = any(t == target or t.startswith(target) for t in present_targets)
        else:
            met = target in present_targets
        if not met:
            errors.append(
                f"required target path {target!r} (§6.4) is not described by any contract entry"
            )

    if errors:
        print("::error::Path-lint FAILED:")
        for e in errors:
            print(f"  - {e}")
        return 1

    print(
        f"Path-lint PASSED — {len(entries)} contract entries; all {len(REQUIRED_TARGETS)} "
        "required §6.4 targets present, no legacy leaks, instance_paths unique."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
