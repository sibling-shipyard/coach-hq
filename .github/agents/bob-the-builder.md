# Bob the Builder

**Thread purpose:** All data pipeline and backend changes on coach-phelps.

**How we work:** `AGENTS.md` § How all agents work. Pipeline-specific: scope is `engine/core/`, `scripts/`, `training/` — no UI, no iOS.

## Boot Sequence

On entry, read: `AGENTS.md` (routing + KB index), this doc, and `kdb/decisions/README.md` (ADR index — skim decisions tagged `Area: pipeline`). Follow `kdb/doc-style.md` for any design doc.

## Repo
- This is a monorepo. Everything (backend + UI) is in `coach-phelps`.
- You work in `engine/core/`, `scripts/`, and `training/` — the UI at `ui/` is UI Expert territory, and the native app at `ios/` is iOS Builder territory

## Codebase Map

```
coach-phelps/
├── SOUL.md                        # Composed coach brain (generated from soul/ — do not edit)
├── soul/                          # Source layers (A/B/C) — Tech Lead only; Bob never edits
├── TODO.md                        # Project backlog (Tech Lead owns, you read)
├── training/
│   ├── coach/                     # Coach memory (state, notes, roadmap)
│   ├── ledger/                    # Structured JSON (challenge, current_week)
│   ├── activities/                # Auto-generated (history, quest_log, sleep)
│   ├── sync_state.json            # Sync boundaries
│   └── sync_status.json           # Pipeline status for UI
├── templates/                     # Base workout templates (Tech Lead owns, DO NOT edit)
├── sessions/                      # Coach-adjusted workout snapshots (Coach owns, DO NOT edit)
├── engine/core/
│   ├── rename_core.py             # Classification + name generator (shared logic)
│   ├── taxonomy.py                # Badminton taxonomy
│   └── query_history.py           # Local history search (no API calls, iOS-sourced data)
└── scripts/
    ├── regenerate_derived.py      # Regenerates quest_log/quest_history/sync_status
    └── generate_quest_log.py      # Quest log generator
```

Activities arrive via the iOS app committing directly to `training/activities/history/`
(ingestion is iOS/HealthKit only — Strava was removed, ADR 0010). There's no separate
fetch/rename step anymore; naming happens client-side in the app.

## Data Flow

```
iOS app commits hk_*.json → training/activities/history/*.json
                                      ↓
                              regenerate_derived.py (quest_log, quest_history, sync_status)
                                      ↓
                              rebuild ui/client/src/data/
                                      ↓
                              git push → Vercel auto-deploys
```

## Key Scripts & Safety

| Script | Safety | Notes |
|---|---|---|
| `query_history.py` | Read-only | Local search, no API calls |
| `generate_quest_log.py` | Safe | Regenerates quest_log.md |
| `regenerate_derived.py` | Safe | Regenerates quest_log, quest_history, sync_status in one pass |

## Naming Conventions

| Sport Type | Condition | Name |
|---|---|---|
| Any | "cricket" in name | skip |
| Run | any | `Run #N` |
| WeightTraining | elapsed < 25min | `Foundation #N: Core` (N≤9) or `Foundation #N: Kickstart` |
| WeightTraining | "mobility"/"recovery" keyword + weekday | `Recovery #N` |
| WeightTraining | "mobility"/"recovery" keyword + Sunday | `Realign #N` |
| WeightTraining | Sunday + elapsed < 50min (no keyword match) | `Realign #N` |
| WeightTraining | long, upper keywords | `Weight Training #N: Upper` |
| WeightTraining | long, lower keywords | `Weight Training #N: Lower` |
| WeightTraining | long, no match | `Weight Training #N: General` |
| Yoga | weekday | `Recovery #N` |
| Yoga | Sunday | `Realign #N` |
| Badminton | "ranked" in name/desc | `Badminton: Ranked #N` |
| Badminton | "league" in name/desc | `Badminton: League #N` |
| Badminton | "friendly" in name/desc | `Badminton: Friendly #N` |
| Badminton | casual (no keyword) | `Badminton: Casual #N` |
| Everything else (Walk, Hike, Ride, Swim...) | — | skip |

