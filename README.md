# Coach Phelps

An AI coaching system powered by Claude. Clone this repo, sync your training from Apple Health via the iOS app, open a Claude session - Coach Phelps runs your intake and gets started.

Coach Phelps is Michael Phelps as a coaching persona: process-obsessed, emotionally honest, no platitudes. He tracks your training, manages a quest/streak system, and builds a living memory of your progress across sessions.

---

## Setup

**Once you're set up, read `docs/eng-docs/coach-chat-daily.md`** - explains the ordinary-turn
flow and the day-to-day workflow, so your first session doesn't feel like a black box.

The quick version, if you've done this kind of thing before:

1. **Use this template** on GitHub, then clone your new repo locally.
2. Install the iOS app and sign in to sync your Apple Health activity history - see `ios/README.md`. Activities land in `user_data/activities/hist/` automatically, no manual fetch step.
3. Start your first session with `claude` (Claude Code, reads `platform/SOUL.claude.md`) or through the hosted coach-chat app (reads `platform/SOUL.chat.md` directly server-side - see ADR 0022). Coach Phelps detects an empty `user_data/coach/profile.json` and runs the First Session Protocol automatically (`docs/eng-docs/coach-chat-fsp.md`).
4. Deploy the dashboard in `ui/` to [Vercel](https://vercel.com) (root directory `ui`), add `GITHUB_REPO`, `GITHUB_WORKFLOW`, `GITHUB_PAT` as environment variables. The sync workflow needs no repo secret — it runs under the built-in `GITHUB_TOKEN`.

---

## How it works

Every session, the coach:
1. Reads the composed identity/rules/workflows (`platform/SOUL.claude.md` for Claude Code, `platform/SOUL.chat.md`
   for the hosted app - source layers in `platform/soul/`, see ADR 0022)
2. Loads context from `user_data/coach/` and `user_data/ledger/` (profile, memory, injuries,
   recent `coach_log.json` rows, active quests/season)
3. Opens with context — not a status report

Every turn, the coach writes directly to the files below through structured action fields on its
reply (no free-form file edits) - full schema and field-by-field detail in
`docs/eng-docs/coach-data-schema.md`.

---

## What lives in your repo

| File | Written by | Purpose |
|------|-----------|---------|
| `platform/SOUL.claude.md` / `platform/SOUL.chat.md` | Template (generated) | Composed coach brain — generated from `platform/soul/` via `platform/scripts/compose-soul.mjs`; do not hand-edit |
| `user_data/coach/profile.json` | Coach | Athlete profile fields (name, `coach_since`, ...) |
| `user_data/coach/memory.json` | Coach | Sports and standing notes |
| `user_data/coach/injuries.json` | Coach | Injury/limitation log |
| `user_data/coach/coach_log.json` | Coach | Rolling session log |
| `user_data/coach/chat_history.json` | Coach | Recent turn transcript |
| `user_data/ledger/seasons.json` | Coach | Season definitions |
| `user_data/ledger/quests.json` | Coach | Quest and main-quest definitions |
| `user_data/ledger/progress.json` | Coach | Append-only quest progress rows |
| `user_data/ledger/progressions.json` | Coach | Tracked progression values (e.g. strength benchmarks) |
| `user_data/ledger/current_week.json` | Coach | Current week's plan |
| `user_data/activities/hist/*.json` | iOS app | Activity data (git-ignored) |

---

## Scripts

| Script | Purpose |
|--------|---------|
| `engine/core/query_history.py` | Search and filter local activity history |
| `engine/scripts/generate_quest_history.py` | Regenerate `ui/client/src/data/quest_history.json` for the dashboard |
| `engine/scripts/regenerate_derived.py` | Regenerate quest history and sync status |
| `engine/scripts/build-dashboard-snapshot.mjs` | Build `gen/dashboard_snapshot.json` for the dashboard |
| `engine/scripts/generate-athlete-insights.mjs` | Build the per-sport consistency summary |

Ingestion is iOS/HealthKit only now - Strava ingestion was removed (ADR 0010). Activities are
named client-side by the app; there's no separate rename script anymore.

Workout templates and sessions are compiled separately, by `ui/scripts/build-data.mjs` - it runs automatically every time you do `npm run dev` or `npm run build` inside `ui/`, so there's nothing to run by hand for those.

## Multi-agent setup

This repo is designed to work with more than one Claude agent role sharing the same codebase - Coach Phelps (the coaching persona), plus a Tech Lead, UI Expert, and Bob the Builder for engineering work on the repo itself. See `CLAUDE.md` for the routing logic and `.github/agents/` for each role's instructions. If you're only using the coaching persona, you can ignore this entirely - it only activates when a session is addressed as one of the other roles.
