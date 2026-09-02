#!/usr/bin/env python3
"""Validate PR issue links and keep linked Project 4 items in sync."""

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.request
from urllib.error import HTTPError
from dataclasses import dataclass
from pathlib import Path


CONTRACT_SCRIPT = Path(__file__).with_name("check_issue_contract.py")
PROJECT_ID = "PVT_kwDOElXMTc4BfAqi"
STATUS_FIELD_ID = "PVTSSF_lADOElXMTc4BfAqizhZWtcs"
STATUS_OPTIONS = {
    "Backlog": "f75ad846",
    "In progress": "47fc9ee4",
    "In review": "df73e18b",
    "Done": "98236657",
}
PROJECT_NUMBER = 4

KEYWORD_RE = re.compile(
    r"(?i)\*{0,2}\s*(refs|part[\s-]*of|fixes|closes|resolves)\s*:?\s*\*{0,2}"
)
LOCAL_ISSUE_RE = re.compile(r"(?<![A-Za-z0-9_./-])#(\d+)\b")
FINISHING_KEYWORDS = {"fixes", "closes", "resolves"}


@dataclass(frozen=True)
class IssueLink:
    number: int
    finishing: bool


def strip_comments(body):
    return re.sub(r"<!--.*?-->", "", body or "", flags=re.S)


def parse_issue_links(body):
    """Return every bare, repo-local issue linked by a supported keyword."""
    clean = strip_comments(body)
    found = {}
    for line in clean.splitlines():
        matches = list(KEYWORD_RE.finditer(line))
        for index, match in enumerate(matches):
            end = matches[index + 1].start() if index + 1 < len(matches) else len(line)
            keyword = re.sub(r"[\s-]", "", match.group(1).lower())
            finishing = keyword in FINISHING_KEYWORDS
            for raw_number in LOCAL_ISSUE_RE.findall(line[match.end():end]):
                number = int(raw_number)
                found[number] = found.get(number, False) or finishing
    return [IssueLink(number, finishing) for number, finishing in found.items()]


def normalize_milestone(issue):
    """Translate live milestone titles and the form's Later choice to contract codes."""
    title = (issue.get("milestone") or {}).get("title", "")
    for code in ("M3", "M4"):
        if title == code or title.startswith(f"{code}:"):
            return code

    body_match = re.search(
        r"(?im)^### Milestone\s+(M3|M4|Later)\s*$", issue.get("body") or ""
    )
    return body_match.group(1) if body_match else title


def issue_contract_env(issue):
    labels = issue.get("labels") or []
    label_names = [
        label.get("name", "") if isinstance(label, dict) else label
        for label in labels
    ]
    env = os.environ.copy()
    env.update(
        ISSUE_TITLE=issue.get("title") or "",
        ISSUE_BODY=issue.get("body") or "",
        ISSUE_LABELS=", ".join(label_names),
        ISSUE_MILESTONE=normalize_milestone(issue),
    )
    return env


def run_issue_contract(issue):
    return subprocess.run(
        [sys.executable, str(CONTRACT_SCRIPT)],
        env=issue_contract_env(issue),
        capture_output=True,
        text=True,
        check=False,
    )


def api_issue(repo, number, token):
    request = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/issues/{number}",
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read().decode("utf-8"))


def api_parent_issue(repo, number, token):
    request = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/issues/{number}/parent",
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.urlopen(request) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        if exc.code == 404:
            return None
        raise


def label_names(issue):
    return {
        label.get("name", "") if isinstance(label, dict) else label
        for label in issue.get("labels") or []
    }


def hierarchy_errors(issue, fetch_parent):
    """Require open M3/M4 work to reach one open, same-milestone epic."""
    if issue.get("state", "open").lower() != "open":
        return []
    horizon = normalize_milestone(issue)
    if horizon not in {"M3", "M4"}:
        return []

    chain = [issue]
    seen = {issue.get("number")}
    while True:
        current = chain[-1]
        parent = fetch_parent(current["number"])
        if parent is None:
            break
        number = parent.get("number")
        if number in seen:
            return [f"#{issue['number']} has a cycle in its native parent chain."]
        seen.add(number)
        chain.append(parent)
        if len(chain) > 10:
            return [f"#{issue['number']} has a native parent chain deeper than 10 issues."]

    errors = []
    for child in chain[:-1]:
        if "epic" in label_names(child):
            errors.append(
                f"#{child['number']} is a child issue but has the epic label."
            )

    root = chain[-1]
    if "epic" not in label_names(root):
        errors.append(
            f"#{issue['number']} does not reach an epic through native parent links."
        )
        return errors
    if root.get("state", "open").lower() != "open":
        errors.append(f"#{issue['number']} reaches closed epic #{root['number']}.")
    root_horizon = normalize_milestone(root)
    if root_horizon != horizon:
        errors.append(
            f"#{issue['number']} is {horizon} but reaches {root_horizon or 'no-milestone'} "
            f"epic #{root['number']}."
        )
    return errors


def linked_issue_errors(links, fetch_issue, fetch_parent, validator=run_issue_contract):
    errors = []
    for link in links:
        issue = fetch_issue(link.number)
        if "needs-triage" in label_names(issue):
            errors.append(f"#{link.number} has the needs-triage label.")

        result = validator(issue)
        if result.returncode:
            detail = (result.stdout or result.stderr).strip()
            errors.append(f"#{link.number} fails the issue contract:\n{detail}")
        errors.extend(hierarchy_errors(issue, fetch_parent))
    return errors


