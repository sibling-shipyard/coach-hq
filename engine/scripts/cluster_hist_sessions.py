#!/usr/bin/env python3
"""Collapse duplicate HealthKit hist files onto one file per real session (ADR 0035).

Garmin rewrites assign a new uuid. This script clusters committed `hk_*.json` with the same
match order as iOS: identity (uuid / aliases), then ≥50% overlap of the shorter window with
the same activity group, then start within 2 minutes even when sport differs.

Keeps the earliest file (first git add, then lowest `#N`, then filename). Copies HR fields
and the stream sidecar from the copy with the most covered seconds. Writes loser uuids onto
`aliases`. Deletes loser hist + stream. Then renames survivors to `{Sport} #{N}` in start
order, per sport per calendar year, and sets `sync_state` counters to that max. No Coach.

Dry-run is the default. `--apply` writes.

Usage:
  python3 engine/scripts/cluster_hist_sessions.py --repo /path/to/coach-date2022
  python3 engine/scripts/cluster_hist_sessions.py --repo /path/to/coach-date2022 --apply
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

_here = Path(__file__).resolve().parent
sys.path.insert(0, str(_here.parent / "lib"))
from repo_layout import hist_dir, sync_state_path  # noqa: E402

CROSS_SPORT_START_SLACK = timedelta(seconds=120)
OVERLAP_RATIO = 0.5
NAME_N_RE = re.compile(r" #(\d+)$")
WALK_HIKE = {"Walk", "Hiking"}
HR_FIELDS = ("average_heartrate", "max_heartrate", "has_heartrate", "hr_zones")


@dataclass
class Record:
    path: Path
    filename: str
    is_hk: bool
    data: dict[str, Any]
    uuid: str
    aliases: list[str]
    sport: str
    start: datetime
    end: datetime
    name: str
    added_at: int
    coverage: int

    @property
    def duration(self) -> timedelta:
        return self.end - self.start

    @property
    def identity(self) -> set[str]:
        return {u.upper() for u in [self.uuid, *self.aliases] if u}

    @property
    def name_n(self) -> int:
        m = NAME_N_RE.search(self.name)
        return int(m.group(1)) if m else 10**9


@dataclass
class Cluster:
    members: list[Record] = field(default_factory=list)

    @property
    def winner(self) -> Record:
        hk = [m for m in self.members if m.is_hk]
        pool = hk or self.members
        return min(pool, key=lambda r: (r.added_at, r.name_n, r.filename))

    @property
    def hr_source(self) -> Record:
        keep = self.winner
        best = max(self.members, key=lambda r: (r.coverage, -r.added_at))
        return best if best.coverage > keep.coverage else keep


def zone_coverage(data: dict[str, Any]) -> int:
    zones = data.get("hr_zones") or {}
    if not isinstance(zones, dict):
        return 0
    total = 0
    for z in zones.values():
        if isinstance(z, dict):
            total += int(z.get("seconds") or 0)
    return total


def parse_start(raw: Any) -> datetime | None:
    if not raw or not isinstance(raw, str):
        return None
    text = raw.replace("Z", "")
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f"):
        try:
            return datetime.strptime(text[:26], fmt)
        except ValueError:
            continue
    return None


def same_activity_group(a: str, b: str) -> bool:
    if a == b:
        return True
    return a in WALK_HIKE and b in WALK_HIKE


def overlapping_enough(a: Record, b: Record) -> bool:
    overlap_start = max(a.start, b.start)
    overlap_end = min(a.end, b.end)
    if overlap_end <= overlap_start:
        return False
    overlap = (overlap_end - overlap_start).total_seconds()
    shorter = min(a.duration.total_seconds(), b.duration.total_seconds())
    return shorter > 0 and overlap / shorter >= OVERLAP_RATIO


def are_duplicates(a: Record, b: Record) -> bool:
    if a.identity & b.identity:
        return True
    if not overlapping_enough(a, b):
        return False
    if same_activity_group(a.sport, b.sport):
        return True
    return abs((a.start - b.start).total_seconds()) <= CROSS_SPORT_START_SLACK.total_seconds()


def cluster_records(records: list[Record]) -> list[Cluster]:
    ordered = sorted(records, key=lambda r: (r.start, r.filename))
    clusters: list[Cluster] = []
    for rec in ordered:
        for c in clusters:
            if are_duplicates(rec, c.members[0]):
                c.members.append(rec)
                break
        else:
            clusters.append(Cluster(members=[rec]))
    return clusters


def git_added_at(repo: Path, rel_paths: list[str]) -> dict[str, int]:
    if not rel_paths:
        return {}
    try:
        out = subprocess.run(
            ["git", "-C", str(repo), "log", "--diff-filter=A",
             "--pretty=format:%ct", "--name-only", "--", *rel_paths],
            capture_output=True, text=True, check=False,
        )
    except OSError:
        return {}
    added: dict[str, int] = {}
    ts: int | None = None
    for line in out.stdout.splitlines():
        if line.isdigit():
            ts = int(line)
            continue
        if ts is not None and line:
            added.setdefault(line, ts)
    return added


def load_record(path: Path, added_at: int, stream_coverage: int | None) -> Record | None:
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    uuid = str(data.get("id") or data.get("id_str") or path.stem)
    start = parse_start(data.get("start_date_local"))
    if start is None:
        return None
    elapsed = int(float(data.get("elapsed_time") or data.get("moving_time") or 0))
    aliases = data.get("aliases") or []
    if not isinstance(aliases, list):
        aliases = []
    coverage = stream_coverage if stream_coverage is not None else zone_coverage(data)
    return Record(
        path=path,
        filename=path.name,
        is_hk=path.name.startswith("hk_"),
        data=data,
        uuid=uuid,
        aliases=[str(a) for a in aliases],
        sport=str(data.get("sport_type") or ""),
        start=start,
        end=start + timedelta(seconds=elapsed),
        name=str(data.get("name") or ""),
        added_at=added_at,
        coverage=coverage,
    )


def stream_path(repo: Path, uuid: str) -> Path:
    return repo / "user_data" / "activities" / "streams" / f"{uuid}.json"


def stream_covered(repo: Path, uuid: str) -> int | None:
    path = stream_path(repo, uuid)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    if isinstance(data, dict) and data.get("covered_seconds") is not None:
        return int(data["covered_seconds"])
    return None


def load_records(repo: Path) -> list[Record]:
    hist = hist_dir(repo)
    paths = sorted(hist.glob("*.json"))
    rels = [str(p.relative_to(repo)) for p in paths]
    added = git_added_at(repo, rels)
    records: list[Record] = []
    for path in paths:
        rel = str(path.relative_to(repo))
        uuid_guess = path.stem.split("_")[-1] if path.name.startswith("hk_") else path.stem
        cov = stream_covered(repo, uuid_guess)
        rec = load_record(path, added.get(rel, 10**12), cov)
        if rec:
            records.append(rec)
    return records


@dataclass
class Plan:
    keep: Record
    hr_source: Record
    losers: list[Record]
    aliases: list[str]
    delete_hist: list[Path]
    delete_streams: list[Path]
    write_hist: Path
    write_stream: Path | None
    copy_stream_from: Path | None


def build_plan(cluster: Cluster, repo: Path) -> Plan | None:
    if len(cluster.members) < 2:
        return None
    hk_members = [m for m in cluster.members if m.is_hk]
    if len(hk_members) < 2 and not any(not m.is_hk for m in cluster.members):
        return None
    if not hk_members:
        return None
    keep = cluster.winner
    hr_source = cluster.hr_source
    losers = [m for m in cluster.members if m.path != keep.path]
    aliases = []
    seen = {keep.uuid.upper()}
    for m in cluster.members:
        for u in [m.uuid, *m.aliases]:
            if u and u.upper() not in seen:
                seen.add(u.upper())
                aliases.append(u)
    delete_hist = [m.path for m in losers]
    delete_streams = []
    for m in losers:
        sp = stream_path(repo, m.uuid)
        if sp.is_file():
            delete_streams.append(sp)
    src_stream = stream_path(repo, hr_source.uuid)
    dst_stream = stream_path(repo, keep.uuid)
    copy_stream = None
    write_stream = None
    if hr_source.uuid != keep.uuid and src_stream.is_file():
        copy_stream = src_stream
        write_stream = dst_stream
    return Plan(
        keep=keep,
        hr_source=hr_source,
        losers=losers,
        aliases=aliases,
        delete_hist=delete_hist,
        delete_streams=delete_streams,
        write_hist=keep.path,
        write_stream=write_stream,
        copy_stream_from=copy_stream,
    )


def merged_body(plan: Plan) -> dict[str, Any]:
    body = dict(plan.keep.data)
    if plan.hr_source.path != plan.keep.path and plan.hr_source.coverage > plan.keep.coverage:
        for key in HR_FIELDS:
            if key in plan.hr_source.data:
                body[key] = plan.hr_source.data[key]
    body["aliases"] = plan.aliases
    body["id"] = plan.keep.data.get("id", plan.keep.uuid)
    if "id_str" in plan.keep.data:
        body["id_str"] = plan.keep.data["id_str"]
    return body


def print_plan(plan: Plan, repo: Path) -> None:
    rel = lambda p: str(p.relative_to(repo))
    print(f"KEEP {rel(plan.keep.path)}  {plan.keep.name}")
    if plan.hr_source.path != plan.keep.path:
        print(f"  HR from {rel(plan.hr_source.path)}  covered={plan.hr_source.coverage}")
    print(f"  aliases: {', '.join(plan.aliases) or '(none)'}")
    for p in plan.delete_hist:
        print(f"  DELETE hist   {rel(p)}")
    for p in plan.delete_streams:
        print(f"  DELETE stream {rel(p)}")
    if plan.write_stream and plan.copy_stream_from:
        print(f"  WRITE stream  {rel(plan.write_stream)}  from {rel(plan.copy_stream_from)}")


def apply_plan(plan: Plan) -> None:
    plan.write_hist.write_text(json.dumps(merged_body(plan), indent=2, sort_keys=True) + "\n")
    if plan.copy_stream_from and plan.write_stream:
        data = json.loads(plan.copy_stream_from.read_text())
        if isinstance(data, dict):
            data["activity_id"] = plan.keep.uuid
        plan.write_stream.parent.mkdir(parents=True, exist_ok=True)
        plan.write_stream.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
    for p in plan.delete_hist + plan.delete_streams:
        p.unlink(missing_ok=True)


def planned_names(records: list[Record]) -> list[tuple[Record, str]]:
    """`{Sport} #{N}` in start order, per sport per calendar year (ActivityNamer)."""
    groups: dict[tuple[str, int], list[Record]] = {}
    for rec in records:
        if not rec.sport:
            continue
        groups.setdefault((rec.sport, rec.start.year), []).append(rec)
    changes: list[tuple[Record, str]] = []
    for recs in groups.values():
        recs.sort(key=lambda r: (r.start, r.filename))
        for i, rec in enumerate(recs, 1):
            new_name = f"{rec.sport} #{i}"
            if rec.name != new_name:
                changes.append((rec, new_name))
    return changes


def counters_for_latest_year(records: list[Record]) -> tuple[int, dict[str, int]]:
    groups: dict[tuple[str, int], int] = {}
    for rec in records:
        if not rec.sport:
            continue
        key = (rec.sport.lower(), rec.start.year)
        groups[key] = groups.get(key, 0) + 1
    latest = max((year for (_, year) in groups), default=datetime.now().year)
    counters = {sport: n for (sport, year), n in groups.items() if year == latest}
    return latest, counters


def write_name(rec: Record, new_name: str) -> None:
    data = dict(rec.data)
    data["name"] = new_name
    rec.path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def write_counters(repo: Path, year: int, counters: dict[str, int]) -> None:
    path = sync_state_path(repo)
    state: dict[str, Any] = {}
    if path.is_file():
        try:
            loaded = json.loads(path.read_text())
            if isinstance(loaded, dict):
                state = loaded
        except (OSError, json.JSONDecodeError):
            state = {}
    state["counter_year"] = year
    state["counters"] = dict(sorted(counters.items()))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2, ensure_ascii=False) + "\n")


def print_renames(changes: list[tuple[Record, str]], year: int, counters: dict[str, int]) -> None:
    print(f"RENUMBER {len(changes)} name(s); {year} counters {json.dumps(counters, sort_keys=True)}")
    for rec, new_name in changes:
        print(f"  {rec.filename}: {rec.name!r} → {new_name!r}")


def run(repo: Path, apply: bool) -> int:
    records = load_records(repo)
    hk = [r for r in records if r.is_hk]
    others = [r for r in records if not r.is_hk]
    clusters = cluster_records(hk)
    for other in others:
        for c in clusters:
            if any(are_duplicates(other, m) for m in c.members):
                c.members.append(other)
                break
    plans = [p for c in clusters if (p := build_plan(c, repo))]
    if plans:
        print(f"{'APPLY' if apply else 'DRY-RUN'}: {len(plans)} cluster(s) to collapse\n")
        for plan in plans:
            print_plan(plan, repo)
            print()
        if apply:
            for plan in plans:
                apply_plan(plan)
            print(f"Wrote {len(plans)} session file(s).")
            records = load_records(repo)
        else:
            print("No files written. Pass --apply to collapse.\n")
    else:
        print("No duplicate HK clusters.")

    changes = planned_names(records)
    year, counters = counters_for_latest_year(records)
    print_renames(changes, year, counters)
    if apply:
        for rec, new_name in changes:
            write_name(rec, new_name)
        write_counters(repo, year, counters)
        print(f"Updated {sync_state_path(repo).relative_to(repo)}")
    elif not plans:
        print("No files written. Pass --apply to write.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, help="Athlete repo root")
    parser.add_argument("--apply", action="store_true", help="Write. Default is dry-run.")
    args = parser.parse_args()
    repo = Path(args.repo).resolve()
    if not hist_dir(repo).is_dir():
        print(f"No activity hist dir under {repo}", file=sys.stderr)
        return 1
    return run(repo, args.apply)


if __name__ == "__main__":
    raise SystemExit(main())
