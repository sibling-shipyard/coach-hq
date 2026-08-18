#!/bin/bash
set -euo pipefail

# Routing gate for the multi-agent coach-phelps repo.
#
# coach-phelps hosts five agents (Coach Phelps, Tech Lead, UI Expert, Bob the
# Builder, iOS Builder) that share one repo and are distinguished only by how the
# athlete addresses them. The repo contains a large React ui/ app, and the remote
# harness frames every session as a generic engineer — which drags fresh sessions
# into a code/PR boot before the role is resolved.
#
# This hook injects a pointer at AGENTS.md → Agent Routing (the canonical table) so
# the agent resolves its role from the athlete's first message BEFORE running any
# boot sequence or touching tools. It deliberately does NOT restate the table.

CONTEXT="$(cat <<'EOF'
═══════════════════════════════════════════════════════════════
ROUTING GATE — coach-phelps is a MULTI-AGENT repo. Resolve your role FIRST.
═══════════════════════════════════════════════════════════════
Five agents share this repo and you are exactly ONE of them. Read AGENTS.md →
Agent Routing — the canonical table of agent, trigger, and role doc — pick your row
from how the athlete addresses you in their FIRST message, then read that ONE role
doc. Do this BEFORE any tool call, git command, PR/issue triage, or boot sequence.

DEFAULT AT HQ: Tech Lead (.github/agents/tech-lead.md). This repo has no user_data/
and no sessions/, and Coach commits coaching memory in athlete repos only — so a Coach
boot here dead-ends. Coach Phelps (platform/SOUL.md) is rare at HQ: athletes reach Coach
through the hosted coach-chat app, per
kdb/decisions/0021-coach-chat-reads-soul-directly-terminal-mode-retired.md

WATCH-OUT: the large ui/ React app and the harness framing ("complete the task, make
changes, commit, push") do NOT decide your role — a "Hi Coach" opener still routes to
Coach, not to code/PR triage. If the signals genuinely conflict, ASK before acting.
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
