# coach-phelps-hq — TODO

## P0 — User 3+ gate (must-do before friends sign up)

Friends will use **Sign up on the shared site → connect Claude to the same repo → coach**. They will not set up PATs or run operator scripts.

**Authority:** [`docs/engineering/user-3-onboarding-gate.md`](docs/engineering/user-3-onboarding-gate.md)

- [ ] **PAT-free Sync** — skeleton `sync.yml` uses `GITHUB_TOKEN` (+ permissions) instead of athlete-created `PAT_TOKEN`
- [ ] **Auto repo on sign-up** — website creates `coach-<user>` from skeleton (App Administration perm or equivalent)
- [ ] **Sign-up → working Sync** — exit test: dashboard login, Sync button, push-triggered Sync all green without operator
- [ ] **SETUP.md** — athlete path is shared-site sign-up; remove manual PAT steps from friend-facing docs

- [ ] **Unified challenge_v2 v4** — one schema all users; see [`docs/engineering/challenge-v2-schema.md`](docs/engineering/challenge-v2-schema.md) + ADR 0006. Migrate carve, provision, validate-data, live repos (C2–C4).

**Do not invite user 3+ until all four pass.**

---
- [x] SOUL.md — generic Phelps identity + First Session Protocol
- [x] training/coach/state.md — blank athlete template
- [x] training/ledger/challenge_v2.json — parameterized quest schema (config-driven patterns, no hardcoded sport logic)
- [x] scripts/generate_quest_log.py — fully config-driven (weekly_targets + main quest regex from JSON)
- [x] Strava sync scripts — fetch_strava.py, query_history.py, strava_api.py, oauth_reauth.py
- [x] SETUP.md — clone → Strava auth → HR zones → first session guide
- [x] .gitignore, .env.example
- [x] README.md, CLAUDE.md

---

## Done (v2)
- [x] **Automated sync pipeline** — `scripts/run_sync_pipeline.py` + `.github/workflows/sync.yml`, manually triggered by default (`workflow_dispatch`), can be put on a cron schedule per SETUP.md step 8.
- [x] **Workout template system** — `templates/` folder with generic starter templates (calisthenics, strength, foundation, recovery). `ui/scripts/build-data.mjs` compiles templates plus any coach-written `sessions/*.json` overrides into the dashboard's workout data automatically on every `npm run dev`/`build`.
- [x] **Dashboard on Vercel** — `ui/` deploys via Vercel (`vercel.json`, `ui/api/trigger-sync.ts`), includes four example analytics pages (Badminton, Badminton Match Analytics, Run, Monthly) as reference implementations.
- [x] **Activity rename system** — `strava/rename_core.py` + `rename_activities.py` for consistent naming (since replaced by client-side iOS naming + `engine/core/rename_core.py`, ADR 0010).
- [x] **Multi-agent setup** — `.github/agents/` (Tech Lead, UI Expert, Bob the Builder) for engineering work on the repo itself, routed via `CLAUDE.md`.
- [x] **HOW_IT_WORKS.md** — conceptual guide explaining Season/Challenge/Quest, the file map, quest types, and dashboard-to-file relationships, so new users understand day-to-day usage rather than just account setup. Also removed `scripts/generate_workouts.py`, a dead/duplicate script that always wrote empty sessions and could silently wipe real session data if run by mistake - `ui/scripts/build-data.mjs` already handles this correctly.

## P1 — V2 Enhancements

- [ ] **soul/ v2** — iterate on First Session Protocol and coaching quality after first 2-3 real users (edit `soul/A_identity.md` / `soul/B_engine.md`, then compose). Expected gaps: quest setup flow, weekly planning for unfamiliar sports, goal-setting depth.

- [ ] **Sport-agnostic analytics option** — the analytics pages (`BadmintonAnalytics`, `BadmintonMatchAnalytics`, `RunAnalytics`, `MonthlyAnalytics`) are provided as examples from one real setup. A user doing a different sport has to build their own page from scratch rather than adapt a generic one. Consider adding a lightweight generic analytics page alongside them (activity heatmap, volume by sport type, HR zone distribution, streak counters) that works for any sport out of the box.

---

## P2 — Later

- [ ] **Proactive morning briefing** — scheduled task (GitHub Action or cron) that generates a daily briefing from state.md + quest_log.md and surfaces it via a notification or commit.

- [ ] **Milestone quest type** — schema already supports `milestone` type but it's undocumented and unrendered in generate_quest_log.py. Document and implement rendering.

- [ ] **Structured memory system** — when `training/coach/coach_notes.md` exceeds ~600 lines, distill permanent patterns into `training/key_insights.md` and archive old notes. Relevant ~6 months in for active users.

- [ ] **Travel/bodyweight mode** — Coach detects travel context and switches to a bodyweight-only plan. Return protocol to ramp back up. Define in `soul/B_engine.md`.

- [ ] **Readiness score** — daily 1-100 score derived from sleep, soreness, PRE, and streak data. Helps Coach calibrate session intensity without asking every time.

- [ ] **Real opponent-name aliases (`ui/client/src/lib/nameAliases.ts`)** — Akash's personal repo has real badminton opponent-name mappings (e.g. "joe" → "Joe Chung", "richard t" → "Rich Tan"); the shared site currently only has a placeholder entry. Discuss with Akash whether/how to bring his real aliases in — deliberately left untouched during the UI v2 migration since it's his data, not something to port without him.
