# G2 — Redesign the layered test suite for the post-redesign system — LLD

> Status: Current · Owner: Tech Lead · Verified: 2026-09-01

Execution detail for G2 in [`chat-commit-redesign.md`](chat-commit-redesign.md). Runs after every
other backend PR in this redesign (A-D) has landed, so it tests the final shape once, not an
intermediate one — same reasoning as G1, different layer. G1 covers the live-Gemini eval-transcript
suite; this covers the no-network layered suite (`layer1-gemini`, `layer2-fields`, `layer3-commit`,
`integration/`) that runs on every `npm test`.

## Why this needs its own pass, not just each PR's own test updates

Every individual PR in this redesign already updates the specific tests its own change touches
(each LLD's own "Tests" section). That's necessary but not sufficient — after A1 through D3 have all
landed, the three layers this codebase's own testing philosophy is built around
(`docs/eng-docs/coach-chat-testing.md`: "input → decision, decision → file content, file content →
git commit") have each changed in ways that only make sense together: layer1's schema is now
unified across every turn (A1/B3/C1, no more ordinary/closing split), layer2's appliers handle
partial-commit-not-atomic semantics and dynamic enum validation (D1/D2) plus new logic entirely
(C2's day-keyed coach_log overwrite, B3's season transition), layer3's commit path splits chat
history from structured facts and preserves the reply on failure (D1). A test suite assembled
incrementally, PR by PR, risks gaps at the seams between changes that only a full pass across all
three layers together will catch.

## Scope — audit and rewrite each layer against the final system

- **`layer1-gemini/`** (`geminiClient.ts::askGemini`): confirm every mode/schema branch that used to
  exist (ordinary vs. closing, returning vs. first-session) is gone or correctly simplified;
  confirm the dynamic enum injection (D1) is tested with real per-athlete id lists, not a static
  fixture; confirm the corrective-retry path (D1) is exercised, not just described.
- **`layer2-fields/`** (`coachIntents.ts`, `turnWrites/*.ts`): confirm every applier reflects its
  final shape — `applyQuestCreate`'s nullable `main_quest` (B1), `applySeasonStart`'s transition
  logic (B3), the day-keyed coach_log overwrite (C2), D2's expanded enum coverage. Remove any test
  that still asserts pre-redesign behavior (the same "delete tests that lock in the old bug" pattern
  A1's own LLD already calls out for `fspWrites.test.ts`).
- **`layer3-commit/`** (`githubGitData.ts::commitFilesAtomic`): confirm the chat-history/
  structured-facts commit split (D1) is tested, and the reply-preservation-on-failure path (D1) has
  real coverage, not just a description in that LLD.
- **`integration/`**: `fullTurnPipeline.test.ts` should reflect one unified turn shape (C1 removed
  the ordinary/closing split) — audit for any test still wired around the old two-path structure.
  `coachTurn.test.ts`/`coachTurn-reprompt.test.ts`/`activitySyncTurn.test.ts` get the same pass.

## Does this need its own PR, separate from G1?

Yes — different layer, different dependency shape (G1 needs live Gemini access and is manual/
CI-gated per ADR 0024's paid-checks discipline; G2 is the no-network suite that runs on every
commit, closer in spirit to the backend PRs than to G1's eval work), and combining them would make
one PR's diff span both `coach-chat-eval/` fixtures and the entire `_tests/` unit suite — too broad
for one reviewable change. Kept as a sibling PR under the same G milestone instead.

## Doc update

`docs/eng-docs/coach-chat-testing.md`'s own description of the three layers should still be
accurate after this — confirm, don't assume; update if any layer's actual boundary shifted (e.g. if
chat-history's commit split changes what `layer3-commit` is responsible for).

## Tests

This PR *is* the test update — its own verification is `npm test` passing clean against the
rewritten suite, and a manual diff review confirming no test still asserts pre-redesign behavior
(the specific risk this PR exists to catch).

## Done when

Every layer's test file reflects the final, post-redesign system with no stale assertions from the
old ordinary/closing split, the old atomic-only commit model, or the old FSP-only quest/season
availability. `npm test` green. `docs/eng-docs/coach-chat-testing.md` confirmed accurate.
