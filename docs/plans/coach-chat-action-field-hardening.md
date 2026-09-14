# Coach-chat action-field hardening: the remaining 7 fields

> Status: Proposal · Owner: Tech Lead · Created: 2026-09-13 · Re-verified: 2026-09-14 · Issue: #1009
>
> Execution detail, exact regex patterns, and file/line references live in
> [`coach-chat-action-field-hardening-lld.md`](coach-chat-action-field-hardening-lld.md).
>
> **Re-verified against the complete field list, not just the coverage table.** Cross-checked
> every one of the 15 write-action fields in `coachReplySchema.ts`'s `GeminiReply` interface
> against `docs/eng-docs/gemini-flow.md`'s coverage table and against the actual shipped code, not
> the table's claims alone. Found one field the table itself omits entirely: **`memory_update`**,
> added below as a seventh field.
>
> Everything else is accounted for. `workout_create`, `week_update`, `season_start`,
> `injury_flag`, `quest_event`, and `template_edit`/`session_plan` are already covered by shipped
> #727/#999 work, confirmed against real code, not assumed from the table. Every remaining field
> is already one of this plan's original six.
>
> `coach_note` is also missing from the table but needs no new work. It already has a real,
> shipped guard: `coachTurn.ts:433-450`'s C2-era rule requires `coach_note` whenever another
> action field fires the same turn. Noted here so the field list is genuinely complete, not
> because it's a gap.

## Context

`#727`'s hardening round (merged to `main` via PR #999) found and fixed the same bug shape twice:
the model narrates a fact as saved in `reply`/`coach_note` but never sets the matching action
field, so nothing actually commits. Fixed for `workout_create`, `week_update`, and `season_start`.
The fix pattern is recorded as durable reference in `docs/eng-docs/gemini-flow.md`'s
"Narration-vs-action reliability guards" section.

That section's own coverage table names six action fields with **zero** protection today:
`profile_update`, `injury_event`, `coaching_style_update`, `sports_update`, `workout_remove`, and
standalone `quest_create` (no `season_start` in the same turn). A seventh, `memory_update`, has the
same zero protection but was never added to that table - confirmed directly: no narration-reminder
sentence in `coachPromptText.ts` (unlike `season_start`'s explicit "never describe... without
setting" line), no `findMissed*Language` function, no write-time guard. The athlete asked for
these to be closed the same way, starting with `profile_update`. That doc already flags it as the
most urgent - it fires on the same dense first-session turns already shown (Finding D) to silently
drop fields under load.

This plan applies the documented 3-step pattern (prompt reinforcement → deterministic reprompt,
only with a safe trigger signal → write-time guard, for a different failure shape) field by field,
and is honest that not every field gets the same treatment. Three fields have a genuinely safe,
narrow trigger signal available. Three don't, and forcing one onto them would repeat the exact
mistake "gap 2a" was rejected for in the #727 review: real false-positive risk against ordinary
conversation. The seventh (`injury_event`) needs its own narrower scoping, not a copy of the
existing injury pattern.

## What happens on approval

1. **Done:** tracked as issue #1009. Every PR below cites it as `Refs: #1009` (`Fixes: #1009` on
   the last one).
2. Worktree off `origin/main` per batch, e.g.
   `git worktree add -b core/1009-profile-update-hardening /tmp/wt-1009a origin/main`.
3. Land as 3 stacked PRs. PR A ships first - it's the flagged priority. It carries Batch 1
   (`profile_update`), the three prompt-only conclusions (`coaching_style_update`, standalone
   `quest_create`, `memory_update`), and the Sentry fix below, since all three are free to
   include alongside the priority field. PR B (Batch 2: `workout_remove`, `sports_update`)
   stacks on PR A. PR C (Batch 3: `injury_event`) stacks on PR B, last, since its
   false-positive-safe scoping (exactly-one-active-flag) needs the most care. Each batch is
   independently reviewable and live-testable, same bar as #999.
4. Update `docs/eng-docs/gemini-flow.md`'s coverage table after each batch lands - the one place
   this state is recorded, not a second copy.
5. `bash platform/scripts/check.sh --quiet` before every push. Live-test every reprompt/guard
   addition against `coach-skanda-2003` on a scratch branch before calling a batch done, per the
   #727 round's own established rule.
6. Per `docs/eng-docs/README.md`'s plan-delete-on-last-PR rule: PR C (the last PR in this stack)
   folds anything durable into `gemini-flow.md` and deletes both this doc and its LLD in the same
   PR. Git history is the archive.

## Sentry gap, found during re-verification: the "still unresolved" case never reaches Sentry

Checked directly (2026-09-14), not assumed: `requestCoachReply`'s reprompt mechanism
(`coachTurn.ts`) already wraps the *whole* function - every `askGemini` call, including the
reprompt - in one `try`/`catch` that calls `captureGeminiFailure` on a thrown error. That part is
fine; a network/API failure on any call, first or reprompt, already reaches Sentry.

**What's missing:** the "still" block (`coachTurn.ts:868-908`) - which runs after every reprompt
to check whether the fix actually worked - only ever calls `console.warn` when a guard is still
unresolved. It never calls Sentry. This is the exact failure mode this whole plan exists to catch:
the reprompt ran, Gemini responded again, and the narration-vs-action problem is *still* there.
Today that's invisible outside a local log, for every existing guard (`findMissedInjuryLanguage`,
`findMissedHabitLanguage`, `findMissedSeasonLanguage`, the oversized-field/missing-note/
unconfirmed-assumption/malformed-exercise/prose-only-week-plan checks) and for every new detector
this plan adds.

**The fix, part of PR A:** extend `ui/api/_lib/sentry.ts` with a small capture helper for this
shape - a "still unresolved after reprompt" event naming which detector(s) fired, the turn mode,
and the trace id. Call it from the "still" block's existing `if (...)`, alongside the current
`console.warn`, not instead of it. Every batch after PR A gets this for free, since the "still"
block is one shared mechanism all detectors, old and new, already run through.

**Verification:** a unit test confirming the new Sentry capture fires when a detector is still
unresolved after the reprompt. Mock the capture function and assert it was called with the right
detector name, mirroring how `coachTurn-reprompt.test.ts` already asserts on `console.warn`'s
arguments for the same case.

## Per-field design, summary

| Field | Feasibility | Approach |
|---|---|---|
| `profile_update` | High | prompt + `findMissedProfileLanguage`, per-subfield patterns, first-session only |
| `workout_remove` | Medium-high | prompt + `findMissedRemovalLanguage`, returning-athlete only |
| `sports_update` | Medium | prompt + `findMissedSportsLanguage`, new-activity phrasing only, needs a narrowing pass |
| `injury_event` | Medium, needs care | prompt + `findMissedInjuryUpdateLanguage`, fires only when exactly one active injury flag exists |
| `coaching_style_update` | Low - prompt only | no safe reprompt signal; explicit-request language is too close to ordinary venting |
| standalone `quest_create` | Low - prompt only | `findMissedHabitLanguage` already covers first-session; extending to returning athletes has no "nothing on file yet" disambiguator |
| `memory_update` | Low - prompt only | five different note categories (fitness baseline, coaching priorities, three learned-pattern types, equipment), no single narrow phrasing to key a detector on without the same broad false-positive risk `coaching_style_update` was rejected for |

`coach_note` needs no row here - already covered by a shipped guard, see the header note above.

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
