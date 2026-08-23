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
        # Athlete repo: a composed SOUL at the propagated/ or repo root. Both the post-ADR-0022
        # `SOUL.claude.md` name and the pre-split `SOUL.md` count - repos carved before the
        # split still carry the old name and must keep resolving.
        has_athlete_band = (dir / "user_data").is_dir() or (dir / "training").is_dir()
        if (
            (dir / "propagated" / "SOUL.claude.md").is_file()
            or (dir / "propagated" / "SOUL.md").is_file()
            or (
                ((dir / "SOUL.claude.md").is_file() or (dir / "SOUL.md").is_file())
                and has_athlete_band
            )
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


def health_dir(repo: Path) -> Path:
    if uses_new_layout(repo):
        return repo / "user_data" / "health"
    return repo / "training" / "health"


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


def soul_file_path(repo: Path, target: str = "claude") -> Path:
    """Composed SOUL path for a build target (ADR 0022) - HQ: platform/SOUL.<target>.md;
    athlete repos: propagated/SOUL.claude.md, then repo root.

    The bare `SOUL.md` name is retired at HQ but still probed last in athlete repos:
    `coach-akash` and `coach-skanda` were carved before the split and still carry
    `propagated/SOUL.md`, so dropping the fallback would break the engine scripts running
    inside them.
    """
    if is_hq_monorepo(repo):
        return repo / "platform" / f"SOUL.{target}.md"
    for candidate in (
        repo / "propagated" / f"SOUL.{target}.md",
        repo / "propagated" / "SOUL.md",
        repo / f"SOUL.{target}.md",
    ):
        if candidate.is_file():
            return candidate
    return repo / "SOUL.md"
