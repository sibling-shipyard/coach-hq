# Coach-chat redesign — remaining follow-ups

> Status: Current · Owner: Tech Lead · Verified: 2026-09-11

The chat-commit redesign itself (A1-K1) merged to `main` today via PR #956 and its full stack.
Per `AGENTS.md`'s plan-delete-on-last-PR rule, `docs/plans/chat-commit-redesign.md` and every
`ccr-*-lld.md` file are deleted in this same PR — durable content already lives in
`docs/eng-docs/coach-data-schema.md`, `coach-chat-daily.md`, `coach-chat-fsp.md`,
`coach-chat-testing.md`, and `coach-chat-design-history.md`. This file holds the handful of real
items still open, so nothing gets silently dropped with the plan docs.

## F1 — repo migration (closes #760) — done, except two explicitly non-blocking items

**Step 3.** Field backfill (`coaching_style`, `main_quest.season_id`, `coach-date2022`'s missing
`latest_message.json`) shipped same-day as the merge. One PR per athlete repo, all 5 merged
2026-09-11 (`coach-skanda-2003` #5, `coach-akash-suresh` #7, `coach-prateekdevaraju` #1,
`coach-date2022` #3, `coach-shreyas-95-cyber` #1). Urgent because production's
`isAthleteProfileComplete()` now requires `coaching_style`.

**Step 0.** `node platform/scripts/carve-skeleton.mjs --push` run for real 2026-09-11, from HQ
`main` pulled fresh (it had been 31 commits behind). `sibling-shipyard/coach-skeleton` confirmed
live via the GitHub API - `coaching_style`, `main_quest: null`, no placeholder data, matches the
final shape.

**Step 1.** Full structural diff of all 5 real repos against the freshly-stamped skeleton, run
2026-09-11 (`git pull`ed fresh, `git ls-files` on each repo's `user_data/coach/`,
`user_data/ledger/`, `user_data/activities/sync_state.json`). **Missing: none** -
`coach-date2022`'s prior gap is closed, all 5 repos have exactly the 13 expected files. **Extra:**
`coach-skanda-2003` (`leftover_coach_notes.md`, `sleep_log.json`) and `coach-akash-suresh` (those
two plus `opponent_notes.md`) - both already tracked in #966. `coach-prateekdevaraju`,
`coach-date2022`, `coach-shreyas-95-cyber` match exactly.

**Step 2.** The athlete's call on #966's items: file them, don't remove them now - not harmful
today. Nothing further to do here.

Two items still genuinely open, both explicitly non-blocking:

1. **Equipment** — empty in `memory.json.notes.equipment` on `coach-akash-suresh`,
   `coach-prateekdevaraju`, `coach-shreyas-95-cyber`. Not blocking anything (confirmed:
   `isAthleteProfileComplete()` doesn't check it, unlike `coaching_style`). Worth checking whether
   any of the three already stated it in a past conversation and had it lost to #616's old
   write-loss bug, rather than assuming it was never discussed. Check `chat_history.json` where old
   threads survived, or just ask directly.
2. **Prateek's season `end_date`.** His season (`season_strength_weight_gain_sea_o1jd`) runs
   through `2026-11-25`, which doesn't literally read as "end of year" (his stated goal framing).
   The athlete's call was to leave it as originally given — closed, not a to-do, noted here only
   so the discrepancy isn't mysterious later.

## A real, unresolved reliability question from G1's eval-suite pass

Found live during B1's own re-test, never settled. When an athlete states profile basics, their
goal, **and** habits all together in one single turn (not spread across turns), `quest_create` did
not fire. Only `season_start`/`sports_update` did, and it took an explicit follow-up nudge.

Unclear whether this is correct behavior or a real prompt-reliability gap. `B_engine.md`'s FSP
step 4 says quests get set up "near the end," so the model may have correctly judged intake wasn't
done yet. Fixture #30 doesn't cover this case either - it spreads the same facts across separate
turns, a structurally different shape. Needs its own eval fixture and a real live run to settle
which, rather than guessing either way.

## Two items deliberately deferred to the (separate) workouts/`current_week` redesign

Found during K1's final pass, explicitly not pursued now since a separate redesign is already
planned for this area:

- **`week_plan` (Weekly Kick-off Ritual) JSON-malformation on flash.** With an unambiguous ask,
  2 clean passes out of 5, 3 `Unterminated string`/`Expected double-quoted property name` parse
  failures. When it does commit, content is correct — the 7-day, per-day-sessions-array schema is
  large and flash appears prone to truncating/malforming output at that size. Provider-specific to
  flash, not reproduced on direct pro in this investigation.
- **`session_plan` has zero dedicated live-tested coverage.** Not tested in K1's pass
  (time-boxed); its shape will likely change with the workouts redesign anyway.

## Related

- Athlete-repo leftover files (`sleep_log.json`, `leftover_coach_notes.md`, `gen/` extras,
  archived seasons on `coach-skanda-2003`/`coach-akash-suresh`): tracked in #966, not duplicated
  here.
- Design history: `docs/eng-docs/coach-chat-design-history.md`.
- Full testing story: `docs/eng-docs/coach-chat-testing.md`.
