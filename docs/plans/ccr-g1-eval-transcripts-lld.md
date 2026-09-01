# G1 — Trim and update eval transcripts — LLD

> Status: Current · Owner: Tech Lead · Verified: 2026-09-01

Execution detail for G1 in [`chat-commit-redesign.md`](chat-commit-redesign.md). Runs after C1
(closing turn removed) and D1 (validation mechanism exists), so the trimmed set tests final
behavior, not an intermediate state that's about to change again.

## Current state

`ui/api/coach-chat/_tests/coach-chat-eval/transcripts/` holds 24 golden transcripts (numbered
01-28 with some gaps from prior removals), run against a live Gemini call via
`npm run eval:coach-chat` (`docs/eng-docs/coach-chat-testing.md` documents the layer — this LLD
updates that doc too, see below). The athlete's call: 24 is too many to stay meaningful, and a
chunk of them test behavior this redesign deletes outright.

## What gets deleted outright

Anything testing closing-turn-specific behavior that C1 removes:
`03-close-happy-path.json`, `07-false-positive-close-signal.json`,
`09-coach-note-only-close.json`, `22-multi-write-close.json`, and any other transcript whose
`expect` block asserts on `session_closed`, `mode: "closing"`, or a closing-only action field
(`template_edit`/`session_plan`/`week_plan`/`session_reconcile`/`plan_edit` — check each once C1's
actual field-availability change is known, since some of these move to always-available per C1).

## Target shape: 5-7 simple + 5-7 multi-turn, ~10-14 total

**Simple (single-message, `mode`/`userMessage`/`expect`) — keep or rewrite the ones that still test
a real, current decision point:**
- Greeting (`01-greeting.json`) — still relevant.
- Ordinary turn producing a write (`02-ordinary.json`) — rewrite to confirm it commits without any
  closing concept, since that's now just normal behavior, not a special case.
- Profile update (`12-profile-update.json`).
- Quest/injury event as an array (`10-quest-event-array.json`, `11-injury-event-array.json`) — keep,
  still real decision points.
- Activity sync (`20-activity-sync.json`).
- One dynamic-enum/hallucination case (new, replacing `23-hallucinated-template.json`'s spirit) —
  a bad `flag_id`/`quest_id` reference, asserting D1's corrective retry or rejection-with-Sentry-
  capture behavior, not the old silent-drop.

**Multi-turn (`turns: [...]`) — keep the ones testing real cross-turn state, drop the ones testing
close-detection specifically:**
- FSP quest_create (`27-fsp-quest-create.json`) — keep, this is the bug that started this whole
  redesign.
- FSP new injuries (`28-fsp-new-injuries.json`) — keep.
- Incremental injury disclosure (`25-incremental-injury-disclosure.json`) — keep, now doubly
  relevant since A1 makes this commit immediately instead of at close.
- **New**: a returning-athlete multi-turn transcript stating a goal/habit mid-conversation (B3's
  exact scenario) — didn't exist before because returning athletes couldn't do this at all.
- **New**: FSP goal + habits stated *after* profile fields complete in the same conversation — the
  exact live bug this whole redesign traces back to (B1's fix, matches the eval fixture already
  planned in that LLD — coordinate, don't duplicate).
- Contradictory instruction (`24-contradictory-instruction.json`) — keep if still a real edge case
  post-redesign, drop if C1's simplification makes it moot.

Exact final list is the implementer's call within this shape — the point is 5-7 + 5-7, covering
real current decision points, not historical regression tests for deleted behavior.

## Doc update

`docs/eng-docs/coach-chat-testing.md` needs its own pass: the "layered test suite" description
(layer1/2/3/integration) should still be accurate post-redesign, but confirm — `commitOrdinaryTurn`/
`commitClosingTurn` merging into one function (C1) may change what `integration/` actually tests.
Update the transcript count/examples referenced if any are named specifically. Leave the broader
eng-docs sweep (other docs, SOUL) to H1 — this file only touches the testing doc itself.

## Tests

This PR *is* test infrastructure — its own verification is `npm run eval:coach-chat` actually
running clean against the trimmed set, and `npm test` (the layered suite) staying green throughout
since none of layer1/2/3 depend on the eval transcripts.

## Done when

`ui/api/coach-chat/_tests/coach-chat-eval/transcripts/` holds 10-14 files, none testing deleted
closing-turn behavior, at least 2 new ones covering behavior this redesign added.
`docs/eng-docs/coach-chat-testing.md` accurately describes the post-redesign shape.
