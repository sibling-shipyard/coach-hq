# Part 9 / PR 2 — fix stale generator scripts, rename the dashboard bundle, build athlete insights

Stacked on `coach-redesign-part8-pr1-coach-log-window.md`'s branch. Branch off that PR's tip.
**No edits anywhere under `platform/soul/` in this PR** — the one `gen/quest_log.md` SOUL
reference this PR's work makes stale is fixed later, in Part 9's continuation
(`coach-redesign-part11-pr4-soul-and-prompt-rebuild.md`, Part B, item 2). Keep SOUL changes in
exactly one PR in this whole stack.

## Context

Two scripts are stale against the ledger-file redesign from PR #407/#413 (`profile.json`/
`memory.json`/`seasons.json`/`quests.json`/`progress.json`/`progressions.json` replacing
`state.md`/`coach_notes.md`/`challenge_v2.json`). This was found during research for the insights
work below, not invented for this PR — it's real, and somewhat urgent given a live athlete repo is
being migrated to the new schema around the same time as this PR.

### Is `generate_quest_log.py` actually dead, and how does quest context work without it?

Yes, for hosted chat — confirmed by reading the replacement directly. `renderQuestContext()`
(`ui/api/coach-chat/_lib/coachContext.ts`, ~line 186) computes exactly what `quest_log.md` used to
— current season, main quest progress, side-quest streaks — live, in TypeScript, on every turn, by
reading `seasons.json`/`quests.json`/`progress.json`/`progressions.json` directly (already 4 of
the 8 files `loadCoachContext` fetches every turn) and computing streaks/progress in
`questProgressCounts()`. It's a full reimplementation, not a stopgap — it shipped with #413 and has
since had review-fix commits (e.g. matching a write-side sentinel bug, fixing a progress-type main
quest rendering bug). So for hosted chat this is genuinely done, not a gap.

**BYOB is the actual gap.** It has no TypeScript runtime to run `renderQuestContext()` in, so
BYOB's SOUL still tells it to read `gen/quest_log.md` — and the generator that produces that file,
`generate_quest_log.py`, hard-reads `challenge_v2.json` (`CHALLENGE_FILE`, line 29) and exits with
an error if it's missing. #413's own migration script
(`ui/scripts/migrate-coach-memory-part2.mjs:218`) deletes `challenge_v2.json` on migration. So on
any migrated athlete repo, this script errors immediately — it's broken, not just superseded, for
the one runtime that still needs *something* in its place. This PR retires the broken script; the
SOUL-side fix for what BYOB should do instead is Part B's job in the SOUL PR (part 11), not here.

### `build-aggregate.mjs` — degraded, real dashboard-breakage risk

