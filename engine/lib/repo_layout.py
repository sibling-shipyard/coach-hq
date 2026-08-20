"""Resolve repo root and engine paths — HQ (engine/ subtree) vs user fork (flat or engine/)."""
from __future__ import annotations

from pathlib import Path


def repo_root_from_here(file: str | Path) -> Path:
    """engine/scripts/foo.py → repo root; scripts/foo.py (skeleton) → repo root."""
    here = Path(file).resolve().parent
    dir = here
    for _ in range(8):
        # HQ monorepo
        if (dir / "platform" / "soul").is_dir() and (dir / "ui").is_dir():
            return dir
        if (dir / "engine" / "soul").is_dir():
            return dir
        if (dir / "propagated" / "SOUL.md").is_file() and (dir / "user_data").is_dir():
            return dir
        if (dir / "SOUL.md").is_file() and (
            (dir / "user_data").is_dir() or (dir / "training").is_dir()
        ):
            return dir
        # Flat skeleton: soul/ at repo root — not HQ platform/soul/ subtree
        if (
            (dir / "soul").is_dir()
            and not (dir / "engine").is_dir()
            and not (dir / "platform" / "scripts").is_dir()
            and not (dir.parent / "engine" / "soul").is_dir()
            and not (dir.parent / "platform" / "soul").is_dir()
        ):
            return dir
        parent = dir.parent
        if parent == dir:
            break
        dir = parent
    raise RuntimeError(f"Cannot resolve repo root from {file}")


def uses_new_layout(repo: Path) -> bool:
    """True when repo uses user_data/ + gen/ (carved skeleton)."""
    return (repo / "user_data").is_dir()


def is_hq_monorepo(repo: Path) -> bool:
    """HQ monorepo — platform IP + ui; no athlete instance band at root."""
    return (repo / "platform" / "soul").is_dir() and (repo / "ui").is_dir()


def golden_repo_data_dir(repo: Path) -> Path:
    return repo / "shared" / "golden-dataset" / "repo-data"


def engine_root(repo: Path) -> Path:
    eng = repo / "engine"
    return eng if eng.is_dir() else repo


def p(repo: Path, *parts: str) -> Path:
    return engine_root(repo).joinpath(*parts)


def coach_dir(repo: Path) -> Path:
    if uses_new_layout(repo):
        return repo / "user_data" / "coach"
    return repo / "training" / "coach"


def ledger_dir(repo: Path) -> Path:
    if uses_new_layout(repo):
        return repo / "user_data" / "ledger"
    return repo / "training" / "ledger"


def hist_dir(repo: Path) -> Path:
    if uses_new_layout(repo):
        return repo / "user_data" / "activities" / "hist"
    return repo / "training" / "activities" / "history"


def gen_dir(repo: Path) -> Path:
    if uses_new_layout(repo):
        return repo / "gen"
    return repo / "training"


def sessions_dir(repo: Path) -> Path:
    if uses_new_layout(repo):
        return repo / "user_data" / "activities" / "workout_plans" / "sessions"
    return repo / "sessions"


def templates_dir(repo: Path) -> Path:
    if uses_new_layout(repo):
        return repo / "user_data" / "activities" / "workout_plans" / "templates"
    return repo / "templates"


def dashboard_snapshot_path(repo: Path) -> Path:
    if uses_new_layout(repo):
        return repo / "gen" / "dashboard_snapshot.json"
    return repo / "data" / "dashboard_snapshot.json"


def sleep_log_path(repo: Path) -> Path:
    if uses_new_layout(repo):
        return repo / "user_data" / "coach" / "sleep_log.json"
    return repo / "training" / "activities" / "sleep_log.json"


def sync_state_path(repo: Path) -> Path:
    if uses_new_layout(repo):
        return repo / "user_data" / "activities" / "sync_state.json"
    return repo / "training" / "sync_state.json"


def sync_status_path(repo: Path) -> Path:
    if uses_new_layout(repo):
        return repo / "gen" / "sync_status.json"
    return repo / "training" / "sync_status.json"



def quest_history_path(repo: Path) -> Path:
    if uses_new_layout(repo):
        return repo / "gen" / "quest_history.json"
    return repo / "training" / "activities" / "quest_history.json"


def widget_snapshots_path(repo: Path) -> Path:
    if uses_new_layout(repo):
        return repo / "gen" / "widget_snapshots.json"
    return repo / "training" / "widget_snapshots.json"


def chat_history_path(repo: Path) -> Path:
    if uses_new_layout(repo):
        return repo / "user_data" / "coach" / "chat_history.json"
    return repo / "training" / "chat_history.json"


def seasons_dir(repo: Path) -> Path:
    # Grouped with the rest of the coach's archived material (archive/phases.md,
    # archive/week_plans.md), not the live ledger/ - a closed season's challenge_v2.json is a
    # retrospective, not current data.
    if uses_new_layout(repo):
        return repo / "user_data" / "coach" / "archive" / "seasons"
    return repo / "training" / "seasons"


def activities_dir(repo: Path) -> Path:
    if uses_new_layout(repo):
        return repo / "user_data" / "activities"
    return repo / "training" / "activities"


def soul_file_path(repo: Path) -> Path:
    """Composed SOUL — HQ: platform/SOUL.md; athlete repos: propagated/SOUL.md."""
    if is_hq_monorepo(repo):
        hq = repo / "platform" / "SOUL.md"
        if hq.is_file():
            return hq
    propagated = repo / "propagated" / "SOUL.md"
    if propagated.is_file():
        return propagated
    return repo / "SOUL.md"
