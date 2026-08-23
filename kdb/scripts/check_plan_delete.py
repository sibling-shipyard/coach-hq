#!/usr/bin/env python3
"""Fail if a PR says it finishes a plan but doesn't delete the plan file.

AGENTS.md § Doc upkeep rule 3: the PR that finishes a docs/plans/<file> plan's
work must delete that file in the same PR. This checks the PR template's
`**Plan delete?**` answer against the PR's actual changed files.

- Answer starts with "Yes" -> the PR diff must delete at least one file under
  docs/plans/.
- Answer is "No" / "N/A" / anything else recognized -> pass, no check needed.
- No `Plan delete?` line at all (older/hand-written body) -> skip, pass.
"""
import json
import os
import re
import sys
import urllib.request

BODY = os.environ.get("PR_BODY") or ""
# Strip HTML comments (template hints) before scanning for the answer.
BODY_STRIPPED = re.sub(r"<!--.*?-->", "", BODY, flags=re.S)

ANSWER_RE = re.compile(r"(?im)^\*{0,2}\s*Plan delete\?\s*\*{0,2}\s*(.+)$")


def get_answer(body):
    """Return the text after `**Plan delete?**` on its line, or None if absent."""
    m = ANSWER_RE.search(body)
    if not m:
        return None
    return m.group(1).strip()


def get_changed_files():
    """Return (filename, status) pairs for this PR's changed files, via the GitHub API.

    status is GitHub's per-file status ("added", "modified", "removed", ...).
    Reads GITHUB_REPOSITORY (owner/repo) and PR_NUMBER from the environment,
    optionally authenticating with GITHUB_TOKEN. Paginates in case a PR
    touches more than 100 files.
    """
    repo = os.environ.get("GITHUB_REPOSITORY")
    pr_number = os.environ.get("PR_NUMBER")
    if not repo or not pr_number:
        raise RuntimeError(
            "GITHUB_REPOSITORY and PR_NUMBER must be set to fetch changed files"
        )

    token = os.environ.get("GITHUB_TOKEN")
    files = []
    page = 1
    while True:
        url = (
            f"https://api.github.com/repos/{repo}/pulls/{pr_number}/files"
            f"?per_page=100&page={page}"
        )
        req = urllib.request.Request(url)
        req.add_header("Accept", "application/vnd.github+json")
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        with urllib.request.urlopen(req) as resp:
            batch = json.loads(resp.read().decode("utf-8"))
        if not batch:
            break
        files.extend((entry["filename"], entry["status"]) for entry in batch)
        if len(batch) < 100:
            break
        page += 1
    return files


def main():
    answer = get_answer(BODY_STRIPPED)

    if answer is None:
        print("check-plan-delete SKIPPED: no `Plan delete?` line in PR body")
        return 0

    if not answer.lower().startswith("yes"):
        print(f"check-plan-delete OK: answer is '{answer}', no plan file to check")
        return 0

    try:
        changed_files = get_changed_files()
    except Exception as exc:  # noqa: BLE001 - surface any fetch failure clearly
        print(f"check-plan-delete FAILED: could not fetch changed files: {exc}")
        return 1

    deleted_plans = [
        f for f, status in changed_files
        if f.startswith("docs/plans/") and status == "removed"
    ]
    if not deleted_plans:
        print(
            "check-plan-delete FAILED: `Plan delete?` answered Yes but no file "
            "under docs/plans/ was changed. Delete the finished plan in this PR, "
            "or fix the answer to No/N/A. See AGENTS.md § Doc upkeep."
        )
        return 1

    print(f"check-plan-delete OK: {', '.join(deleted_plans)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
