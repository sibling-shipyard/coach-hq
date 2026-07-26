"""Resolve repo root and engine paths — HQ (engine/ subtree) vs user fork (flat or engine/)."""
from __future__ import annotations

from pathlib import Path


def repo_root_from_here(file: str | Path) -> Path:
    """engine/scripts/foo.py → repo root; scripts/foo.py (skeleton) → repo root."""
    here = Path(file).resolve().parent
    dir = here
    for _ in range(6):
        if (dir / "engine" / "soul").is_dir():
            return dir
        if (dir / "SOUL.md").is_file() and (
            (dir / "user_data").is_dir() or (dir / "training").is_dir()
        ):
            return dir
        # Flat skeleton: soul/ copy at repo root — not the engine/ subtree of HQ
        if (
            (dir / "soul").is_dir()
            and not (dir / "engine").is_dir()
            and not (dir.parent / "engine" / "soul").is_dir()
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


def aggregate_path(repo: Path) -> Path:
    if uses_new_layout(repo):
        return repo / "gen" / "aggregate.json"
    return repo / "data" / "aggregate.json"


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


def quest_log_path(repo: Path) -> Path:
    if uses_new_layout(repo):
        return repo / "gen" / "quest_log.md"
    return repo / "training" / "activities" / "quest_log.md"


def quest_history_path(repo: Path) -> Path:
    if uses_new_layout(repo):
        return repo / "gen" / "quest_history.json"
    return repo / "training" / "activities" / "quest_history.json"


def chat_history_path(repo: Path) -> Path:
    if uses_new_layout(repo):
        return repo / "user_data" / "coach" / "chat_history.json"
    return repo / "training" / "chat_history.json"


def seasons_dir(repo: Path) -> Path:
    if uses_new_layout(repo):
        return repo / "user_data" / "ledger" / "seasons"
    return repo / "training" / "seasons"


def activities_dir(repo: Path) -> Path:
    if uses_new_layout(repo):
        return repo / "user_data" / "activities"
    return repo / "training" / "activities"