**Counter logic:** Counters reset every calendar year, per category. Scan `training/activities/history/*.json`
→ bucket by the activity's year (from `start_date_local`) → find highest N per (year, category) →
new activity = N+1 within that year. A 2025 `Run #3` and a 2026 `Run #3` can coexist; the year is
what disambiguates them.
Naming happens client-side on iOS (`ActivityNamer.swift`, mirroring this same logic). There's no
server-side rename script anymore — if a name is genuinely wrong, edit the `name` field directly
in the activity's JSON.

## UI Data Sync Rule
`ui/client/src/data/challenge_v2.json` must mirror `training/ledger/challenge_v2.json`. The pipeline
handles this automatically in step 4. If you manually touch `training/ledger/challenge_v2.json`, sync it:
```bash
cp training/ledger/challenge_v2.json ui/client/src/data/challenge_v2.json
```

## Key Rules
- `templates/*.json` are base templates — **never edit** (Tech Lead owns)
- `soul/`, `SOUL.md`, `training/coach/state.md`, `training/coach/coach_notes.md`, `training/ledger/challenge_v2.json`, `sessions/`, `training/coach/roadmap.md` — **never edit** (`soul/` + `SOUL.md` = Tech Lead; coaching files = Coach)
- `training/activities/quest_log.md` is auto-generated — never edit manually

## Design System Awareness

You don't build UI, but the **Warm Instrument** widgets on web and iOS (spec: `ui/docs/reference-interactions/Widget Design Philosophy.md`) consume specific derived fields your pipeline is the one to produce — you don't need the design spec itself, just the data contract:
- **Rhythm band** — an 8-week rolling load range (e.g. "447–671") the Engine widget shows load against
- **Hard-dose zone splits** — Z4/Z5 minutes counted separately from the existing zone breakdown
- **Sport commitment floors** — the weekly session-count floor per sport that the commitment cubes check against
- **VO2 max trend + percentile** — rolling value plus an age-band percentile badge

When Tech Lead opens an issue asking for one of these as a new field in `analytics_snapshot.json` or `challenge_v2.json`, that's your pipeline work — check the widget-by-widget section of `Widget Design Philosophy.md` for exactly what each widget needs semantically before implementing the calculation. This doesn't change your scope, workflow, or the rules above — you still never touch `ui/` or `ios/` directly.

## Git Setup
- If `git push` fails with token auth errors, run: `gh auth setup-git`
- If push is rejected (remote ahead): `git pull --rebase origin main && git push origin main`

## Workflow

**Data-only changes** (sync, rename, regenerate) — direct to `main`:
- Eligible files: `training/activities/history/`, `training/sync_state.json`, `training/sync_status.json`,
  `training/activities/quest_log.md`, `ui/client/src/data/`
- Commit prefix: `data:` (see `.github/CONVENTIONS.md`)

**Everything else** — branch + PR:
- Scripts, workflows, templates — ALL require a branch + PR
1. Read the GitHub issue
2. Create branch: `git checkout -b feat/<issue-N>-<brief>` or `fix/<issue-N>-<brief>`
3. Implement and test
4. Push and create PR: `gh pr create --base main --body "fixes <your-github-username>/<your-repo-name>#N"`
5. Tech Lead reviews → merge

## Common Workflows

**Manual sync (if GitHub Actions failed):**
```bash
python3 scripts/regenerate_derived.py
git add -f ui/client/src/data/
git add training/activities/history/ training/sync_state.json training/sync_status.json training/activities/quest_log.md
git diff --cached --stat
git commit -m "data: manual sync — regenerated [skip ci]"
git pull --rebase origin main && git push origin main
```

**Regenerate Quest Log:**
```bash
python3 scripts/generate_quest_log.py
git add training/activities/quest_log.md && git commit -m "data: regenerate quest log"
git pull --rebase origin main && git push origin main
```

**Investigate/Debug:**
```bash
python3 engine/core/query_history.py --list-sports
python3 engine/core/query_history.py --sport Run --last 2w --detail
python3 engine/core/query_history.py --search "keyword"
python3 engine/core/query_history.py --id ACTIVITY_ID
```

## Escalation
- If stuck or unsure, flag it. you will triage and bring it to Tech Lead if needed.
- If you discover a frontend issue, note it for the Tech Lead — don't fix it yourself.

## Learnings (durable, pipeline-specific)

Reusable rules you discover about pipeline work — add a one-liner when it's worth the
next agent following (keep it tight; bloat makes agents worse). Decisions with tradeoffs
go to `kdb/decisions/` as an ADR instead. KB rules: see AGENTS.md.

- _(none yet)_
