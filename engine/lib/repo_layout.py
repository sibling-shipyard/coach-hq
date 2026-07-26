"""Resolve repo root and engine paths — HQ (engine/ subtree) vs user fork (flat)."""
from __future__ import annotations

from pathlib import Path


def repo_root_from_here(file: str | Path) -> Path:
    """engine/scripts/foo.py → repo root; scripts/foo.py (skeleton) → repo root."""
    here = Path(file).resolve().parent
    if (here.parent / "soul").is_dir():
        return here.parent
    if (here.parent.parent / "engine" / "soul").is_dir():
        return here.parent.parent
    # Thin skeleton: SOUL.md copy only, no soul/ layers
    if (here.parent / "SOUL.md").is_file() and (here.parent / "training").is_dir():
        return here.parent
    raise RuntimeError(f"Cannot resolve repo root from {file}")


def engine_root(repo: Path) -> Path:
    eng = repo / "engine"
    return eng if eng.is_dir() else repo


def p(repo: Path, *parts: str) -> Path:
    return engine_root(repo).joinpath(*parts)
