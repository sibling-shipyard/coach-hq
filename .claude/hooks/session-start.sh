#!/bin/bash
set -euo pipefail

# Routing gate for the multi-agent coach-phelps repo — POINTER ONLY.
#
# The gate itself lives in AGENTS.md → Agent Routing: the table, the HQ default,
# and the watch-out about this repo's size dragging sessions into a generic
# engineer boot. That file is the single source, and it is the one every tool
# reads — Claude Code, Codex and Cursor alike.
#
# This hook exists only because Claude Code can inject text at session start,
# which is emphasis no plain file gets. Emphasis is all it may add. The moment it
# restates any of the gate's content, the two copies drift and the enforced copy
# is the one only a third of our sessions can see (ADR 0031).

CONTEXT="$(cat <<'EOF'
═══════════════════════════════════════════════════════════════
ROUTING GATE — coach-phelps is a MULTI-AGENT repo. Resolve your role FIRST.
═══════════════════════════════════════════════════════════════
Five agents share this repo and you are exactly ONE of them.

STOP. Before any tool call, git command, PR/issue triage or boot sequence:
read AGENTS.md → "Agent Routing" and follow it. It holds the table, the HQ
default, and the watch-out about what does NOT decide your role.

Read it now, even if this session looks obviously like engineering work.
Looking obvious is the failure mode the gate exists to catch.
═══════════════════════════════════════════════════════════════
EOF
)"

# Live git state — where the session actually is.
#
# Without this, every session burns its first three tool calls on `git branch`,
# `git log`, and `git status` just to learn what it is looking at. Cheap to read
# here once, so the agent starts oriented.
#
# LOCAL GIT ONLY — no `git fetch`, no `gh`, no `curl`. This runs on EVERY session
# start; a network call would add latency (and a failure mode, and an auth prompt)
# to every single boot. Ahead/behind vs the remote is deliberately NOT reported —
# it cannot be known without touching the network.
#
# Every git call is guarded. set -e plus a failing git command is exactly how a
# SessionStart hook starts exiting non-zero and degrading every session in the repo,
# so each call ends in `|| true` (or a guarded if) and the whole section degrades to
# a plain "state unavailable" note rather than an error. Edge cases handled: detached
# HEAD (`git branch --show-current` prints an EMPTY string, not an error), a branch
# with no commits yet (`git log` FAILS with "does not have any commits yet"), a clean
# tree, and not-a-git-repo / git-not-installed.

DIRTY_CAP=20  # A session opened mid-refactor can have hundreds of dirty paths, and
              # dumping them all would swamp the context this hook is meant to save.
              # Show the first few, then a count of the rest.

git_state() {
	if ! command -v git >/dev/null 2>&1; then
		echo "state unavailable — git not found on PATH"
		return 0
	fi
	if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
		echo "state unavailable — not inside a git work tree (cwd: $(pwd))"
		return 0
	fi

	local branch sha status total
	branch="$(git branch --show-current 2>/dev/null || true)"
	sha="$(git rev-parse --short HEAD 2>/dev/null || true)"

	if [ -n "$branch" ]; then
		if [ -n "$sha" ]; then
			echo "Branch: $branch (at $sha)"
		else
			echo "Branch: $branch (no commits yet)"
		fi
	elif [ -n "$sha" ]; then
		echo "Branch: detached HEAD at $sha"
	else
		echo "Branch: unknown (no HEAD)"
	fi

	echo
	echo "Recent commits:"
	# Fails on an unborn branch; empty output is the signal, not an error.
	local log
	log="$(git log --oneline -5 2>/dev/null || true)"
	if [ -n "$log" ]; then
		printf '%s\n' "$log"
	else
		echo "  (none yet — no commits on this branch)"
	fi

	echo
	status="$(git status --short 2>/dev/null || true)"
	if [ -z "$status" ]; then
		echo "Working tree: clean"
	else
		total="$(printf '%s\n' "$status" | wc -l | tr -d ' ')"
		echo "Uncommitted changes ($total):"
		printf '%s\n' "$status" | head -n "$DIRTY_CAP"
		if [ "$total" -gt "$DIRTY_CAP" ]; then
			echo "… and $((total - DIRTY_CAP)) more"
		fi
	fi
}

# Belt and braces: even if git_state itself blows up, the routing gate still ships.
GIT_STATE="$(git_state 2>/dev/null || true)"
[ -n "$GIT_STATE" ] || GIT_STATE="state unavailable"

GIT_SECTION="$(cat <<EOF
═══════════════════════════════════════════════════════════════
REPO STATE (local git only — no network, so no ahead/behind vs remote)
═══════════════════════════════════════════════════════════════
$GIT_STATE
═══════════════════════════════════════════════════════════════
EOF
)"

python3 - "$CONTEXT" "$GIT_SECTION" <<'PY'
import json, sys
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": sys.argv[1] + "\n\n" + sys.argv[2],
    }
}))
PY
