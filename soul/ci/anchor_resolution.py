#!/usr/bin/env python3
"""Anchor-resolution — every rule-ID resolves to a declared anchor.

P1 resolves against the stub registry (soul/anchors.registry.txt); P3/P4 repoint the
resolver at the real A/B/C sources so a post-split edit that silently drops a rule breaks
an anchor and fails the build (design doc §6.3, standing anchor gate).

Checks:
  (a) anchor IDs are unique per rule and well-formed  (^[ABC]#slug$),
  (b) every disposition anchor resolves in the registry (two-way: no unresolved anchor,
      no orphan registry line),
  (c) each anchor is declared by exactly one rule (no two rules claim the same anchor).

Regenerate the stub after editing the ledger:
    python3 soul/ci/anchor_resolution.py --write-registry

Exit 0 = green, exit 1 = red.
"""
from __future__ import annotations

import sys

from ledger import (
    ANCHOR_RE,
    REGISTRY,
    entry_anchors,
    load_disposition,
    load_registry,
)


def collect() -> tuple[list[str], dict[str, list[str]]]:
    doc = load_disposition()
    ordered: list[str] = []
    by_anchor: dict[str, list[str]] = {}
    for e in doc.get("entries", []):
        rid = e.get("id", "<no-id>")
        for a in entry_anchors(e):
            ordered.append(a)
            by_anchor.setdefault(a, []).append(rid)
    return ordered, by_anchor


def write_registry() -> int:
    ordered, _ = collect()
    uniq = sorted(set(ordered))
    with open(REGISTRY, "w") as fh:
        fh.write("# anchors.registry.txt — P1 stub anchor inventory.\n")
        fh.write("# Auto-generated from disposition.yaml: python3 soul/ci/anchor_resolution.py --write-registry\n")
        fh.write("# P3/P4 replace this stub with a live scan of A.identity.md / B.engine.md / C.schema.\n")
        for a in uniq:
            fh.write(a + "\n")
    print(f"Wrote {len(uniq)} anchors to {REGISTRY}")
    return 0


def main(argv: list[str]) -> int:
    if "--write-registry" in argv:
        return write_registry()

    ordered, by_anchor = collect()
    registry = load_registry()
    errors: list[str] = []

    # (a) format
    for a in sorted(set(ordered)):
        if not ANCHOR_RE.match(a):
            errors.append(f"malformed anchor {a!r} (want ^[ABC]#slug$)")

    # (c) uniqueness of anchor ownership
    for a, rids in sorted(by_anchor.items()):
        if len(rids) > 1:
            errors.append(f"anchor {a!r} claimed by multiple rules: {', '.join(rids)}")

    # (b) two-way resolution against the stub registry
    used = set(ordered)
    reg = set(registry)
    for a in sorted(used - reg):
        errors.append(f"anchor {a!r} does not resolve — missing from anchors.registry.txt")
    for a in sorted(reg - used):
        errors.append(f"registry anchor {a!r} is orphaned — declared but no rule uses it")

    if errors:
        print("::error::Anchor-resolution FAILED:")
        for e in errors:
            print(f"  - {e}")
        print("  (if you edited the ledger intentionally, run: "
              "python3 soul/ci/anchor_resolution.py --write-registry)")
        return 1

    print(
        f"Anchor-resolution PASSED — {len(used)} anchors, all well-formed, uniquely owned, "
        "and resolving against the stub registry."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
