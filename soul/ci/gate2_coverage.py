#!/usr/bin/env python3
"""Gate 2 — dispositioned line-coverage (load-bearing).

Proves nothing in the frozen v5.7 SOUL is dropped, orphaned, or double-homed:
  (a) the union of every entry's line-range equals lines 1..N of the frozen file,
  (b) no line is claimed by two entries (SPLIT enumerates its own sub-anchors, so it
      still claims its range exactly once),
  (c) every entry carries a valid disposition and the fields that disposition requires.

Exit 0 = green, exit 1 = red. Design doc §6.3, Gate 2.
"""
from __future__ import annotations

import sys

from ledger import (
    NEEDS_ANCHOR,
    VALID_DISPOSITIONS,
    entry_anchors,
    frozen_line_count,
    load_disposition,
    parse_range,
)


def main() -> int:
    doc = load_disposition()
    entries = doc.get("entries", [])
    declared_n = int(doc.get("frozen_lines", 0))
    actual_n = frozen_line_count()

    errors: list[str] = []

    if declared_n != actual_n:
        errors.append(
            f"frozen_lines in disposition.yaml ({declared_n}) != actual line count of "
            f"SOUL.v5.7.frozen.md ({actual_n})"
        )
    n = actual_n

    # line -> list of rule-ids claiming it
    owner: dict[int, list[str]] = {}
    for e in entries:
        rid = e.get("id", "<no-id>")
        disp = e.get("disposition")
        if disp not in VALID_DISPOSITIONS:
            errors.append(f"{rid}: invalid disposition {disp!r}")
        # field requirements
        if disp in NEEDS_ANCHOR and not e.get("anchor"):
            errors.append(f"{rid}: disposition {disp} requires an `anchor`")
        if disp == "SPLIT" and not e.get("anchors"):
            errors.append(f"{rid}: SPLIT requires an `anchors` list")
        if disp == "REWRITTEN" and not e.get("reason"):
            errors.append(f"{rid}: REWRITTEN requires a `reason`")
        if disp == "DROPPED":
            if not e.get("reason"):
                errors.append(f"{rid}: DROPPED requires a `reason`")
            if e.get("anchor") or e.get("anchors"):
                errors.append(f"{rid}: DROPPED must not carry an anchor")
        try:
            lo, hi = parse_range(e["lines"])
        except Exception as ex:  # noqa: BLE001
            errors.append(f"{rid}: unparseable `lines` {e.get('lines')!r} ({ex})")
            continue
        if lo < 1 or hi > n or lo > hi:
            errors.append(f"{rid}: range {lo}-{hi} out of bounds 1..{n}")
            continue
        for ln in range(lo, hi + 1):
            owner.setdefault(ln, []).append(rid)

    # (b) no double-claims
    double = {ln: ids for ln, ids in owner.items() if len(ids) > 1}
    for ln in sorted(double):
        errors.append(f"line {ln} double-claimed by {', '.join(double[ln])}")

    # (a) full coverage
    missing = [ln for ln in range(1, n + 1) if ln not in owner]
    if missing:
        errors.append(
            f"{len(missing)} frozen line(s) unassigned (first few: "
            f"{missing[:10]}) — every line must carry exactly one disposition"
        )

    if errors:
        print("::error::Gate 2 (line coverage) FAILED:")
        for e in errors:
            print(f"  - {e}")
        return 1

    print(
        f"Gate 2 PASSED — {len(entries)} entries cover all {n} frozen lines exactly once, "
        "no gaps, no double-claims."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
