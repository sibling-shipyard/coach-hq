---
name: Sentry Triage
description: Fetch and analyze live Sentry errors, events, and stack traces.
---

# Sentry Triage Skill

This skill equips you with the ability to query the Sentry REST API for live project issues and events. Use this when the user asks you to check for recent crashes, triage a specific issue ID, or investigate an alert.

## Prerequisites

The user's environment must have the `SENTRY_AUTH_TOKEN` environment variable exported. If a tool call fails with a 401, ask the athlete to provide the token or ensure it's in their environment.

## Usage

You have access to a script at `.agents/skills/sentry-triage/query-sentry.mjs` that you can run using Node.js to fetch data.

### Commands

**1. List recent unresolved issues**
Fetches the latest unresolved issues (groups of events) across the project.
```bash
node .agents/skills/sentry-triage/query-sentry.mjs list
```
You can optionally filter by environment or query:
```bash
node .agents/skills/sentry-triage/query-sentry.mjs list --query "is:unresolved level:error"
```

**2. Get issue details**
Fetches the detailed metadata for a specific issue ID (e.g. `123456789`).
```bash
node .agents/skills/sentry-triage/query-sentry.mjs issue <issue-id>
```

**3. Get the latest event for an issue**
Fetches the full JSON payload of the most recent event for a given issue, including the full stack trace and tags.
```bash
node .agents/skills/sentry-triage/query-sentry.mjs event <issue-id>
```

## How to Triage

1. When asked to check Sentry, start with `list`.
2. For any relevant issues, use `event <issue-id>` to pull the stack trace.
3. Use the stack trace file paths and ADR 0034 boundaries to determine which agent owns the fix (e.g., `ui/api/` -> Bob, `ui/client/` -> UI Expert).
4. Do not make code changes yourself. Your job is to output a clear, 1-page incident brief for the athlete (or Tech Lead) detailing what broke, where, and who owns it.
