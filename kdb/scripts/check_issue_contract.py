#!/usr/bin/env python3
"""Fail if an issue does not meet the hygiene contract.

Checks title format, body structure, labels, and milestone.
"""
import os, sys, re

def main():
    title = os.environ.get("ISSUE_TITLE", "")
    body = os.environ.get("ISSUE_BODY", "")
    labels_str = os.environ.get("ISSUE_LABELS", "")
    milestone = os.environ.get("ISSUE_MILESTONE", "")

    labels = [l.strip() for l in labels_str.split(",") if l.strip()]
    errors = []

    if len(title) > 90:
        errors.append("Title exceeds 90 characters.")
    if not re.match(r"^[^:]+:\s+.+", title):
        errors.append("Title must follow 'Area: plain-English problem' format.")

    body_clean = re.sub(r"<!--.*?-->", "", body, flags=re.S)
    if "## Done when" not in body_clean:
        errors.append("Body must contain '## Done when' section.")
    if "## Scope" not in body_clean:
        errors.append("Body must contain '## Scope' section.")

    lines = [line.strip() for line in body_clean.splitlines() if line.strip()]
    # Ignore GitHub forms auto-generated headings
    while lines and lines[0].startswith("### "):
        lines.pop(0)

    if not lines:
        errors.append("Body is empty.")
    elif lines[0].startswith("#"):
        errors.append("Body must start with two short sentences, no heading.")

    area_labels = [l for l in labels if l.startswith("area:")]
    type_labels = [l for l in labels if l.startswith("type:")]

    if len(area_labels) != 1:
        errors.append("Must have exactly one area:* label.")
    if len(type_labels) != 1:
        errors.append("Must have exactly one type:* label.")

    if milestone not in {"M3", "M4", "Later"}:
        errors.append("Milestone must be M3, M4, or Later.")

    if errors:
        print("issue-contract FAILED:")
        for err in errors:
            print(f"- {err}")
        sys.exit(1)

    print("issue-contract OK")
    sys.exit(0)

if __name__ == "__main__":
    main()
