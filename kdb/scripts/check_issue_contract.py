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

    lines = body_clean.splitlines()
    while lines and not lines[0].strip():
        lines.pop(0)
    # GitHub forms add this heading above the textarea value.
    if lines and lines[0].strip() == "### Issue Body":
        lines.pop(0)
        while lines and not lines[0].strip():
            lines.pop(0)

    content = "\n".join(lines)
    intro_block = re.split(r"(?m)^##(?:\s|$)", content, maxsplit=1)[0]
    intro = " ".join(intro_block.split())

    if not content.strip():
        errors.append("Body is empty.")
    elif content.lstrip().startswith("#"):
        errors.append("Body must start with two short sentences, no heading.")
    elif not intro:
        errors.append("Body must start with two short sentences, no heading.")
    elif intro == "[what changes] [why it matters]":
        errors.append("Replace the issue form placeholder with two short sentences.")
    else:
        terminator_count = len(re.findall(r"[.!?](?=\s|$)", intro))
        if terminator_count != 2:
            errors.append(
                "Body intro must contain exactly two sentence terminators (. ! or ?); "
                f"found {terminator_count}."
            )
        if len(intro) > 300:
            errors.append(
                f"Body intro must be at most 300 characters; found {len(intro)}."
            )

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
