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

python3 - "$CONTEXT" <<'PY'
import json, sys
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": sys.argv[1],
    }
}))
PY
