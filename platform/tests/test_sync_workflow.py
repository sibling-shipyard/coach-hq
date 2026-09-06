"""Guards on `sync.user.yml`'s history staging.

A fresh carve could not reach a green Sync (#850): the carved `.gitignore` lists
`user_data/activities/hist/`, and on a brand-new repo that directory may not exist at all.
Those are two different git failures — exit 1 "paths are ignored" and fatal 128 "pathspec did
not match" — and only the first is cured by `-f`. These tests run the real shell function out
of the workflow rather than reading it, because a regex over YAML cannot tell the two apart.
"""

import re
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = (REPO_ROOT / "engine/.github/workflows/sync.user.yml").read_text()
HIST = "user_data/activities/hist"


def add_history_source() -> str:
    """The `add_history` function body, lifted verbatim from the workflow."""
    match = re.search(r"^\s*add_history\(\) \{\n(.*?)^\s*\}\n", WORKFLOW, re.S | re.M)
    assert match, "add_history() not found in sync.user.yml"
    body = "\n".join(line.strip() for line in match.group(1).splitlines())
    return "add_history() {\n" + body + "\n}\n"


def run_in_repo(script: str, setup: str) -> subprocess.CompletedProcess:
    with tempfile.TemporaryDirectory() as tmp:
        full = (
            "set -e\n"
            f"cd {tmp}\n"
            "git init -q .\n"
            "git config user.email t@t\nGIT_CONFIG_GLOBAL= git config user.name t\n"
            f"printf '{HIST}/\\n' > .gitignore\n"
            "git add .gitignore\n"
            "git commit -qm init\n"
            f"{setup}\n"
            "set +e\n"
            f"{add_history_source()}"
            f"{script}\n"
        )
        return subprocess.run(["bash", "-c", full], capture_output=True, text=True, cwd=tmp)


class TestAddHistory(unittest.TestCase):
    def test_succeeds_when_the_directory_does_not_exist(self):
        # The fresh-carve case. A bare `git add` here is a fatal 128 that -f does not fix.
        r = run_in_repo("add_history; echo rc=$?", setup="true")
        self.assertIn("rc=0", r.stdout)

    def test_succeeds_and_stages_nothing_when_the_directory_is_empty(self):
        r = run_in_repo("add_history; echo rc=$?; git diff --cached --name-only",
                        setup=f"mkdir -p {HIST}")
        self.assertIn("rc=0", r.stdout)
        self.assertNotIn(HIST, r.stdout.split("rc=0")[1])

    def test_stages_an_ignored_untracked_history_file(self):
        # Without -f git refuses this with exit 1; the file must still reach the commit.
        r = run_in_repo("add_history; echo rc=$?; git diff --cached --name-only",
                        setup=f"mkdir -p {HIST} && echo '{{}}' > {HIST}/a.json")
        self.assertIn("rc=0", r.stdout)
        self.assertIn(f"{HIST}/a.json", r.stdout)


class TestWorkflowShape(unittest.TestCase):
    def test_both_call_sites_go_through_the_helper(self):
        self.assertEqual(len(re.findall(r"^\s*add_history$", WORKFLOW, re.M)), 2)

    def test_no_call_site_stages_history_without_the_force_flag(self):
        # The regression this file exists to stop: someone reinstating a bare add.
        bare = re.findall(rf"^\s*git add (?!-f)[^\n]*{re.escape(HIST)}", WORKFLOW, re.M)
        self.assertEqual(bare, [], f"unforced history add reinstated: {bare}")


if __name__ == "__main__":
    unittest.main()
