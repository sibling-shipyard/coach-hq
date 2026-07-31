"""Optional sport plugin gate — reads user_data/ledger/plugins.json."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from repo_layout import activities_dir, is_hq_monorepo, ledger_dir, p

DEFAULT_PLUGINS: dict[str, list[str]] = {"enabled": []}


def plugins_path(repo: Path) -> Path:
    return ledger_dir(repo) / "plugins.json"


def load_plugins(repo: Path) -> dict[str, Any]:
    path = plugins_path(repo)
    if not path.is_file():
        return dict(DEFAULT_PLUGINS)
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return dict(DEFAULT_PLUGINS)
    enabled = data.get("enabled")
    if not isinstance(enabled, list):
        return dict(DEFAULT_PLUGINS)
    return {"enabled": [str(name) for name in enabled]}


def is_plugin_enabled(repo: Path, name: str) -> bool:
    return name in load_plugins(repo).get("enabled", [])


def badminton_plugin_dir(repo: Path) -> Path | None:
    athlete = p(repo, "plugins", "badminton")
    if athlete.is_dir():
        return athlete
    if is_hq_monorepo(repo):
        hq = repo / "platform" / "plugins" / "badminton"
        if hq.is_dir():
            return hq
    return None


def badminton_analytics_script(repo: Path) -> Path | None:
    plugin_dir = badminton_plugin_dir(repo)
    if not plugin_dir:
        return None
    script = plugin_dir / "analytics.py"
    return script if script.is_file() else None


def badminton_snapshot_path(repo: Path) -> Path:
    return activities_dir(repo) / "badminton_analytics_snapshot.json"


def badminton_analytics_available(repo: Path) -> bool:
    if is_plugin_enabled(repo, "badminton"):
        return True
    return badminton_snapshot_path(repo).is_file()
