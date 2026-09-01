import os
import subprocess
import unittest
from pathlib import Path

SCRIPT_PATH = Path(__file__).parent.parent.parent / "kdb" / "scripts" / "check_issue_contract.py"

class TestIssueContract(unittest.TestCase):
    def run_check(self, title, body, labels, milestone):
        env = os.environ.copy()
        env["ISSUE_TITLE"] = title
        env["ISSUE_BODY"] = body
        env["ISSUE_LABELS"] = labels
        env["ISSUE_MILESTONE"] = milestone
        result = subprocess.run(
            [str(SCRIPT_PATH)], env=env, capture_output=True, text=True
        )
        return result

    def test_compliant_fixture(self):
        title = "Area: add feature X"
        body = "We are adding feature X. It matters because Y.\n\n## Done when\n1. pass\n\n## Scope\nTouch: files"
        labels = "area:ui, type:feature"
        milestone = "M3"
        res = self.run_check(title, body, labels, milestone)
        self.assertEqual(res.returncode, 0, f"Expected 0, got stdout:\n{res.stdout}\nstderr:\n{res.stderr}")

    def test_bad_title_length(self):
        title = "Area: " + "a" * 100
        body = "We are adding feature X. It matters because Y.\n\n## Done when\n1. pass\n\n## Scope\nTouch: files"
        labels = "area:ui, type:feature"
        milestone = "M3"
        res = self.run_check(title, body, labels, milestone)
        self.assertEqual(res.returncode, 1)
        self.assertIn("Title exceeds 90 characters.", res.stdout)

    def test_missing_scope(self):
        title = "Area: add feature X"
        body = "We are adding feature X. It matters because Y.\n\n## Done when\n1. pass\n"
        labels = "area:ui, type:feature"
        milestone = "M3"
        res = self.run_check(title, body, labels, milestone)
        self.assertEqual(res.returncode, 1)
        self.assertIn("Body must contain '## Scope' section.", res.stdout)

    def test_two_area_labels(self):
        title = "Area: add feature X"
        body = "We are adding feature X. It matters because Y.\n\n## Done when\n1. pass\n\n## Scope\nTouch: files"
        labels = "area:ui, area:core, type:feature"
        milestone = "M3"
        res = self.run_check(title, body, labels, milestone)
        self.assertEqual(res.returncode, 1)
        self.assertIn("exactly one area:*", res.stdout)

    def test_zero_type_labels(self):
        title = "Area: add feature X"
        body = "We are adding feature X. It matters because Y.\n\n## Done when\n1. pass\n\n## Scope\nTouch: files"
        labels = "area:ui"
        milestone = "M3"
        res = self.run_check(title, body, labels, milestone)
        self.assertEqual(res.returncode, 1)
        self.assertIn("exactly one type:*", res.stdout)

    def test_bad_milestone_value(self):
        title = "Area: add feature X"
        body = "We are adding feature X. It matters because Y.\n\n## Done when\n1. pass\n\n## Scope\nTouch: files"
        labels = "area:ui, type:feature"
        milestone = "M2"
        res = self.run_check(title, body, labels, milestone)
        self.assertEqual(res.returncode, 1)
        self.assertIn("Milestone must be M3, M4, or Later.", res.stdout)

    def test_heading_at_start(self):
        title = "Area: add feature X"
        body = "## Goal\nWe are adding feature X. It matters because Y.\n\n## Done when\n1. pass\n\n## Scope\nTouch: files"
        labels = "area:ui, type:feature"
        milestone = "M3"
        res = self.run_check(title, body, labels, milestone)
        self.assertEqual(res.returncode, 1)
        self.assertIn("Body must start with two short sentences, no heading.", res.stdout)

    def test_github_form_heading_ignored(self):
        title = "Area: add feature X"
        body = "### Issue Body\n\nWe are adding feature X. It matters because Y.\n\n## Done when\n1. pass\n\n## Scope\nTouch: files"
        labels = "area:ui, type:feature"
        milestone = "M3"
        res = self.run_check(title, body, labels, milestone)
        self.assertEqual(res.returncode, 0, res.stdout)

    def test_one_sentence_intro_fails(self):
        body = "We are adding feature X.\n\n## Done when\n1. pass\n\n## Scope\nTouch: files"
        res = self.run_check(
            "Area: add feature X", body, "area:ui, type:feature", "M3"
        )
        self.assertEqual(res.returncode, 1)
        self.assertIn("exactly two sentence terminators", res.stdout)
        self.assertIn("found 1", res.stdout)

    def test_unchanged_form_placeholder_fails(self):
        body = "### Issue Body\n\n[what changes] [why it matters]\n\n## Done when\n1. pass\n\n## Scope\nTouch: files"
        res = self.run_check(
            "Area: add feature X", body, "area:ui, type:feature", "M3"
        )
        self.assertEqual(res.returncode, 1)
        self.assertIn("Replace the issue form placeholder", res.stdout)

    def test_form_placeholder_with_appended_sentences_fails(self):
        body = "### Issue Body\n\n[what changes] [why it matters] Add feature X. It matters because Y.\n\n## Done when\n1. pass\n\n## Scope\nTouch: files"
        res = self.run_check(
            "Area: add feature X", body, "area:ui, type:feature", "M3"
        )
        self.assertEqual(res.returncode, 1)
        self.assertIn("Replace the issue form placeholder", res.stdout)

    def test_markdown_bold_sentences_pass(self):
        body = "**Add feature X.** **It matters because Y.**\n\n## Done when\n1. pass\n\n## Scope\nTouch: files"
        res = self.run_check(
            "Area: add feature X", body, "area:ui, type:feature", "M3"
        )
        self.assertEqual(res.returncode, 0, res.stdout)

    def test_three_sentence_intro_fails(self):
        body = "We are adding feature X. It matters because Y. This is extra.\n\n## Done when\n1. pass\n\n## Scope\nTouch: files"
        res = self.run_check(
            "Area: add feature X", body, "area:ui, type:feature", "M3"
        )
        self.assertEqual(res.returncode, 1)
        self.assertIn("exactly two sentence terminators", res.stdout)
        self.assertIn("found 3", res.stdout)

    def test_dot_inside_file_name_is_not_a_sentence_terminator(self):
        body = "Update foo.py in CI. This keeps the gate honest.\n\n## Done when\n1. pass\n\n## Scope\nTouch: files"
        res = self.run_check(
            "Area: add feature X", body, "area:ui, type:feature", "M3"
        )
        self.assertEqual(res.returncode, 0, res.stdout)

    def test_intro_over_300_characters_fails(self):
        body = f"{'A' * 148}. {'B' * 150}.\n\n## Done when\n1. pass\n\n## Scope\nTouch: files"
        res = self.run_check(
            "Area: add feature X", body, "area:ui, type:feature", "M3"
        )
        self.assertEqual(res.returncode, 1)
        self.assertIn("Body intro must be at most 300 characters", res.stdout)
        self.assertIn("found 301", res.stdout)

if __name__ == "__main__":
    unittest.main()
