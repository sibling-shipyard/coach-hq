#!/usr/bin/env python3
"""Generate training/activities/badminton_analytics_snapshot.json from activity history.

Thin wrapper — implementation lives in engine/plugins/badminton/analytics.py.

Usage:
    python scripts/generate_analytics_snapshot.py
"""

import sys
from pathlib import Path

REPO_DIR = Path(__file__).resolve().parent.parent
ENGINE_DIR = REPO_DIR / "engine"
if ENGINE_DIR.is_dir():
    sys.path.insert(0, str(REPO_DIR))
    sys.path.insert(0, str(ENGINE_DIR))
else:
    sys.path.insert(0, str(REPO_DIR))

from plugins.badminton.analytics import main

if __name__ == "__main__":
    main()
