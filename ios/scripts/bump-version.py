#!/usr/bin/env python3
"""Bump MARKETING_VERSION in CoachHQ.xcodeproj for the app + widget targets.

Usage: ios/scripts/bump-version.py <patch|minor|major>

See docs/eng-docs/ios-xcode-setup.md for when to use which bump kind.

Only touches XCBuildConfiguration blocks whose PRODUCT_BUNDLE_IDENTIFIER is the
app or widget target. The CoachHQTests target has its own independent
MARKETING_VERSION and is left untouched.
"""

import re
import sys
from pathlib import Path

PBXPROJ = (
    Path(__file__).resolve().parent.parent
    / "CoachHQ"
    / "CoachHQ.xcodeproj"
    / "project.pbxproj"
)
BUMPABLE_BUNDLE_IDS = {
    "com.siblingshipyard.coachhq.app",
    "com.siblingshipyard.coachhq.app.widget",
}
BUMP_KINDS = ("patch", "minor", "major")

# One XCBuildConfiguration block: from its opening brace to the matching "\t\t};".
BLOCK_RE = re.compile(
    r"\{\n\t\t\tisa = XCBuildConfiguration;.*?\n\t\t\};", re.DOTALL
)
BUNDLE_ID_RE = re.compile(r"PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);")
MARKETING_VERSION_RE = re.compile(r"MARKETING_VERSION = ([^;]+);")


def next_version(current: str, kind: str) -> str:
    parts = current.split(".")
    if len(parts) != 3 or not all(p.isdigit() for p in parts):
        raise SystemExit(f"error: current version '{current}' is not X.Y.Z")
    major, minor, patch = (int(p) for p in parts)
    if kind == "major":
        return f"{major + 1}.0.0"
    if kind == "minor":
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"


def bumpable_versions(text: str) -> list:
    versions = []
    for block in BLOCK_RE.findall(text):
        bundle_id_match = BUNDLE_ID_RE.search(block)
        if not bundle_id_match or bundle_id_match.group(1) not in BUMPABLE_BUNDLE_IDS:
            continue
        version_match = MARKETING_VERSION_RE.search(block)
        if not version_match:
            raise SystemExit(
                f"error: block for {bundle_id_match.group(1)} has no "
                "MARKETING_VERSION to bump"
            )
        versions.append((bundle_id_match.group(1), version_match.group(1)))
    return versions


def bump(text: str, new_version: str) -> str:
    def replace_block(match: re.Match) -> str:
        block = match.group(0)
        bundle_id_match = BUNDLE_ID_RE.search(block)
        if not bundle_id_match or bundle_id_match.group(1) not in BUMPABLE_BUNDLE_IDS:
            return block
        return MARKETING_VERSION_RE.sub(
            f"MARKETING_VERSION = {new_version};", block, count=1
        )

    return BLOCK_RE.sub(replace_block, text)


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in BUMP_KINDS:
        sys.exit(f"usage: {sys.argv[0]} <{'|'.join(BUMP_KINDS)}>")
    kind = sys.argv[1]

    text = PBXPROJ.read_text()
    versions = bumpable_versions(text)
    if not versions:
        sys.exit("error: found no app/widget XCBuildConfiguration blocks to bump")

    distinct = {version for _, version in versions}
    if len(distinct) != 1:
        sys.exit(
            "error: app/widget MARKETING_VERSION blocks have already drifted apart "
            f"({versions}) — fix that by hand before bumping"
        )
    current_version = distinct.pop()
    new_version = next_version(current_version, kind)

    PBXPROJ.write_text(bump(text, new_version))
    for bundle_id in dict.fromkeys(bundle_id for bundle_id, _ in versions):
        print(f"{bundle_id}: {current_version} -> {new_version}")


if __name__ == "__main__":
    main()