`engine/scripts/build-aggregate.mjs:76-83` still reads `challenge_v2.json` directly and bundles it
into `gen/aggregate.json` under the `challenge_v2` key. On a migrated repo this degrades to
`challenge_v2: null` with a console warning (doesn't crash) — but `ui/api/widget-snapshots.ts:42`
hard-requires `challenge_v2` in the aggregate and errors `"No challenge_v2.json in aggregate —
complete coach intake first"` when it's null. **The hosted dashboard's quest widgets go blank/error
on a migrated repo even though the athlete has live quest data** — it's just sitting in the new
ledger files now, which this script never learned to read. This was the original plan
(`docs/plans/ledger-split-plan.md:44-47`: "Reads the 5 files directly, no more shipping completion
data twice") — it just never got executed. Fix it in this PR.

## Scope

### Part A — fix the two scripts, rename the dashboard bundle

1. **Retire `generate_quest_log.py`.** Delete the script. Grep repo-wide for `generate_quest_log`
   and `quest_log.md` — remove every reference **outside** `platform/soul/` (CI workflow steps,
   skeleton template files, any test referencing it, `docs/eng-docs/` mentions if any). Leave
   every reference inside `platform/soul/` completely untouched — do not edit `B_engine.md` in
   this PR, even though its `gen/quest_log.md` references are now stale. That's PR 4's job.

2. **Fix `build-aggregate.mjs`** to read `seasons.json`, `quests.json`, `progress.json`,
   `progressions.json` directly instead of `challenge_v2.json`. Update
   `ui/api/widget-snapshots.ts`'s hard requirement on the `challenge_v2` key to read the new
   shape. Test against both an unmigrated repo (still has `challenge_v2.json`) and a migrated one
   — decide explicitly what the migrated-repo output should contain (the new ledger data,
   obviously) and don't let it silently produce some broken hybrid of old+new.

3. **Rename the output and the script together**, since the script is being substantially
   rewritten in this same PR and its name should match what it now produces:
   - `gen/aggregate.json` → `gen/dashboard_snapshot.json`
   - `engine/scripts/build-aggregate.mjs` → `engine/scripts/build-dashboard-snapshot.mjs`
     (rename any exported function names that reference "aggregate" too)
   - `ui/client/src/data/aggregate.json` → `ui/client/src/data/dashboard_snapshot.json` — same
     underlying shape/contract (this HQ dev-fixture's `buildAggregate()` was factored out of
     `ui/scripts/build-data.mjs` into the shared script being renamed above, per that script's own
     header comment), so it carries the same new name even though it's a different generator
     (built from `shared/golden-dataset/` on `npm run dev`/`build`, not synced from an athlete
     repo).
   - Update every touch point: `engine/.github/workflows/sync.user.yml`'s commit step,
     `ui/api/repo-file.ts` and `ui/api/auth/_lib/github-aggregate.ts`'s fetch paths (consider
     renaming `github-aggregate.ts` itself if it's now misleadingly named),
     `ui/client/src/hooks/useRepoData.ts`'s fetch call (check both the athlete-repo path and the
     HQ dev-fixture path — don't miss one), the skeleton template path, `ui/scripts/build-data.mjs`'s
     output path and its import of the shared script, `docs/eng-docs/skeleton-layout.md`, and
     `AGENTS.md`'s line about `ui/client/src/data/` being generated from `shared/golden-dataset/`
     (update the filename there if it's named explicitly). Grep repo-wide for `aggregate.json` and
     `build-aggregate` at the end to confirm nothing was missed.

### Part B — new athlete insights generator

**Why new code, not reuse.** `activities/hist/*.json` (per-activity, sport-agnostic — HealthKit
and Strava both land in the same allowlisted shape per `engine/lib/projectActivity.mjs`) already
exists, but nothing computes session-frequency-by-sport, longest-gap, or volume-trend from it.
`generate_quest_log.py`'s streak logic (now retired anyway) answered "did the athlete hit their
declared quest," not "how consistent are they at badminton" — a different question with no
reusable math. `query_history.py --last Nw --summary` is BYOB-only (needs a shell) — the hosted
app is Gemini-based with no bash/file-tool access, so it structurally can't run this script
regardless of window size. This needs a genuinely new, hosted-chat-reachable data path.

**Design.** Once a year, an athlete has generated roughly 50-300 activity files. Coach doesn't
need to read all of them to answer "am I consistent with badminton" — it needs the same kind of
summary a human coach would glance at: how often, how recently, how steady. Three numbers per
sport:

- **Session count, trailing 365 days** — how central this sport is to the athlete's routine.
- **Sessions/week, trailing 4 weeks vs. the 12 weeks before that** — a simple two-window average
  comparison, not a trend line. Lets Coach say "you've picked up the pace lately" or "this has
  dropped off" without real statistics.
- **Longest gap (days) in the trailing 365 days, and days since the last session** — answers "have
  they gone quiet on this."

Deliberately just these three — each maps to something Coach would naturally say out loud in
conversation. Anything richer (HR trends, time-of-day patterns) drifts into "interesting but not
conversational," and the output needs to stay small enough to render as a few lines in a prompt.
Add fields later if this proves too thin — starting minimal beats guessing at a shape nobody asked
for.

**Output** — `gen/athlete_insights.json` (same `gen/` convention as `gen/quest_log.md`/
`gen/dashboard_snapshot.json` — auto-generated, never hand-edited):

```json
{
  "generated_at": "2026-08-20T00:00:00Z",
  "window_days": 365,
  "sports": {
    "badminton": {
      "sessions_365d": 142,
      "sessions_per_week_recent_4w": 3.25,
      "sessions_per_week_prior_12w": 2.1,
      "longest_gap_days_365d": 9,
      "days_since_last_session": 2
    }
  }
}
```

**Where it's generated:** as a build/CI step in `engine/.github/workflows/sync.user.yml`,
alongside the (now renamed) dashboard-snapshot build — regenerates automatically after every
activity sync, zero per-chat-request cost.

**Language: Node/mjs.** Share `build-dashboard-snapshot.mjs`'s `histDir()`/activity-loading
helpers directly (it's in the same PR, same language) instead of re-implementing activity-file
loading a second time in Python.

## Verification

- Unit tests for the rollup math with synthetic activity fixtures: a sport with a long gap, a
  sport with increasing frequency, a sport with exactly 1 activity ever (must not crash on
  small-sample math), an athlete with zero activities (`sports: {}`, not an error).
- Confirm `generate_quest_log.py`'s removal is clean: grep repo-wide for `generate_quest_log` and
  `quest_log.md` outside `platform/soul/` returns nothing.
- Unit tests for `build-dashboard-snapshot.mjs`'s updated ledger read: unmigrated-repo input and
  migrated-repo input both produce valid, correct output.
- Run the insights generator against a real athlete repo with real history (yours or Akash's,
  whichever has more) and sanity-check the numbers by hand.
- `cd ui && npx tsc --noEmit` clean (for anything TS-adjacent); confirm the renamed script runs
  clean end to end.
- Manually verify the webapp dashboard renders quest widgets correctly against a migrated repo —
  this is the part with real, current user-facing impact, verify it for real, not just via tests.

## PR

Branch off PR 1's tip. Title something like `core: fix stale generator scripts for the new ledger
schema, add athlete insights`. Body: the `generate_quest_log.py`/`build-aggregate.mjs` staleness
finding (with evidence), the rename rationale, and the insights design explanation above (Akash
should be able to read the PR body and understand *why* these three numbers, not just see a diff).
Leave open for review, same as the rest of this stack.
