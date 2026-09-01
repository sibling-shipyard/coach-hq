#!/bin/sh
set -e

# update.sh - Rewrites AGENT-KIT managed blocks in markdown files.
# Usage: ./update.sh [--check] [--dry-run]

DIR="$(cd "$(dirname "$0")" && pwd)"

# Identify the kit directory depending on if we're in HQ (bootstrap/) or consumer (.agent-kit/)
if [ "$(basename "$DIR")" = "bootstrap" ]; then
    AGENT_KIT_DIR="$(dirname "$DIR")"
else
    AGENT_KIT_DIR="$DIR"
fi
export AGENT_KIT_DIR

# Find VERSION
if [ -f "$AGENT_KIT_DIR/VERSION" ]; then
    VERSION_FILE="$AGENT_KIT_DIR/VERSION"
else
    echo "Error: VERSION file not found in $AGENT_KIT_DIR" >&2
    exit 1
fi

export AGENT_KIT_VERSION="$(cat "$VERSION_FILE" | tr -d '[:space:]')"

exec python3 -c '
import os
import sys
import re
import urllib.request
import urllib.error
import subprocess

version = os.environ.get("AGENT_KIT_VERSION", "")
kit_dir = os.environ.get("AGENT_KIT_DIR", "")
check_only = "--check" in sys.argv
dry_run = "--dry-run" in sys.argv

def get_git_files():
    try:
        output = subprocess.check_output(["git", "ls-files", "-z"], stderr=subprocess.DEVNULL).decode("utf-8")
        return [f for f in output.split("\0") if f.endswith(".md")]
    except (subprocess.CalledProcessError, FileNotFoundError):
        md_files = []
        for root, dirs, files in os.walk("."):
            if ".git" in dirs: dirs.remove(".git")
            if "node_modules" in dirs: dirs.remove("node_modules")
            for f in files:
                if f.endswith(".md"):
                    md_files.append(os.path.join(root, f))
        return md_files

def fetch_block(block_name):
    local_path = os.path.join(kit_dir, "blocks", f"{block_name}.md")
    if os.path.isfile(local_path):
        with open(local_path, "r") as f:
            return f.read()
            
    ref = f"v{version}" if version and version[0].isdigit() else version
    url = f"https://raw.githubusercontent.com/sibling-shipyard/agent-kit/refs/tags/{ref}/blocks/{block_name}.md"
    req = urllib.request.Request(url)
    if "GITHUB_TOKEN" in os.environ:
        req.add_header("Authorization", f"token {os.environ['GITHUB_TOKEN']}")
    try:
        with urllib.request.urlopen(req) as response:
            return response.read().decode("utf-8")
    except urllib.error.URLError as e:
        # Fallback to main branch for testing/floating
        fallback_url = f"https://raw.githubusercontent.com/sibling-shipyard/agent-kit/main/blocks/{block_name}.md"
        req_fallback = urllib.request.Request(fallback_url)
        if "GITHUB_TOKEN" in os.environ:
            req_fallback.add_header("Authorization", f"token {os.environ['GITHUB_TOKEN']}")
        try:
            with urllib.request.urlopen(req_fallback) as response_fallback:
                return response_fallback.read().decode("utf-8")
        except urllib.error.URLError as e_fallback:
            print(f"Error fetching block {block_name} from {url}: {e_fallback}", file=sys.stderr)
            sys.exit(1)

drift_detected = False
blocks_cache = {}

files = get_git_files()
for filepath in files:
    if not os.path.isfile(filepath):
        continue
        
    with open(filepath, "r") as f:
        content = f.read()
        
    if "AGENT-KIT:START" not in content:
        continue
        
    lines = content.splitlines(True)
    new_lines = []
    i = 0
    changed = False
    
    while i < len(lines):
        line = lines[i]
        match = re.match(r"^(?P<indent>[ \t]*)<!--\s*AGENT-KIT:START\s+(?P<block>[a-zA-Z0-9_-]+)\s*-->", line)
        if match:
            indent = match.group("indent")
            block_name = match.group("block")
            new_lines.append(line)
            
            if block_name not in blocks_cache:
                blocks_cache[block_name] = fetch_block(block_name)
            block_content = blocks_cache[block_name]
            if not block_content.endswith("\n"):
                block_content += "\n"
            
            j = i + 1
            original_inner_content = []
            end_found = False
            while j < len(lines):
                if re.match(r"^[ \t]*<!--\s*AGENT-KIT:END\s*-->", lines[j]):
                    end_found = True
                    break
                original_inner_content.append(lines[j])
                j += 1
                
            if not end_found:
                print(f"Error: Missing AGENT-KIT:END in {filepath}", file=sys.stderr)
                sys.exit(1)
                
            new_inner_content = []
            for block_line in block_content.splitlines(True):
                # Only indent if the line is not empty
                new_inner_content.append(indent + block_line if block_line.strip() else block_line)
                
            if "".join(original_inner_content) != "".join(new_inner_content):
                changed = True
                
            new_lines.extend(new_inner_content)
            new_lines.append(lines[j])
            i = j + 1
        else:
            new_lines.append(line)
            i += 1
            
    if changed:
        if check_only:
            print(f"Drift detected in {filepath}")
            drift_detected = True
        else:
            print(f"Updating {filepath}")
            if not dry_run:
                with open(filepath, "w") as f:
                    f.writelines(new_lines)

if check_only and drift_detected:
    sys.exit(1)
' "$@"
