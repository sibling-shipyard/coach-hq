"""Shared loaders for the SOUL fidelity harness (P1).

Pure stdlib + PyYAML. Keeps the three CI checks (gate2_coverage, path_lint,
anchor_resolution) reading the same parsed view of the artifacts.
"""
from __future__ import annotations

import json
import os
import re
from typing import Iterable

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
SOUL_DIR = os.path.dirname(HERE)          # coach-phelps/soul
REPO_ROOT = os.path.dirname(SOUL_DIR)     # coach-phelps

DISPOSITION = os.path.join(SOUL_DIR, "disposition.yaml")
CONTRACT = os.path.join(SOUL_DIR, "paths.contract.json")
REGISTRY = os.path.join(SOUL_DIR, "anchors.registry.txt")
FROZEN = os.path.join(SOUL_DIR, "SOUL.v5.7.frozen.md")

ANCHOR_RE = re.compile(r"^[ABC]#[a-z0-9][a-z0-9._-]*$")
NEEDS_ANCHOR = {"A", "B", "C", "REWRITTEN"}
VALID_DISPOSITIONS = {"A", "B", "C", "SPLIT", "REWRITTEN", "DROPPED"}


def load_disposition() -> dict:
    with open(DISPOSITION) as fh:
        return yaml.safe_load(fh)


def load_contract() -> dict:
    with open(CONTRACT) as fh:
        return json.load(fh)


def frozen_line_count() -> int:
    with open(FROZEN) as fh:
        return sum(1 for _ in fh)


def parse_range(spec) -> tuple[int, int]:
    """'12' -> (12, 12); '18-34' -> (18, 34)."""
    s = str(spec).strip()
    if "-" in s:
        a, b = s.split("-", 1)
        return int(a), int(b)
    return int(s), int(s)


def entry_anchors(entry: dict) -> list[str]:
    """All anchors an entry declares (single `anchor` or SPLIT `anchors`)."""
    out: list[str] = []
    if entry.get("anchor"):
        out.append(entry["anchor"])
    for a in entry.get("anchors", []) or []:
        out.append(a)
    return out


def load_registry() -> list[str]:
    anchors: list[str] = []
    with open(REGISTRY) as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            anchors.append(line)
    return anchors


def flatten(xss: Iterable[Iterable[str]]) -> list[str]:
    return [x for xs in xss for x in xs]
