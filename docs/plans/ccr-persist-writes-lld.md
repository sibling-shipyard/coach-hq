# A1 — Persist every write, every turn — LLD

> Status: Current · Owner: Tech Lead · Verified: 2026-09-01

Execution detail for A1 in [`chat-commit-redesign.md`](chat-commit-redesign.md). Closes #616.

## Problem, precisely

Two independent gates, not one, currently block a write from landing on an ordinary (non-closing)
turn:

1. **Schema gate** (`ui/api/coach-chat/_lib/coachReplySchema.ts`, `responsePropertiesFor`): for a
   **returning athlete** on an **ordinary** turn, the allowed action-field list is `[]`. Gemini
   cannot produce `profile_update`, `memory_update`, `injury_flag`, `injury_event`, or
   `quest_event` structurally — not "the write gets dropped," it's never generated in the first
   place. `RETURNING_CLOSE_ACTIONS` (the full list: `coach_note, memory_update, sports_update,
   injury_flag, injury_event, quest_event, profile_update, template_edit, session_plan, week_plan,
   session_reconcile, plan_edit`) is closing-only.
2. **Commit gate** (`ui/api/coach-chat/_lib/fspWrites.ts`): `fspIncrementalWrites(wasProfileComplete,
   candidates)` returns `[]` once `wasProfileComplete` is true, discarding any write that *did*
   get produced (this is the whole of what #616 originally described, and the whole of what FSP's
   own testing found for equipment/injury timing).

FSP already works around gate 1 via `FSP_ACTIONS` (first-session-only, both ordinary and closing)
— that's why FSP mid-conversation writes exist at all today. A returning athlete has no equivalent
escape hatch.

## Fix

**Schema**: split `RETURNING_CLOSE_ACTIONS` into two groups instead of one closing-only list —
data-fact fields (`memory_update, sports_update, injury_flag, injury_event, quest_event,
profile_update`) become available on **every** turn regardless of mode; session-artifact fields
(`template_edit, session_plan, week_plan, session_reconcile, plan_edit`) stay closing-gated for now
(they're removed from "closing" entirely in C1 — don't do that here, keep this PR's diff to the
data-fact unlock only). `coach_note` stays closing-only pending C2.

**Commit path**: `fspWrites.ts` — drop the `wasProfileComplete` gate entirely:

```ts
export function fspIncrementalWrites(
  candidates: ReadonlyArray<FileEntry | undefined>,
): FileEntry[] {
  return candidates.filter(Boolean) as FileEntry[];
}
```

`coachTurn.ts`'s `commitOrdinaryTurn` (~line 605) calls it without the gate argument. Leave
`turn.wasProfileComplete` itself untouched on `TurnWrites` — it's still consumed by
`coachSinceStamp.ts`, `generateTemplatesAfterCompletion`, and the closing-file lazy-load, none of
which this PR touches.

**Chat history**: fold `turn.chatWrite` into the same always-commit set `commitOrdinaryTurn` writes
— today it's built every turn but only included on `commitClosingTurn`. No thread-order or
retention change here (that's A2); just stop skipping the write on ordinary turns.

**Commit message**: reword `"coach: first session details recorded"` (fires on every ordinary
write now, not just FSP ones) — something like `"coach: ordinary turn updates recorded"`.

## What does not change

- `commitClosingTurn` stays as-is, still the only path for `coach_note`/session-artifact fields.
- `isAthleteProfileComplete`/`isFirstSessionRitualDone` — untouched, still correct once B1 removes
  the placeholder that was fooling them.
- iOS/web routing (`GET /api/coach-chat-profile-status`) — separate code path, re-reads files fresh,
  unaffected by either gate change.

## Tests

- `fspWrites.test.ts`: rewrite the signature everywhere; replace the test asserting "does not write
  after profile complete" (currently locks in the bug) with one asserting writes pass through
  regardless.
- `coachTurn.test.ts`: add a `wasProfileComplete: true` sibling to the existing ordinary-turn
  incremental-write test.
- `fullTurnPipeline.test.ts`: rewrite the stale comment documenting the old behavior as intended;
  add a complete-profile fixture + ordinary `profile_update` turn asserting the write lands without
  a close (#616's own "Done when" #3).
- `coachReplySchema.test.ts` (or wherever schema shape is tested): add a case confirming a
  **returning, non-closing** turn's schema includes the unlocked data-fact fields.
- New eval fixture (`ui/scripts/examples/` or `_tests/coach-chat-eval/transcripts/`, matching the
  existing numbered convention): a returning athlete's ordinary "I'm 76kg now" turn, asserting the
  write lands without a close.

## Done when

A live re-test on `coach-skanda-2003`'s scratch branch: an ordinary "I'm 76kg now" turn commits
immediately (`git log` shows a new commit, `profile.json` reflects it) without ending the
conversation. `tsc`/`npm test` clean.
