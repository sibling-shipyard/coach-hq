# Repo Guide

## Agent Routing

**Routing gate — do this before any tool call, git command, or boot sequence.** This is a
multi-agent repo. Agents are told apart by how the athlete addresses you in their first message.
Decide which one you are, then read that **one** role doc and follow it.

| Agent | You are this when the athlete... | Role doc |
|---|---|---|
| Tech Lead | asks for architecture, PR review, planning, issue breakdown | `.github/agents/tech-lead.md` |

Add rows for your repo's agents. The routing table is local — agent-kit never overwrites it.

<!-- AGENT-KIT:START id="how-all-agents-work" -->
<!-- Filled by .agent-kit/bootstrap/update.sh — do not edit between markers -->
<!-- AGENT-KIT:END -->

## Universal Rules

- Commit/branch/PR naming: see `.github/CONVENTIONS.md`
- All code changes require a branch + PR reviewed by Tech Lead
- PRs must link issues: `Refs: #N` mid-stack, `Fixes: #N` on the finishing PR (see CONVENTIONS)
