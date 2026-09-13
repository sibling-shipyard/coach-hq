# Coach-chat action-field hardening: the remaining 6 fields

> Status: Proposal · Owner: Tech Lead · Created: 2026-09-13 · Issue: #1009
>
> Execution detail, exact regex patterns, and file/line references live in
> [`coach-chat-action-field-hardening-lld.md`](coach-chat-action-field-hardening-lld.md).

## Context

`#727`'s hardening round (merged to `main` via PR #999) found and fixed the same bug shape twice:
the model narrates a fact as saved in `reply`/`coach_note` but never sets the matching action
field, so nothing actually commits. Fixed for `workout_create`, `week_update`, and `season_start`.
The fix pattern is recorded as durable reference in `docs/eng-docs/gemini-flow.md`'s
"Narration-vs-action reliability guards" section.

That section's own coverage table names six action fields with **zero** protection today:
`profile_update`, `injury_event`, `coaching_style_update`, `sports_update`, `workout_remove`, and
standalone `quest_create` (no `season_start` in the same turn). The athlete asked for these to be
closed the same way, starting with `profile_update`. That doc already flags it as the most
urgent - it fires on the same dense first-session turns already shown (Finding D) to silently
drop fields under load.

This plan applies the documented 3-step pattern (prompt reinforcement → deterministic reprompt,
only with a safe trigger signal → write-time guard, for a different failure shape) field by field,
and is honest that not every field gets the same treatment. Three fields have a genuinely safe,
narrow trigger signal available. Two don't, and forcing one onto them would repeat the exact
mistake "gap 2a" was rejected for in the #727 review: real false-positive risk against ordinary
conversation. The sixth (`injury_event`) needs its own narrower scoping, not a copy of the
existing injury pattern.

## What happens on approval

1. **Done:** tracked as issue #1009. Every PR below cites it as `Refs: #1009` (`Fixes: #1009` on
   the last one).
2. Worktree off `origin/main` per batch, e.g.
   `git worktree add -b core/1009-profile-update-hardening /tmp/wt-1009a origin/main`.
3. Land as 3 stacked PRs. PR A (Batch 1: `profile_update`, plus the two prompt-only conclusions
   for `coaching_style_update` and standalone `quest_create`) ships first - it's the flagged
   priority, and the prompt-only pieces are free to include alongside it. PR B (Batch 2:
   `workout_remove`, `sports_update`) stacks on PR A. PR C (Batch 3: `injury_event`) stacks on PR
   B, last, since its false-positive-safe scoping (exactly-one-active-flag) needs the most care.
   Each batch is independently reviewable and live-testable, same bar as #999.
4. Update `docs/eng-docs/gemini-flow.md`'s coverage table after each batch lands - the one place
   this state is recorded, not a second copy.
5. `bash platform/scripts/check.sh --quiet` before every push. Live-test every reprompt/guard
   addition against `coach-skanda-2003` on a scratch branch before calling a batch done, per the
   #727 round's own established rule.
6. Per `docs/eng-docs/README.md`'s plan-delete-on-last-PR rule: PR C (the last PR in this stack)
   folds anything durable into `gemini-flow.md` and deletes both this doc and its LLD in the same
   PR. Git history is the archive.

## Per-field design, summary

| Field | Feasibility | Approach |
|---|---|---|
| `profile_update` | High | prompt + `findMissedProfileLanguage`, per-subfield patterns, first-session only |
| `workout_remove` | Medium-high | prompt + `findMissedRemovalLanguage`, returning-athlete only |
| `sports_update` | Medium | prompt + `findMissedSportsLanguage`, new-activity phrasing only, needs a narrowing pass |
| `injury_event` | Medium, needs care | prompt + `findMissedInjuryUpdateLanguage`, fires only when exactly one active injury flag exists |
| `coaching_style_update` | Low - prompt only | no safe reprompt signal; explicit-request language is too close to ordinary venting |
| standalone `quest_create` | Low - prompt only | `findMissedHabitLanguage` already covers first-session; extending to returning athletes has no "nothing on file yet" disambiguator |

Full reasoning, exact patterns, wiring locations, and test plans: see the LLD.

## Verification

- `npx tsc --noEmit` clean, full `api/coach-chat/` suite passing, zero regressions - same bar as
  #999.
- New unit tests per field, mirroring the existing `missed-habit-language`/`missed-season-language`
  `describe` block structure. Fires on the target phrasing. Stays silent when the field's already
  covered, on the wrong turn type, and on adjacent-but-different phrasing that should NOT trigger
  it.
- Live test each field against `coach-skanda-2003` on a scratch branch before calling its batch
  done. Expect, per the #727 round's own finding, that a live rerun may not reproduce the exact
  trigger on demand even when the fix is correct - the unit test is the real proof, the live test
  is the regression/false-positive check.
- `bash platform/scripts/check.sh --quiet` on every push.
