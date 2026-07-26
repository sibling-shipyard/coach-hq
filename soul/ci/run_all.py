#!/usr/bin/env python3
"""Run the three P1 SOUL-fidelity checks and summarise. Exit non-zero if any fails."""
from __future__ import annotations

import subprocess
import sys
import os

HERE = os.path.dirname(os.path.abspath(__file__))
CHECKS = [
    ("Gate 2 — line coverage", "gate2_coverage.py"),
    ("Path-lint", "path_lint.py"),
    ("Anchor-resolution", "anchor_resolution.py"),
]


def main() -> int:
    rc = 0
    for label, script in CHECKS:
        print(f"\n=== {label} ===")
        r = subprocess.run([sys.executable, os.path.join(HERE, script)])
        rc = rc or r.returncode
    print("\n" + ("ALL GREEN" if rc == 0 else "RED — see failures above"))
    return rc


if __name__ == "__main__":
    sys.exit(main())
