#!/usr/bin/env python3
"""Generate training/activities/badminton_analytics_snapshot.json from activity history.

Thin wrapper — implementation lives in platform/plugins/badminton/analytics.py.

Usage:
    python scripts/generate_analytics_snapshot.py
"""

import sys
from pathlib import Path

REPO_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_DIR / "engine" / "lib"))
sys.path.insert(0, str(REPO_DIR / "engine"))
sys.path.insert(0, str(REPO_DIR / "platform"))

from plugins.badminton.analytics import main

if __name__ == "__main__":
    main()
