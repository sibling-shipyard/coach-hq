# Athlete repo migration: the Current Week and Workouts stacks (#973, #727)

> Status: Ready, not started · Owner: Tech Lead · Created: 2026-09-11
>
> Deferred on purpose: do this after Workouts lands, not before. Nothing in the #973 stack
> breaks an unmigrated repo. The hosted chat handler and the schema live in HQ, not in the
> athlete repo, so an old-shaped `current_week.json` just keeps working under the old rules
> until its repo is migrated. There's no forcing deadline.

## Why this exists

Every athlete repo, and the `sibling-shipyard/coach-skeleton` template they're forked from, was
carved before the #973 stack (ADR 0042) landed. Four things changed that a carve, not a chat
turn, has to carry into each repo:

1. `current_week.json`'s schema dropped `coach_comments` and `planned_load`, and closed
   `discipline` to an enum.
2. Two new scripts - `engine/scripts/reconcile-current-week` and `engine/scripts/rollover-current-week`
   - don't exist in any repo carved before this stack.
3. `.github/workflows/sync.yml` (carved from `engine/.github/workflows/sync.user.yml`) doesn't
   call either of them yet.
4. `propagated/docs/current-week-contract.md` and `SOUL.claude.md` (BYOB Coach's own copy) both
   describe the old schema.

None of this is a live bug today - it only matters once a repo's own `sync.yml` needs to run the
new reconciler/rollover steps, or its BYOB Coach needs current, accurate schema guidance.

## Verified real, against `coach-skanda-2003`, `coach-akash-suresh`, and `coach-date2022`

Checked directly, not assumed - each on its own scratch branch
(`test/973-week-update-verify`, still on GitHub, not merged to `main`), not the athlete's real
`main` data:

| File | Real diff |
|---|---|
| `user_data/ledger/current_week.json` | skanda: 2 lines (`coach_comments`, one `planned_load`). akash: also had two PascalCase `discipline` values (`WeightTraining`, `Badminton`). date2022: also had a gerund `discipline` value (`hiking`). All three migrated cleanly once the discipline normalization step above was added - `parseCurrentWeek` accepted every result with zero issues |
| `engine/lib/current-week.mts` | 171 lines behind HQ |
| `propagated/docs/current-week-contract.md` | still describes `draft`/`planned_load`/free-text discipline |
| `SOUL.claude.md` | 106 lines behind HQ's composed build |
| `engine/scripts/` | `reconcile-current-week*` and `rollover-current-week*` absent entirely |

After migrating just `current_week.json` on the `coach-skanda-2003` scratch branch, a real
end-to-end run against the hosted chat handler (OpenRouter Gemini Flash, since the direct Gemini
key is unavailable right now) confirmed the new stack works against real data:

1. A full-week `week_update` kickoff committed a real, schema-valid live week.
2. The deterministic reconciler, run locally against the branch, correctly attached two real
   logged activities (a walk, a run) it found in `user_data/activities/hist/` as new `unplanned`
   sessions with real `healthkit:` ids - no chat turn involved.
3. The rollover job correctly replaced a week that had gone stale (ended 2026-08-23, today's
   2026-09-11) with a placeholder frame for the real current week (`2026-W37`).
4. A follow-up chat turn ("just finished Monday's run") sent a patch-shaped `week_update` that
   marked the right session `done` and touched nothing else.

The `coach-akash-suresh` and `coach-date2022` branches each surfaced one more real bug beyond the
migration transform itself. Both are fixed upstream in this stack, not in this doc.

- akash's real week had a moved session that kept its id on its original, now-empty day. The
  reconciler's naive per-day id generator regenerated that same id for a new synced activity, and
  `parseCurrentWeek` rejected the write as a duplicate. Fixed in `reconcile-current-week.mjs` with
  a week-wide-unique id minter.
- date2022's real kickoff prompt made Gemini emit `discipline: "hiking"`, which the old free-text
  schema field let through. Fixed by constraining the JSON schema's `discipline` field to the
  closed enum, so Gemini structurally can't emit an off-list value for any of the fifteen sports.

## What each repo needs

Run in this order, once per repo, `sibling-shipyard/coach-skeleton` included:

1. **Re-carve `engine/lib/current-week.mts`, `engine/core/`, and the four new script files.**
   This is already fixed as part of this PR - `carve-skeleton.mjs`'s `SKELETON_SCRIPT_FILES` didn't list
   `reconcile-current-week.mjs`/`rollover-current-week.mjs` until now, and their executable
   wrappers weren't hand-copied either - a real gap this migration would have hit immediately).
2. **Re-carve `.github/workflows/sync.yml`** from `engine/.github/workflows/sync.user.yml`, so
   the new Reconcile/Rollover steps exist.
3. **Re-carve `propagated/docs/current-week-contract.md`** and **`SOUL.claude.md`** (BYOB
   Coach's own schema guidance and voice/rules).
4. **Migrate `user_data/ledger/current_week.json`** in place: drop `coach_comments` (root) and
   `planned_load` (every session). If `data_status` is ever `draft` in a real repo (unlikely -
   nothing has written it in months), map it to `placeholder`. Also normalize every session's
   `discipline` onto the closed enum - that last step isn't optional. `coach-akash-suresh`'s real
   week had `"WeightTraining"` and `"Badminton"` (PascalCase, sport_type-style), and
   `coach-date2022`'s had `"hiking"` instead of `"hike"`. Neither passes
   `./engine/scripts/validate-current-week`, so skipping this step fails validation on two of the
   four real athlete repos. The transform below is reusable as-is. It verified clean against all
   three of `coach-skanda-2003`, `coach-akash-suresh`, and `coach-date2022`. `parseCurrentWeek`
   accepted every result with zero issues:
   ```python
   DISCIPLINE_MAP = {
       "weighttraining": "weight_training", "badminton": "badminton",
       "run": "run", "running": "run", "ride": "cycling", "cycling": "cycling",
       "bike": "cycling", "foundation": "foundation", "recovery": "recovery",
       "realign": "recovery", "mobility": "recovery", "strength": "strength",
       "hike": "hike", "hiking": "hike", "walk": "walk", "walking": "walk",
       "cricket": "cricket", "football": "football", "soccer": "football",
       "workout": "workout", "swim": "swim", "swimming": "swim",
       "calisthenics": "calisthenics", "calisthenic": "calisthenics",
   }
   VALID = {
       "badminton", "calisthenics", "cycling", "foundation", "recovery", "run",
       "strength", "weight_training", "hike", "walk", "cricket", "football",
       "workout", "swim", "other",
   }

   def normalize_discipline(raw):
       if raw in VALID:
           return raw
       return DISCIPLINE_MAP.get(raw.strip().lower(), "other")

   d.pop("coach_comments", None)
   if d.get("data_status") == "draft":
       d["data_status"] = "placeholder"
   for day in d["days"]:
       for s in day["sessions"]:
           s.pop("planned_load", None)
           s["discipline"] = normalize_discipline(s["discipline"])
   ```
   This is the same synonym set `coerceDiscipline` in `coachWeekFiles.ts` uses server-side as its
   own defense-in-depth fallback - keep the two in sync by hand if either changes, since one's
   Python and one's TypeScript.
5. **Validate**: `./engine/scripts/validate-current-week` must pass clean before committing.
6. **Live-test** on a scratch branch before touching `main` - same discipline as every
   coach-chat change, not skipped just because this is a data migration.

## Repos in scope

Six total. `ui/scripts/run-manual-coach-chat-test.ts`'s `ATHLETE_REPOS` map only names two
(`skanda`, `akash`) - out of date. Worth adding the other three there while doing this migration,
so a live test against any of them doesn't need `--repo`/`--local-path` spelled out by hand.

Checked directly against each local clone (not assumed) on 2026-09-11:

| Repo | `coach_comments`? | Any `planned_load`? | Off-enum `discipline`? | `data_status` | `reconcile`/`rollover` scripts |
|---|---|---|---|---|---|
| `sibling-shipyard/coach-skeleton` | template only - fixed by this PR's carve-skeleton.mjs change | - | - | - | fixed by this PR |
| `skanda-2003/coach-skanda-2003` | present on `main` | present on `main` | none found | `live` on `main` (verified separately, its own scratch branch) | absent |
| `akash-suresh/coach-akash-suresh` | present | present | yes - `WeightTraining`, `Badminton` (verified, live-migrated) | `live` | absent |
| `date2022/coach-date2022` | present | present | yes - `hiking` (verified, live-migrated) | `live` | absent |
| `prateekdevaraju/coach-prateekdevaraju` | present | none currently | not checked - no sessions currently on the week to check | `placeholder` | absent |
| `shreyas-95-cyber/coach-shreyas-95-cyber` | present | none currently | not checked - no sessions currently on the week to check | `placeholder` | absent |

A `placeholder` week still needs the `coach_comments` drop - the field's on the root object
regardless of `data_status`. "No `planned_load` currently" only means no *session* has one right
now, not that the field is genuinely absent from the type; migrate all six the same way
regardless, since a future session write could otherwise reintroduce it. Same logic for
discipline: run the normalization step on prateek and shreyas too even though today's placeholder
weeks have nothing to normalize - the step is a no-op on valid enum values and free otherwise.

## The Workouts stack (#727) additions

Covers A1 through A5-ios, near-term PRs #983-#992. A6 (migrating one athlete's repo by hand) was
skipped by the athlete's own decision, so it's not counted as shipped anywhere below. Audited each
PR's own diff against its own base branch, not the whole stack at once, so each finding below
traces to the PR that actually introduced it.

**Two things need carrying into each repo. Three more looked like gaps and aren't.**

1. **`shared/workout-library/exercises.json` (A1b) needs carving - it isn't today.** The hosted
   coach-chat backend reads its own HQ-local copy at request time
   (`coachFirstSessionBenchmark.ts`'s `EXERCISES_PATH` resolves five directories up from HQ's own
   `ui/api/`), so the web and iOS apps never need this file in an athlete repo. The BYOB Claude
   Code path does: `SOUL.claude.md`'s new "Creating a New Routine" section (A4) tells Coach to
   read `shared/workout-library/exercises.json` directly from the repo it's running in. Checked
   `carve-skeleton.mjs` - it has no `shared/` handling at all, and none of the five real athlete
   repos have a `shared/` directory. Carving this (and updating `carve-skeleton.mjs` to do it
   going forward) is real follow-up work, not covered by this doc's file column.
2. **`engine/scripts/compile-workout-cli.mts` (A4) is absent from every repo carved before A4.**
   A4 already added it to `carve-skeleton.mjs`'s `SKELETON_SCRIPT_FILES`, same pattern as #973's
   reconcile/rollover fix. A plain re-carve of `engine/scripts/` picks it up - no doc gap, just
   don't forget the step.

**Not gaps, checked directly:**

- **`engine/lib/compileWorkout.mts` (A1) needs no carve-skeleton change.** `SKELETON_ENGINE_DIRS`
  already copies `engine/lib/` wholesale (`fs.cpSync` with `recursive: true`), so any new file
  under it, including this one and its golden fixtures, comes along on the next ordinary re-carve.
- **A4's `_manifest.json` fix only matters for repos with the orphaned-template bug, and not all
  of them have it.** `carve-skeleton.mjs` now writes `_manifest.json` with both starter templates
  listed at carve time. Checked all five real repos' own `templates/_manifest.json`:
  `coach-skanda-2003` and `coach-akash-suresh` already list `foundation` (skanda also lists
  `strength_a`) in their existing manifests, so nothing to backfill there. `coach-prateekdevaraju`
  and `coach-shreyas-95-cyber` both have `foundation.json` and `strength_a.json` on disk but
  neither id in their manifest's `template_ids` - the exact orphan bug A4 fixes. `coach-date2022`
  has both template files and no manifest file at all, same invisibility, one step worse. All
  three need `foundation` and `strength_a` added to (or the file created with) `template_ids`.
- **`memory.json`'s new `training_availability` field (A3) needs no migration transform.** Every
  read site in `coachIntents.ts` reads it as `parsed.training_availability ?? null` off a
  `Partial<MemoryJson>` parse. A key that's missing entirely - true for all five real repos today -
  just resolves to `null`, same as an explicit `null`. Nothing throws, nothing to backfill. It
  fills in naturally the next time First Session Protocol intake runs.
- **A2's `FileDelete` capability (`githubGitData.ts`) is HQ-only.** `workout_remove` runs inside
  the hosted coach-chat backend; nothing about it touches an athlete repo's own files or scripts.

## Repos in scope, Workouts stack

Checked directly against each local clone on 2026-09-12:

| Repo | `shared/workout-library/`? | `engine/lib/compileWorkout.mts`? | `compile-workout-cli.mts`? | Manifest orphan bug? | `training_availability` present? |
|---|---|---|---|---|---|
| `skanda-2003/coach-skanda-2003` | absent | absent | absent | no - already listed | absent (defaults `null`) |
| `akash-suresh/coach-akash-suresh` | absent | absent | absent | no - already listed | absent (defaults `null`) |
| `prateekdevaraju/coach-prateekdevaraju` | absent | absent | absent | yes - needs backfill | absent (defaults `null`) |
| `date2022/coach-date2022` | absent | absent | absent | yes - no manifest at all | absent (defaults `null`) |
| `shreyas-95-cyber/coach-shreyas-95-cyber` | absent | absent | absent | yes - needs backfill | absent (defaults `null`) |

Every repo needs the same re-carve of `engine/lib/` and `engine/scripts/` once it picks up a
post-A4 HQ SHA - that's ordinary carve hygiene, not a special step. The manifest backfill and the
`shared/workout-library/` carve are the two items that need doing by hand, on top of that.

## Everything outside `user_data/` - drift check against a fresh carve

This stack (#973 and #727) only tracked the files each PR itself touched. It never asked the
broader question: how far has each real repo's non-`user_data/` content drifted from current HQ,
full stop. HQ keeps shipping carve-affecting changes these repos never automatically receive - a
repo only picks up a new carve when someone re-runs it by hand. Checked that broader question here,
once, against a dry-run carve of this whole stack's tip.

**Method:** `node platform/scripts/carve-skeleton.mjs --dry-run --out-dir <dir>` with no `--sha`,
so it carves from `a6e047e2` (this PR stack's own HEAD at the time of this check, 2026-09-12) -
the state every real repo should converge on once #727 merges. Diffed each repo's own
non-`user_data/` tree against that output: `CLAUDE.md`, `README.md`, `SETUP.md`,
`SOUL.claude.md`, `.gitignore`, `.coach-engine-version`, `.claude/`, `.github/workflows/`,
`engine/`, `propagated/docs/`. `user_data/` itself is out of scope for this check - see the next
section for why.

**Every one of the five real repos is behind, on all of the above except `CLAUDE.md`.** None have
picked up a carve since before the #973 stack, so none carry either #973's or #727's changes yet:

| Repo | `.coach-engine-version` pinned SHA | `SOUL.claude.md` diff | `sync.yml` has reconcile/rollover steps? | `engine/lib`, `engine/scripts` |
|---|---|---|---|---|
| `coach-skanda-2003` | `df3d1423` (#461) | 124 lines behind | no | missing `compileWorkout.mts`, `compile-workout-cli.mts`, `reconcile-current-week*`, `rollover-current-week*`, `hrZones.mjs`, `hr_zones.py`, `projectActivity.d.mts`, `text-caps.mts`, `validate-text-caps.py`, `vs_usual.py`; `current-week.mts` on the pre-#973 schema |
| `coach-akash-suresh` | `df3d1423` (#461) | 124 lines behind | no | same gap list as skanda |
| `coach-prateekdevaraju` | `df3d1423` (#461) | 124 lines behind | no | same gap list as skanda |
| `coach-date2022` | `df3d1423` (#461) | 124 lines behind | no | same gap list as skanda |
| `coach-shreyas-95-cyber` | `b731c3c3` (#663) - a later carve than the other four, but still pre-#973 | 113 lines behind | no | has `hrZones.mjs`, `projectActivity.d.mts`, `text-caps.mts`, `vs_usual.py` already (from its later carve); still missing `compileWorkout.mts`, `compile-workout-cli.mts`, `reconcile-current-week*`, `rollover-current-week*`; `current-week.mts` still on the pre-#973 schema |

`README.md`, `SETUP.md`, and `.gitignore` also drifted in `coach-skanda-2003` and
`coach-akash-suresh` specifically - both predate a `gen/aggregate.json` to
`gen/dashboard_snapshot.json` rename and the retired `propagated/SOUL.md` reference, neither of
which this stack introduced. `coach-prateekdevaraju`, `coach-date2022`, and
`coach-shreyas-95-cyber` already match the skeleton on those three files.

This confirms the doc's existing per-file findings above (manifest, `shared/`, `training_availability`)
still hold - none of the pulled branches touched anything this check reads. The new finding is
broader: once #727 merges, all five repos need a full re-carve, not just the specific files
#973 and #727 called out.

## Next step, not yet done: re-stamp the skeleton, then reconcile each repo

The dry-run above previewed what a carve *would* produce. It did not touch
`sibling-shipyard/coach-skeleton` - no live clone of that repo exists locally right now, and
nobody has run `carve-skeleton.mjs --push` since before this stack started. Three steps, strictly
in this order, once #727 merges:

1. **Re-stamp the skeleton first.** Run `carve-skeleton.mjs --push` from a current HQ `main`
   checkout so `sibling-shipyard/coach-skeleton` reflects post-#727 HQ, not the pre-#973 state it's
   pinned to today. Nothing below is valid until this runs.
2. **Then diff each of the five real repos' non-`user_data/` tree against the refreshed skeleton**
   and reconcile drift by hand - the same file list checked in the section above, using the real
   skeleton repo instead of a dry-run preview.
3. **Only after both of those, the skeleton becomes a valid reference for `user_data/`'s
   *structure*** - directory shape and expected file names, not content, since each athlete's data
   is obviously different from a fresh carve's placeholders. Checking `user_data/` structure
   against a stale skeleton would just re-detect the same staleness as step 1, not real drift.

None of this has run yet. It's a documented next step for whoever picks up the migration after
#727 merges, not a completed check.

## Done when

- All six repos above pass `./engine/scripts/validate-current-week` on `main`.
- Each athlete repo's `sync.yml` has run at least once post-migration with the Reconcile and
  Rollover steps both green.
- `ATHLETE_REPOS` in `run-manual-coach-chat-test.ts` lists all five athletes, not two.
- `carve-skeleton.mjs` carves `shared/workout-library/exercises.json` into new and re-carved repos.
- `sibling-shipyard/coach-skeleton` is re-stamped to post-#727 HQ (`carve-skeleton.mjs --push`).
- All five real repos' non-`user_data/` tree has been re-carved and matches that refreshed skeleton.
- All five real repos' `templates/_manifest.json` lists every starter template file actually on
  disk.
- This file is deleted in the finishing PR, per the plan-delete-on-last-PR rule.
