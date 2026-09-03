#!/usr/bin/env python3
"""Temp-JSON fixtures for validate-data-shape.py — HQ has no live user_data/. One malformed +
one valid fixture per file in ccr-d2-validation-audit-lld.md's table, mirroring
test_validate_text_caps.py's pattern."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

_SCRIPT = Path(__file__).resolve().parent / "validate-data-shape.py"
_SPEC = importlib.util.spec_from_file_location("validate_data_shape", _SCRIPT)
assert _SPEC and _SPEC.loader
validate_data_shape = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(validate_data_shape)


def _write(root: Path, rel: str, payload: object) -> None:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload))


class TestProfile(unittest.TestCase):
    def test_valid_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(
                root,
                "user_data/coach/profile.json",
                {
                    "version": 1,
                    "coach_since": "2026-01-01",
                    "name": "Skanda",
                    "dob": "1995-05-01",
                    "timezone": "America/Los_Angeles",
                    "height_cm": 180,
                    "weight_kg": 75,
                },
            )
            self.assertEqual(validate_data_shape.check_profile(root), [])

    def test_bad_dob_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(root, "user_data/coach/profile.json", {"dob": "not-a-date"})
            errors = validate_data_shape.check_profile(root)
            self.assertTrue(any("dob" in e for e in errors))

    def test_non_numeric_height_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(root, "user_data/coach/profile.json", {"height_cm": "tall"})
            errors = validate_data_shape.check_profile(root)
            self.assertTrue(any("height_cm" in e for e in errors))


class TestMemory(unittest.TestCase):
    def test_valid_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(
                root,
                "user_data/coach/memory.json",
                {
                    "notes": {
                        "fitness_baseline": {
                            "text": "5k runner",
                            "updated_at": "2026-08-22T12:00:00Z",
                            "trace_id": "t1",
                        }
                    },
                    "sports": ["running"],
                },
            )
            self.assertEqual(validate_data_shape.check_memory(root), [])

    def test_non_string_note_field_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(
                root,
                "user_data/coach/memory.json",
                {"notes": {"fitness_baseline": {"text": 123, "updated_at": None, "trace_id": "t1"}}},
            )
            errors = validate_data_shape.check_memory(root)
            self.assertTrue(any("notes.fitness_baseline.text" in e for e in errors))

    def test_non_string_sport_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(root, "user_data/coach/memory.json", {"notes": {}, "sports": ["running", 5]})
            errors = validate_data_shape.check_memory(root)
            self.assertTrue(any("sports" in e for e in errors))


class TestInjuries(unittest.TestCase):
    def test_valid_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(
                root,
                "user_data/coach/injuries.json",
                {"flags": [{"id": "inj_20260822_knee", "text": "knee niggle", "status": "active"}]},
            )
            self.assertEqual(validate_data_shape.check_injuries(root), [])

    def test_duplicate_id_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(
                root,
                "user_data/coach/injuries.json",
                {
                    "flags": [
                        {"id": "inj_1", "text": "a", "status": "active"},
                        {"id": "inj_1", "text": "b", "status": "active"},
                    ]
                },
            )
            errors = validate_data_shape.check_injuries(root)
            self.assertTrue(any("duplicate" in e for e in errors))

    def test_bad_status_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(
                root,
                "user_data/coach/injuries.json",
                {"flags": [{"id": "inj_1", "text": "a", "status": "cured"}]},
            )
            errors = validate_data_shape.check_injuries(root)
            self.assertTrue(any("status" in e for e in errors))

    def test_missing_id_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(root, "user_data/coach/injuries.json", {"flags": [{"text": "a", "status": "active"}]})
            errors = validate_data_shape.check_injuries(root)
            self.assertTrue(any("id" in e for e in errors))


class TestSeasons(unittest.TestCase):
    def test_valid_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(
                root,
                "user_data/ledger/seasons.json",
                {
                    "seasons": [
                        {
                            "id": "season_1",
                            "name": "Base",
                            "start_date": "2026-01-01",
                            "end_date": "2026-03-01",
                            "status": "active",
                        }
                    ]
                },
            )
            self.assertEqual(validate_data_shape.check_seasons(root), [])

    def test_bad_status_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(
                root,
                "user_data/ledger/seasons.json",
                {"seasons": [{"id": "s1", "status": "archived", "start_date": "2026-01-01", "end_date": "2026-02-01"}]},
            )
            errors = validate_data_shape.check_seasons(root)
            self.assertTrue(any("status" in e for e in errors))

    def test_bad_date_format_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(
                root,
                "user_data/ledger/seasons.json",
                {"seasons": [{"id": "s1", "status": "active", "start_date": "Jan 1 2026", "end_date": "2026-02-01"}]},
            )
            errors = validate_data_shape.check_seasons(root)
            self.assertTrue(any("start_date" in e for e in errors))


class TestQuests(unittest.TestCase):
    def test_valid_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(
                root,
                "user_data/ledger/quests.json",
                {
                    "main_quest": {
                        "id": "mq1",
                        "name": "Run a marathon",
                        "type": "progress",
                        "target": 42,
                        "season_id": "s1",
                    },
                    "quests": [
                        {
                            "id": "q1",
                            "name": "Daily stretch",
                            "type": "daily_streak",
                            "status": "active",
                            "polarity": "default_not_done",
                            "source": "model",
                        }
                    ],
                },
            )
            self.assertEqual(validate_data_shape.check_quests(root), [])

    def test_main_quest_missing_season_id_fails(self):
        # B3's applySeasonStart silently fails to retire an outgoing goal when season_id is
        # absent instead of erroring - this is the CI-layer check that catches that shape before
        # it reaches a real athlete repo.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(
                root,
                "user_data/ledger/quests.json",
                {"main_quest": {"id": "mq1", "name": "Run a marathon", "type": "progress", "target": 42}},
            )
            errors = validate_data_shape.check_quests(root)
            self.assertTrue(any("season_id" in e for e in errors))

    def test_main_quest_empty_season_id_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(
                root,
                "user_data/ledger/quests.json",
                {
                    "main_quest": {
                        "id": "mq1",
                        "name": "Run a marathon",
                        "type": "progress",
                        "target": 42,
                        "season_id": "",
                    }
                },
            )
            errors = validate_data_shape.check_quests(root)
            self.assertTrue(any("season_id" in e for e in errors))

    def test_null_main_quest_passes(self):
        # main_quest: null (B1) is the genuine, legal "no goal set yet" state - nothing to
        # validate, not an error.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(root, "user_data/ledger/quests.json", {"main_quest": None, "quests": []})
            self.assertEqual(validate_data_shape.check_quests(root), [])

    def test_bad_quest_type_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(
                root,
                "user_data/ledger/quests.json",
                {"quests": [{"id": "q1", "type": "made_up_type", "status": "active", "source": "model"}]},
            )
            errors = validate_data_shape.check_quests(root)
            self.assertTrue(any("type" in e for e in errors))

    def test_bad_polarity_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(
                root,
                "user_data/ledger/quests.json",
                {
                    "quests": [
                        {
                            "id": "q1",
                            "type": "daily_streak",
                            "status": "active",
                            "polarity": "sometimes",
                            "source": "model",
                        }
                    ]
                },
            )
            errors = validate_data_shape.check_quests(root)
            self.assertTrue(any("polarity" in e for e in errors))


class TestProgress(unittest.TestCase):
    def test_valid_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(
                root,
                "user_data/ledger/progress.json",
                {"rows": [{"id": "p1", "quest_id": "q1", "status": "completed", "source": "model"}]},
            )
            self.assertEqual(validate_data_shape.check_progress(root), [])

    def test_bad_status_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(
                root,
                "user_data/ledger/progress.json",
                {"rows": [{"id": "p1", "status": "in_progress", "source": "model"}]},
            )
            errors = validate_data_shape.check_progress(root)
            self.assertTrue(any("status" in e for e in errors))

    def test_bad_source_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(
                root,
                "user_data/ledger/progress.json",
                {"rows": [{"id": "p1", "status": "completed", "source": "human"}]},
            )
            errors = validate_data_shape.check_progress(root)
            self.assertTrue(any("source" in e for e in errors))


class TestProgressions(unittest.TestCase):
    def test_valid_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(
                root,
                "user_data/ledger/progressions.json",
                {
                    "progressions": [
                        {
                            "id": "pg1",
                            "name": "Squat 1RM",
                            "current": "100kg",
                            "target": "140kg",
                            "unit": "kg",
                            "history": [{"date": "2026-08-01", "value": "95kg", "trace_id": "t1"}],
                        }
                    ]
                },
            )
            self.assertEqual(validate_data_shape.check_progressions(root), [])

    def test_bad_history_date_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(
                root,
                "user_data/ledger/progressions.json",
                {
                    "progressions": [
                        {
                            "id": "pg1",
                            "name": "Squat 1RM",
                            "current": "100kg",
                            "target": "140kg",
                            "unit": "kg",
                            "history": [{"date": "08/01/2026", "value": "95kg", "trace_id": "t1"}],
                        }
                    ]
                },
            )
            errors = validate_data_shape.check_progressions(root)
            self.assertTrue(any("history[0].date" in e for e in errors))

    def test_non_string_current_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(
                root,
                "user_data/ledger/progressions.json",
                {"progressions": [{"id": "pg1", "name": "Squat 1RM", "current": 100, "target": "140kg", "unit": "kg"}]},
            )
            errors = validate_data_shape.check_progressions(root)
            self.assertTrue(any("current" in e for e in errors))


class TestMissingFilesSkip(unittest.TestCase):
    def test_missing_files_skip(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(validate_data_shape.validate(Path(tmp)), [])
            self.assertEqual(validate_data_shape.main(["--root", tmp]), 0)


if __name__ == "__main__":
    unittest.main()
