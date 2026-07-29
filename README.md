# Coach Phelps

An AI coaching system powered by Claude. Clone this repo, sync your training from Apple Health via the iOS app, open a Claude session - Coach Phelps runs your intake and gets started.

Coach Phelps is Michael Phelps as a coaching persona: process-obsessed, emotionally honest, no platitudes. He tracks your training, manages a quest/streak system, and builds a living memory of your progress across sessions.

---

## Setup

**Once you're set up, read [HOW_IT_WORKS.md](docs/eng-docs/HOW_IT_WORKS.md)** - explains the concepts (seasons, challenges, quests) and day-to-day workflow, so your first session doesn't feel like a black box.

The quick version, if you've done this kind of thing before:

1. **Use this template** on GitHub, then clone your new repo locally.
2. Install the iOS app and sign in to sync your Apple Health activity history - see `ios/README.md`. Activities land in `training/activities/history/` automatically, no manual fetch step.
3. Start your first session with `claude` (Claude Code) or by uploading `SOUL.md` + `training/coach/state.md` to Claude.ai. Coach Phelps detects the blank `training/coach/state.md` and runs intake automatically.
4. Generate your quest log: `python3 scripts/generate_quest_log.py`.
5. Deploy the dashboard in `ui/` to [Vercel](https://vercel.com) (root directory `ui`), add `GITHUB_REPO`, `GITHUB_WORKFLOW`, `GITHUB_PAT` as environment variables, and add `PAT_TOKEN` as a GitHub repo secret so the sync workflow can run.

---

## How it works

Every session, the coach:
1. Reads `SOUL.md` (composed identity, rules, workflows — source layers in `soul/`)
2. Reads `training/activities/quest_log.md` (pre-computed streaks and progress)
3. Reads `training/coach/state.md` (your profile, injuries, week plan)
4. Opens with context — not a status report

At the end of every session, the coach commits updates to `training/coach/state.md`, `training/ledger/challenge_v2.json`, and `training/coach/coach_notes.md`.

---

## What lives in your repo

| File | Written by | Purpose |
|------|-----------|---------|
| `SOUL.md` | Template (generated) | Composed coach brain — generated from `platform/soul/` via `platform/scripts/compose-soul.mjs`; do not hand-edit |
| `training/coach/state.md` | Coach | Your profile, injuries, week plan |
| `training/ledger/challenge_v2.json` | Coach | Quest and streak data |
| `training/coach/coach_notes.md` | Coach | Session insights (append-only) |
| `training/activities/quest_log.md` | Script (auto) | Live progress dashboard |
| `training/activities/history/*.json` | iOS app | Activity data (git-ignored) |

---

## Scripts

| Script | Purpose |
|--------|---------|
| `engine/core/query_history.py` | Search and filter local activity history |
| `scripts/generate_quest_log.py` | Regenerate `training/activities/quest_log.md` |
| `scripts/generate_quest_history.py` | Regenerate `ui/client/src/data/quest_history.json` for the dashboard |
| `scripts/regenerate_derived.py` | Regenerate quest_log, quest_history, and sync_status in one pass (used by the GitHub Actions workflow) |

Ingestion is iOS/HealthKit only now - Strava ingestion was removed (ADR 0010). Activities are
named client-side by the app; there's no separate rename script anymore.

Workout templates and sessions are compiled separately, by `ui/scripts/build-data.mjs` - it runs automatically every time you do `npm run dev` or `npm run build` inside `ui/`, so there's nothing to run by hand for those.

## Multi-agent setup

This repo is designed to work with more than one Claude agent role sharing the same codebase - Coach Phelps (the coaching persona), plus a Tech Lead, UI Expert, and Bob the Builder for engineering work on the repo itself. See `CLAUDE.md` for the routing logic and `.github/agents/` for each role's instructions. If you're only using the coaching persona, you can ignore this entirely - it only activates when a session is addressed as one of the other roles.
