"""cluster_hist_sessions.py — Garmin rewrite collapse (ADR 0035)."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from io import StringIO
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "engine" / "scripts"))
sys.path.insert(0, str(ROOT / "engine" / "lib"))

import cluster_hist_sessions as chs  # noqa: E402


def rec(
    name: str,
    uuid: str,
    start: datetime,
    elapsed: int,
    sport: str = "WeightTraining",
    coverage: int = 0,
    added_at: int = 100,
    filename: str | None = None,
    aliases: list[str] | None = None,
    is_hk: bool = True,
) -> chs.Record:
    file = filename or f"hk_{start.date()}_{uuid}.json"
    return chs.Record(
        path=Path(file),
        filename=file,
        is_hk=is_hk,
        data={
            "id": uuid,
            "id_str": uuid,
            "name": name,
            "sport_type": sport,
            "start_date_local": start.strftime("%Y-%m-%dT%H:%M:%S"),
            "elapsed_time": elapsed,
            "has_heartrate": coverage > 0,
        },
        uuid=uuid,
        aliases=aliases or [],
        sport=sport,
        start=start,
        end=start + timedelta(seconds=elapsed),
        name=name,
        added_at=added_at,
        coverage=coverage,
    )


GYM_START = datetime(2026, 8, 27, 20, 35, 49)


class TestMatchRules(unittest.TestCase):
    def test_garmin_rewrite_same_window(self):
        a = rec("WeightTraining #3", "A", GYM_START, 3312, added_at=1)
        b = rec("WeightTraining #4", "B", GYM_START, 3312, added_at=2)
        c = rec("WeightTraining #6", "C", GYM_START, 3312, added_at=3)
        clusters = chs.cluster_records([c, a, b])
        self.assertEqual(len(clusters), 1)
        self.assertEqual(clusters[0].winner.name, "WeightTraining #3")

    def test_two_gyms_same_day_stay_apart(self):
        a = rec("WeightTraining #3", "A", GYM_START, 3312)
        b = rec("WeightTraining #5", "B", datetime(2026, 8, 27, 7, 0, 0), 3200)
        self.assertEqual(len(chs.cluster_records([a, b])), 2)

    def test_sport_mismatch_within_two_minutes(self):
        run = rec("Run #20", "R", GYM_START, 2955, sport="Run")
        walk = rec("Walk #45", "W", GYM_START, 3078, sport="Walk")
        self.assertTrue(chs.are_duplicates(run, walk))

    def test_sport_mismatch_three_minutes_apart(self):
        run = rec("Run #20", "R", GYM_START, 2955, sport="Run")
        walk = rec("Walk #45", "W", GYM_START + timedelta(minutes=3), 3078, sport="Walk")
        self.assertFalse(chs.are_duplicates(run, walk))

    def test_walk_hiking_same_group(self):
        w = rec("Walk #1", "W", GYM_START, 3600, sport="Walk")
        h = rec("Hiking #1", "H", GYM_START, 3600, sport="Hiking")
        self.assertTrue(chs.are_duplicates(w, h))

    def test_alias_match(self):
        a = rec("Walk #1", "A", GYM_START, 1000, aliases=["B"])
        b = rec("Walk #2", "B", datetime(2026, 1, 1), 100)
        self.assertTrue(chs.are_duplicates(a, b))

    def test_greedy_not_transitive(self):
        a = rec("A #1", "A", GYM_START, 1000)
        b = rec("B #1", "B", GYM_START + timedelta(seconds=400), 1000)
        c = rec("C #1", "C", GYM_START + timedelta(seconds=800), 1000)
        clusters = chs.cluster_records([a, b, c])
        self.assertEqual(len(clusters), 2)

    def test_hr_source_is_best_coverage(self):
        keep = rec("Walk #45", "W", GYM_START, 3078, sport="Walk", coverage=0, added_at=1)
        later = rec("Walk #46", "X", GYM_START, 3078, sport="Walk", coverage=1557, added_at=2)
        cluster = chs.cluster_records([keep, later])[0]
        self.assertEqual(cluster.winner.uuid, "W")
        self.assertEqual(cluster.hr_source.uuid, "X")


class TestApply(unittest.TestCase):
    def _repo(self, tmp: str) -> Path:
        repo = Path(tmp)
        (repo / "user_data" / "activities" / "hist").mkdir(parents=True)
        (repo / "user_data" / "activities" / "streams").mkdir(parents=True)
        (repo / "user_data" / "coach").mkdir(parents=True)
        (repo / "propagated").mkdir()
        (repo / "propagated" / "SOUL.claude.md").write_text("x")
        return repo

    def _write_hist(self, repo: Path, rec: chs.Record, extra: dict | None = None) -> None:
        body = dict(rec.data)
        if extra:
            body.update(extra)
        rec.path = repo / "user_data" / "activities" / "hist" / rec.filename
        rec.path.write_text(json.dumps(body, indent=2))

    def test_dry_run_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = self._repo(tmp)
            a = rec("WeightTraining #3", "AAA", GYM_START, 100, coverage=10, added_at=1)
            b = rec("WeightTraining #4", "BBB", GYM_START, 100, coverage=50, added_at=2)
            self._write_hist(repo, a, {"hr_zones": {"Zone 1": {"seconds": 10}}})
            self._write_hist(repo, b, {"hr_zones": {"Zone 1": {"seconds": 50}}})
            with patch("sys.stdout", StringIO()):
                chs.run(repo, apply=False)
            names = sorted(p.name for p in (repo / "user_data" / "activities" / "hist").glob("*.json"))
            self.assertEqual(len(names), 2)

    def test_apply_keeps_earliest_copies_hr_deletes_loser(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = self._repo(tmp)
            a = rec("WeightTraining #3", "AAA", GYM_START, 100, coverage=10, added_at=1)
            b = rec("WeightTraining #4", "BBB", GYM_START, 100, coverage=50, added_at=2)
            self._write_hist(repo, a, {"hr_zones": {"Zone 1": {"seconds": 10}}})
            self._write_hist(repo, b, {"hr_zones": {"Zone 1": {"seconds": 50}}})
            stream_b = repo / "user_data" / "activities" / "streams" / "BBB.json"
            stream_b.write_text(json.dumps({"activity_id": "BBB", "covered_seconds": 50}))
            with patch("sys.stdout", StringIO()):
                chs.run(repo, apply=True)
            hist = repo / "user_data" / "activities" / "hist"
            names = sorted(p.name for p in hist.glob("*.json"))
            self.assertEqual(names, [a.filename])
            body = json.loads((hist / a.filename).read_text())
            self.assertEqual(body["name"], "WeightTraining #3")
            self.assertEqual(body["id"], "AAA")
            self.assertEqual(body["aliases"], ["BBB"])
            self.assertEqual(body["hr_zones"]["Zone 1"]["seconds"], 50)
            self.assertFalse(stream_b.exists())
            stream_a = repo / "user_data" / "activities" / "streams" / "AAA.json"
            self.assertTrue(stream_a.is_file())
            self.assertEqual(json.loads(stream_a.read_text())["activity_id"], "AAA")


if __name__ == "__main__":
    unittest.main()