def graphql(token, query, variables):
    request = urllib.request.Request(
        "https://api.github.com/graphql",
        data=json.dumps({"query": query, "variables": variables}).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(request) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if payload.get("errors"):
        raise RuntimeError(json.dumps(payload["errors"]))
    return payload["data"]


def project_item(repo, issue_number, token):
    owner, name = repo.split("/", 1)
    query = """
      query($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
          issue(number: $number) {
            projectItems(first: 20) {
              nodes {
                id
                project { id number }
                fieldValueByName(name: "Status") {
                  ... on ProjectV2ItemFieldSingleSelectValue { name optionId }
                }
              }
            }
          }
        }
      }
    """
    data = graphql(
        token,
        query,
        {"owner": owner, "name": name, "number": issue_number},
    )
    issue = data.get("repository", {}).get("issue")
    if not issue:
        raise RuntimeError(f"#{issue_number} was not found in {repo}")
    for item in issue["projectItems"]["nodes"]:
        project = item.get("project") or {}
        if project.get("id") == PROJECT_ID and project.get("number") == PROJECT_NUMBER:
            status = item.get("fieldValueByName") or {}
            return item["id"], status.get("name")
    return None, None


def update_project_status(item_id, status, token):
    mutation = """
      mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $project
          itemId: $item
          fieldId: $field
          value: { singleSelectOptionId: $option }
        }) { projectV2Item { id } }
      }
    """
    graphql(
        token,
        mutation,
        {
            "project": PROJECT_ID,
            "item": item_id,
            "field": STATUS_FIELD_ID,
            "option": STATUS_OPTIONS[status],
        },
    )


def sync_project_status(repo, issue_numbers, status, token, only_if_current=None):
    for number in issue_numbers:
        item_id, current = project_item(repo, number, token)
        if not item_id:
            print(f"::warning::#{number} is not on Project 4 yet; status sync skipped.")
            continue
        if only_if_current and current != only_if_current:
            print(f"#{number} is {current or 'unset'}, not {only_if_current}; no status change.")
            continue
        if current == status:
            print(f"#{number} is already {status}.")
            continue
        update_project_status(item_id, status, token)
        print(f"#{number}: {current or 'unset'} -> {status}")


def select_project_status(action, draft, merged, has_finishing):
    if action == "closed":
        return "Done" if merged and has_finishing else None
    return "In progress" if draft else "In review"


def require_repo_and_token(token_name):
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    token = os.environ.get(token_name, "")
    if not repo or not token:
        raise RuntimeError(f"GITHUB_REPOSITORY and {token_name} must be set")
    return repo, token


def check_pr():
    links = parse_issue_links(os.environ.get("PR_BODY", ""))
    if not links:
        print(
            "pr-issue-link FAILED: PR body must include `Refs: #N` (mid-stack) or "
            "`Fixes: #N` (finishing PR). See .github/CONVENTIONS.md § PR Body."
        )
        return 1

    try:
        repo, token = require_repo_and_token("GITHUB_TOKEN")
        errors = linked_issue_errors(
            links,
            lambda number: api_issue(repo, number, token),
            lambda number: api_parent_issue(repo, number, token),
        )
    except Exception as exc:  # noqa: BLE001 - API failures must fail the merge gate
        print(f"pr-issue-link FAILED: could not validate linked issues: {exc}")
        return 1

    if errors:
        print("pr-issue-link FAILED:")
        for error in errors:
            print(f"- {error}")
        return 1
    print("pr-issue-link OK: " + ", ".join(f"#{link.number}" for link in links))
    return 0


def check_issue_event():
    issue = json.loads(os.environ.get("ISSUE_JSON") or "{}")
    result = run_issue_contract(issue)
    if result.stdout:
        print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr)
    return result.returncode


def sync_pr_event():
    repo, token = require_repo_and_token("PROJECT_TOKEN")
    links = parse_issue_links(os.environ.get("PR_BODY", ""))
    action = os.environ.get("PR_ACTION", "")
    draft = os.environ.get("PR_DRAFT", "false").lower() == "true"
    merged = os.environ.get("PR_MERGED", "false").lower() == "true"
    status = select_project_status(
        action, draft, merged, any(link.finishing for link in links)
    )
    if not status:
        print("Project status sync skipped: this PR event does not change issue status.")
        return 0
    targets = [link.number for link in links if status != "Done" or link.finishing]
    sync_project_status(repo, targets, status, token)
    return 0


def ensure_invalid_backlog():
    repo, token = require_repo_and_token("PROJECT_TOKEN")
    number = int(os.environ["ISSUE_NUMBER"])
    sync_project_status(repo, [number], "Backlog", token, only_if_current="Ready")
    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "mode",
        nargs="?",
        choices=("check-pr", "check-issue-event", "sync-pr", "ensure-invalid-backlog"),
        default="check-pr",
    )
    args = parser.parse_args()
    try:
        return {
            "check-pr": check_pr,
            "check-issue-event": check_issue_event,
            "sync-pr": sync_pr_event,
            "ensure-invalid-backlog": ensure_invalid_backlog,
        }[args.mode]()
    except Exception as exc:  # noqa: BLE001 - workflow output should name the failed operation
        print(f"{args.mode} FAILED: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
