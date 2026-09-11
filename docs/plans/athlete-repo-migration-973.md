# Athlete repo migration: the Current Week stack (#973)

> Status: Ready, not started · Owner: Tech Lead · Created: 2026-09-11
>
> Deferred on purpose: do this after Workouts lands, not before. Nothing in the #973 stack
> breaks an unmigrated repo. The hosted chat handler and the schema live in HQ, not in the
> athlete repo, so an old-shaped `current_week.json` just keeps working under the old rules
> until its repo is migrated. There's no forcing deadline.

## Why this exists

Every athlete repo, and the `sibling-shipyard/coach-skeleton` template they're forked from, was
carved before the #973 stack (ADR 0039) landed. Four things changed that a carve, not a chat
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

## Verified real, against `coach-skanda-2003`

Checked directly, not assumed - on a scratch branch (`test/973-week-update-verify`, still on
GitHub, not merged to `main`), not the athlete's real data:

| File | Real diff |
|---|---|
| `user_data/ledger/current_week.json` | 2 lines (`coach_comments`, one `planned_load`) - migrated cleanly, `parseCurrentWeek` accepted the result with zero issues |
| `engine/lib/current-week.mts` | 171 lines behind HQ |
| `propagated/docs/current-week-contract.md` | still describes `draft`/`planned_load`/free-text discipline |
| `SOUL.claude.md` | 106 lines behind HQ's composed build |
| `engine/scripts/` | `reconcile-current-week*` and `rollover-current-week*` absent entirely |

After migrating just `current_week.json` on that scratch branch, a real end-to-end run against
the hosted chat handler (OpenRouter Gemini Flash, since the direct Gemini key is unavailable
right now) confirmed the new stack works against real data:

1. A full-week `week_update` kickoff committed a real, schema-valid live week.
2. The deterministic reconciler, run locally against the branch, correctly attached two real
   logged activities (a walk, a run) it found in `user_data/activities/hist/` as new `unplanned`
   sessions with real `healthkit:` ids - no chat turn involved.
3. The rollover job correctly replaced a week that had gone stale (ended 2026-08-23, today's
   2026-09-11) with a placeholder frame for the real current week (`2026-W37`).
4. A follow-up chat turn ("just finished Monday's run") sent a patch-shaped `week_update` that
   marked the right session `done` and touched nothing else.

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
   `planned_load` (every session); if `data_status` is ever `draft` in a real repo (unlikely -
   nothing has written it in months), map it to `placeholder`. The transform used to verify this
   against `coach-skanda-2003` is three lines of Python, reusable as-is:
   ```python
   d.pop("coach_comments", None)
   if d.get("data_status") == "draft":
       d["data_status"] = "placeholder"
   for day in d["days"]:
       for s in day["sessions"]:
           s.pop("planned_load", None)
   ```
5. **Validate**: `./engine/scripts/validate-current-week` must pass clean before committing.
6. **Live-test** on a scratch branch before touching `main` - same discipline as every
   coach-chat change, not skipped just because this is a data migration.

## Repos in scope

- `sibling-shipyard/coach-skeleton` - the template every new athlete repo forks from. Migrate
  first; every repo carved after it inherits the fix.
- `skanda-2003/coach-skanda-2003`
- `akash-suresh/coach-akash-suresh`

Confirm this list is still complete before starting - a repo not listed in
`ui/scripts/run-manual-coach-chat-test.ts`'s `ATHLETE_REPOS` map, or a newer one, would be missed.

## Done when

- All three repos above pass `./engine/scripts/validate-current-week` on `main`.
- Each repo's `sync.yml` has run at least once post-migration with the Reconcile and Rollover
  steps both green.
- This file is deleted in the finishing PR, per the plan-delete-on-last-PR rule.
