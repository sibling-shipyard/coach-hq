#!/usr/bin/env python3
"""Temp-JSON fixtures for validate-text-caps.py — HQ has no live user_data/."""

from __future__ import annotations

import importlib.util
import json
import re
import tempfile
import unittest
from pathlib import Path

_SCRIPT = Path(__file__).resolve().parent / "validate-text-caps.py"
_SPEC = importlib.util.spec_from_file_location("validate_text_caps", _SCRIPT)
assert _SPEC and _SPEC.loader
validate_text_caps = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(validate_text_caps)


def _write(root: Path, rel: str, payload: object) -> None:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload))


def _valid_log(text: str = "session note") -> dict:
    return {
        "version": 1,
        "rows": [
            {
                "id": "r1",
                "date": "2026-08-22",
                "ts": "2026-08-22T12:00:00Z",
                "type": "chat",
                "text": text,
                "trace_id": "t1",
            }
        ],
    }


def _valid_memory(text: str = "baseline") -> dict:
    note = {"text": text, "updated_at": "2026-08-22T12:00:00Z", "trace_id": "t1"}
    return {
        "version": 1,
        "_meta": {"updated_at": "2026-08-22T12:00:00Z", "updated_by": "coach", "trace_id": "t1"},
        "sports": [],
        "coaching_style": None,
        "notes": {
            "fitness_baseline": note,
            "coaching_priorities": {"text": "", "updated_at": "", "trace_id": ""},
            "learned_patterns.training": {"text": "", "updated_at": "", "trace_id": ""},
            "learned_patterns.nutrition": {"text": "", "updated_at": "", "trace_id": ""},
            "learned_patterns.mental": {"text": "", "updated_at": "", "trace_id": ""},
            "equipment": {"text": "", "updated_at": "", "trace_id": ""},
        },
    }


def _valid_injuries(text: str = "knee niggle") -> dict:
    return {
        "flags": [
            {
                "id": "f1",
                "text": text,
                "status": "active",
                "opened_at": "2026-08-22T12:00:00Z",
                "resolved_at": None,
            }
        ]
    }


class TestValidateTextCaps(unittest.TestCase):
    def test_missing_files_skip(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(validate_text_caps.validate(Path(tmp)), [])
            self.assertEqual(validate_text_caps.main(["--root", tmp]), 0)

    def test_valid_fixture_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(root, "user_data/coach/coach_log.json", _valid_log())
            _write(root, "user_data/coach/memory.json", _valid_memory())
            _write(root, "user_data/coach/injuries.json", _valid_injuries())
            self.assertEqual(validate_text_caps.validate(root), [])
            self.assertEqual(validate_text_caps.main(["--root", tmp]), 0)

    def test_oversized_coach_log_row_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(root, "user_data/coach/coach_log.json", _valid_log("x" * 2001))
            errors = validate_text_caps.validate(root)
            self.assertTrue(errors)
            self.assertIn("rows[0].text", errors[0])
            self.assertIn("2001", errors[0])
            self.assertEqual(validate_text_caps.main(["--root", tmp]), 1)

    def test_oversized_memory_note_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(root, "user_data/coach/memory.json", _valid_memory("y" * 1501))
            errors = validate_text_caps.validate(root)
            self.assertTrue(any("notes.fitness_baseline.text" in e for e in errors))
            self.assertEqual(validate_text_caps.main(["--root", tmp]), 1)

    def test_oversized_injury_flag_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(root, "user_data/coach/injuries.json", _valid_injuries("z" * 501))
            errors = validate_text_caps.validate(root)
            self.assertTrue(any("flags[0].text" in e for e in errors))
            self.assertEqual(validate_text_caps.main(["--root", tmp]), 1)

    def test_non_string_text_field_fails_instead_of_skipping(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(root, "user_data/coach/coach_log.json", _valid_log(12345))
            errors = validate_text_caps.validate(root)
            self.assertTrue(any("rows[0].text is int, not a string" in e for e in errors))
            self.assertEqual(validate_text_caps.main(["--root", tmp]), 1)


class TestCapConstantsMatchTypeScript(unittest.TestCase):
    """text-caps.mts is the source of truth (issue #462) - this file's three constants are
    hand-duplicated because Python can't import a .mts module. Catch drift instead of trusting
    the comment."""

    def test_python_caps_match_engine_lib_text_caps_mts(self):
        ts_path = Path(__file__).resolve().parents[1] / "lib" / "text-caps.mts"
        source = ts_path.read_text()
        expected = {
            "COACH_LOG_TEXT_CAP": validate_text_caps.COACH_LOG_TEXT_CAP,
            "MEMORY_NOTE_TEXT_CAP": validate_text_caps.MEMORY_NOTE_TEXT_CAP,
            "INJURY_FLAG_TEXT_CAP": validate_text_caps.INJURY_FLAG_TEXT_CAP,
        }
        for name, python_value in expected.items():
            match = re.search(rf"export const {name} = (\d+);", source)
            self.assertIsNotNone(match, f"{name} not found in {ts_path}")
            ts_value = int(match.group(1))
            self.assertEqual(
                ts_value,
                python_value,
                f"{name}: text-caps.mts has {ts_value}, validate-text-caps.py has {python_value} - keep them in sync",
            )


if __name__ == "__main__":
    unittest.main()
