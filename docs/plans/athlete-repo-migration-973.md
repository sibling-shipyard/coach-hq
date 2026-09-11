# Athlete repo migration: the Current Week stack (#973)

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

## Done when

- All six repos above pass `./engine/scripts/validate-current-week` on `main`.
- Each athlete repo's `sync.yml` has run at least once post-migration with the Reconcile and
  Rollover steps both green.
- `ATHLETE_REPOS` in `run-manual-coach-chat-test.ts` lists all five athletes, not two.
- This file is deleted in the finishing PR, per the plan-delete-on-last-PR rule.
