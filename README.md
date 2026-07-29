# Coach Phelps

An AI coaching system powered by Claude. Clone this repo, connect your Strava, open a Claude session - Coach Phelps runs your intake and gets started.

Coach Phelps is Michael Phelps as a coaching persona: process-obsessed, emotionally honest, no platitudes. He tracks your training via Strava, manages a quest/streak system, and builds a living memory of your progress across sessions.

**⚠️ Requires Strava Premium (Summit).** Almost everything here depends on syncing activity data from Strava, and that requires a paid Strava Premium subscription - a free Strava account will not work.

---

## Setup

**Once you're set up, read [HOW_IT_WORKS.md](HOW_IT_WORKS.md)** - explains the concepts (seasons, challenges, quests) and day-to-day workflow, so your first session doesn't feel like a black box.

The quick version, if you've done this kind of thing before:

1. **Use this template** on GitHub, then clone your new repo locally.
2. `pip3 install requests`
3. Create a Strava API app at [strava.com/settings/api](https://www.strava.com/settings/api), copy `.env.example` to `.env` and fill in your Client ID/Secret, then run `python3 strava/oauth_reauth.py` to authorize and `python3 strava/fetch_strava.py --last 3` to confirm it works.
4. Fill in your HR zones in `strava/README.md`.
5. Sync history: `python3 strava/fetch_strava.py --sync --since YYYY-MM-DD`.
6. Start your first session with `claude` (Claude Code) or by uploading `SOUL.md` + `training/coach/state.md` to Claude.ai. Coach Phelps detects the blank `training/coach/state.md` and runs intake automatically.
7. Generate your quest log: `python3 scripts/generate_quest_log.py`.
8. Deploy the dashboard in `ui/` to [Vercel](https://vercel.com) (root directory `ui`), add `GITHUB_REPO`, `GITHUB_WORKFLOW`, `GITHUB_PAT` as environment variables, and add `PAT_TOKEN`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN` as GitHub repo secrets so the sync workflow can run.

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
| `SOUL.md` | Template (generated) | Composed coach brain — generated from `soul/` via `scripts/compose-soul.mjs`; do not hand-edit |
| `training/coach/state.md` | Coach | Your profile, injuries, week plan |
| `training/ledger/challenge_v2.json` | Coach | Quest and streak data |
| `training/coach/coach_notes.md` | Coach | Session insights (append-only) |
| `training/activities/quest_log.md` | Script (auto) | Live progress dashboard |
| `training/activities/history/*.json` | Sync script | Strava activity data (git-ignored) |
| `strava/strava_tokens.json` | OAuth script | API tokens (git-ignored) |

---

## Scripts

| Script | Purpose |
|--------|---------|
| `strava/oauth_reauth.py` | First-time auth and token refresh |
| `strava/fetch_strava.py` | Fetch and sync activities from Strava |
| `strava/query_history.py` | Search and filter local activity history |
| `strava/rename_activities.py` / `rename_core.py` / `rename_single.py` | Rename Strava activities to a consistent naming pattern (dry-run by default) |
| `scripts/generate_quest_log.py` | Regenerate `training/activities/quest_log.md` |
| `scripts/generate_quest_history.py` | Regenerate `ui/client/src/data/quest_history.json` for the dashboard |
| `scripts/run_sync_pipeline.py` | Full sync pipeline - fetch, rename, regenerate quest data (used by the GitHub Actions workflow) |

Workout templates and sessions are compiled separately, by `ui/scripts/build-data.mjs` - it runs automatically every time you do `npm run dev` or `npm run build` inside `ui/`, so there's nothing to run by hand for those.

## Multi-agent setup

This repo is designed to work with more than one Claude agent role sharing the same codebase - Coach Phelps (the coaching persona), plus a Tech Lead, UI Expert, and Bob the Builder for engineering work on the repo itself. See `CLAUDE.md` for the routing logic and `.github/agents/` for each role's instructions. If you're only using the coaching persona, you can ignore this entirely - it only activates when a session is addressed as one of the other roles.
