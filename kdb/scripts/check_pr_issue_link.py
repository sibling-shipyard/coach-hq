#!/usr/bin/env python3
"""Fail if a PR body has neither Refs: #N nor Fixes: #N (board goes stale otherwise).

Closing keywords (Fixes/Closes/Resolves) and linking keywords (Refs/Part of) both count.
Mid-stack PRs should use Refs; the finishing PR uses Fixes — enforced in review, not here.
"""
import os, re, sys

BODY = os.environ.get("PR_BODY") or ""
# Strip HTML comments (template hints)
BODY = re.sub(r"<!--.*?-->", "", BODY, flags=re.S)

# Allow **Fixes:** / Fixes: / refs #12 — markdown bold wraps the label+colon oddly.
LINK_RE = re.compile(
    r"(?i)\*{0,2}\s*(?:refs|part[\s-]*of|fixes|closes|resolves)\s*:?\s*\*{0,2}\s*#\d+"
)

if LINK_RE.search(BODY):
    print("pr-issue-link OK")
    sys.exit(0)

print(
    "pr-issue-link FAILED: PR body must include `Refs: #N` (mid-stack) or "
    "`Fixes: #N` (finishing PR). See .github/CONVENTIONS.md § PR Body."
)
sys.exit(1)
