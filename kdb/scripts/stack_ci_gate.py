#!/usr/bin/env python3
"""Skip an expensive CI job when an upstack PR would also trigger it.

Skip workflow W on PR P iff some transitive upstack open PR also changes files
matching W's path globs. A docs PR on top of an iOS PR must not eat the iOS run.

Fail open: if GitHub is unreachable or no token is set, do not skip.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request


def path_matches(path: str, glob: str) -> bool:
    glob = glob.strip()
    if not glob or glob in {"*", "always"}:
        return True
    if glob.endswith("/**"):
        prefix = glob[:-3].rstrip("/")
        return path == prefix or path.startswith(prefix + "/")
    if glob.endswith("/*"):
        prefix = glob[:-2].rstrip("/")
        rest = path[len(prefix) + 1 :] if path.startswith(prefix + "/") else ""
        return path.startswith(prefix + "/") and rest != "" and "/" not in rest
    return path == glob or path.startswith(glob.rstrip("/") + "/")


def upstack_prs(head_ref: str, pulls: list[dict]) -> list[dict]:
    by_base: dict[str, list[dict]] = {}
    for pull in pulls:
        by_base.setdefault(pull["base"], []).append(pull)
    out: list[dict] = []
    seen: set[str] = set()
    stack = list(by_base.get(head_ref, []))
    while stack:
        pull = stack.pop()
        if pull["head"] in seen:
            continue
        seen.add(pull["head"])
        out.append(pull)
        stack.extend(by_base.get(pull["head"], []))
    return out


def should_skip(head_ref: str, pulls: list[dict], files_by_head: dict[str, list[str]], globs: list[str]) -> bool:
    for pull in upstack_prs(head_ref, pulls):
        for path in files_by_head.get(pull["head"], []):
            if any(path_matches(path, glob) for glob in globs):
                return True
    return False


def _token() -> str:
    return os.environ.get("GITHUB_TOKEN") or os.environ.get("GITHUB_PAT") or ""


def _repo() -> str:
    if os.environ.get("GITHUB_REPOSITORY"):
        return os.environ["GITHUB_REPOSITORY"]
    owner = os.environ.get("VERCEL_GIT_REPO_OWNER", "")
    slug = os.environ.get("VERCEL_GIT_REPO_SLUG", "")
    if owner and slug:
        return f"{owner}/{slug}"
    return ""


def _get_json(url: str, token: str):
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "coach-hq-stack-ci-gate",
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_open_pulls(repo: str, token: str) -> list[dict]:
    raw = _get_json(
        f"https://api.github.com/repos/{repo}/pulls?state=open&per_page=100",
        token,
    )
    return [
        {
            "number": item["number"],
            "head": item["head"]["ref"],
            "base": item["base"]["ref"],
        }
        for item in raw
    ]


def fetch_pull_files(repo: str, number: int, token: str) -> list[str]:
    raw = _get_json(
        f"https://api.github.com/repos/{repo}/pulls/{number}/files?per_page=100",
        token,
    )
    return [item["filename"] for item in raw]


def decide(head_ref: str, globs: list[str]) -> bool:
    """Return True when the job should RUN (not skip). Fail open on errors."""
    token = _token()
    repo = _repo()
    if not token or not repo or not head_ref:
        return True
    try:
        pulls = fetch_open_pulls(repo, token)
        files_by_head = {}
        for pull in upstack_prs(head_ref, pulls):
            files_by_head[pull["head"]] = fetch_pull_files(repo, pull["number"], token)
        return not should_skip(head_ref, pulls, files_by_head, globs)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError, KeyError):
        return True


def vercel_ignore(globs: list[str]) -> int:
    """Vercel ignoreCommand: 0 skip build, 1 proceed. Production always builds."""
    if os.environ.get("VERCEL_ENV") == "production":
        return 1
    diff = subprocess.run(
        ["git", "diff", "--quiet", "HEAD^", "HEAD", "--", "."],
        check=False,
    )
    if diff.returncode == 0:
        return 0
    head_ref = os.environ.get("VERCEL_GIT_COMMIT_REF") or os.environ.get("GITHUB_HEAD_REF") or ""
    return 1 if decide(head_ref, globs) else 0


def self_test() -> int:
    pulls = [
        {"number": 1, "head": "pr-a", "base": "main"},
        {"number": 2, "head": "pr-b", "base": "pr-a"},
        {"number": 3, "head": "pr-c", "base": "pr-b"},
    ]
    files = {
        "pr-a": ["ios/CoachHQ/Foo.swift"],
        "pr-b": ["docs/eng-docs/x.md"],
        "pr-c": ["docs/plans/y.md"],
    }
    assert should_skip("pr-a", pulls, files, ["ios/**"]) is False
    assert should_skip("pr-b", pulls, files, ["ios/**"]) is False
    files_ui_stack = {
        "pr-a": ["ios/CoachHQ/Foo.swift"],
        "pr-b": ["ios/CoachHQ/Bar.swift"],
        "pr-c": ["ios/CoachHQ/Baz.swift"],
    }
    assert should_skip("pr-a", pulls, files_ui_stack, ["ios/**"]) is True
    assert should_skip("pr-b", pulls, files_ui_stack, ["ios/**"]) is True
    assert should_skip("pr-c", pulls, files_ui_stack, ["ios/**"]) is False
    mixed = {
        "pr-a": ["ios/CoachHQ/Foo.swift"],
        "pr-b": ["docs/x.md"],
        "pr-c": ["ui/client/src/App.tsx"],
    }
    assert should_skip("pr-a", pulls, mixed, ["ios/**"]) is False
    assert should_skip("pr-a", pulls, mixed, ["ui/**"]) is True
    assert path_matches("ios/CoachHQ/Foo.swift", "ios/**")
    assert not path_matches("ui/client/x.tsx", "ios/**")
    print("stack_ci_gate self-test OK")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--head-ref", default="")
    parser.add_argument("--paths", default="", help="comma-separated path globs")
    parser.add_argument("--output-env", default="", help="GitHub Actions output name")
    parser.add_argument("--vercel", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    globs = [part.strip() for part in args.paths.split(",") if part.strip()] or ["*"]

    if args.self_test:
        return self_test()
    if args.vercel:
        return vercel_ignore(globs)

    head_ref = args.head_ref or os.environ.get("GITHUB_HEAD_REF") or ""
    run = decide(head_ref, globs)
    value = "true" if run else "false"
    print(f"stack_ci_gate run={value} head={head_ref} paths={globs}")
    if args.output_env:
        out = os.environ.get("GITHUB_OUTPUT")
        if out:
            with open(out, "a", encoding="utf-8") as handle:
                handle.write(f"{args.output_env}={value}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
