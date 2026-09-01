import importlib.util
import unittest
from pathlib import Path


SCRIPT_PATH = (
    Path(__file__).parent.parent.parent / "kdb" / "scripts" / "check_pr_issue_link.py"
)
REPO_ROOT = Path(__file__).parent.parent.parent
SPEC = importlib.util.spec_from_file_location("check_pr_issue_link", SCRIPT_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def issue_fixture(**overrides):
    issue = {
        "title": "Core: enforce readable issues",
        "body": (
            "This makes issue intake readable. It keeps the board useful.\n\n"
            "## Done when\n1. The check passes.\n\n"
            "## Scope\nTouch the workflow."
        ),
        "labels": [{"name": "area:core"}, {"name": "type:chore"}],
        "milestone": {"title": "M3: Scale to 10 users"},
    }
    issue.update(overrides)
    return issue


class TestPrIssueLink(unittest.TestCase):
    def test_parses_every_repo_local_link_and_finishing_wins(self):
        links = MODULE.parse_issue_links(
            "Refs: #12, #13\nFixes: #13\nPart-of: #14\n"
            "Refs: other/repo#99\n<!-- Fixes: #88 -->"
        )
        self.assertEqual(
            links,
            [
                MODULE.IssueLink(12, False),
                MODULE.IssueLink(13, True),
                MODULE.IssueLink(14, False),
            ],
        )

    def test_live_milestone_title_is_normalized_for_p1_contract(self):
        result = MODULE.run_issue_contract(issue_fixture())
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_later_form_choice_is_the_milestone_contract(self):
        issue = issue_fixture(
            body=(
                "This makes issue intake readable. It keeps the board useful.\n\n"
                "## Done when\n1. The check passes.\n\n"
                "## Scope\nTouch the workflow.\n\n### Milestone\n\nLater"
            ),
            milestone=None,
        )
        self.assertEqual(MODULE.normalize_milestone(issue), "Later")
        self.assertEqual(MODULE.run_issue_contract(issue).returncode, 0)

    def test_invalid_linked_issue_reports_label_and_contract(self):
        issue = issue_fixture(
            labels=[{"name": "area:core"}, {"name": "needs-triage"}],
        )
        errors = MODULE.linked_issue_errors(
            [MODULE.IssueLink(747, False)], lambda _number: issue
        )
        self.assertTrue(any("needs-triage" in error for error in errors))
        self.assertTrue(any("fails the issue contract" in error for error in errors))

    def test_status_selection_follows_pr_lifecycle(self):
        cases = [
            (("opened", True, False, False), "In progress"),
            (("ready_for_review", False, False, False), "In review"),
            (("closed", False, True, True), "Done"),
            (("closed", False, True, False), None),
            (("closed", False, False, True), None),
        ]
        for args, expected in cases:
            with self.subTest(args=args):
                self.assertEqual(MODULE.select_project_status(*args), expected)

    def test_project_token_job_cannot_run_pr_head_code(self):
        pr_workflow = (REPO_ROOT / ".github/workflows/pr-issue-link.yml").read_text()
        target_workflow = (REPO_ROOT / ".github/workflows/issue-hygiene.yml").read_text()
        sync_job = target_workflow.split("  sync-project:\n", 1)[1]

        self.assertNotIn("PROJECT_TOKEN", pr_workflow)
        self.assertIn("pull_request_target:", target_workflow)
        self.assertIn("head.repo.full_name == github.repository", sync_job)
        self.assertIn("ref: ${{ github.event.repository.default_branch }}", sync_job)
        self.assertIn("persist-credentials: false", sync_job)
        self.assertIn("PROJECT_TOKEN: ${{ secrets.PROJECT_TOKEN }}", sync_job)


if __name__ == "__main__":
    unittest.main()
