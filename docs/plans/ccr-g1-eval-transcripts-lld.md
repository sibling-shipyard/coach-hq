# G1 — Trim and update eval transcripts — LLD

> Status: Current · Owner: Tech Lead · Verified: 2026-09-01

Execution detail for G1 in [`chat-commit-redesign.md`](chat-commit-redesign.md). Closes #670. Runs
after C1 (closing turn removed) and D1 (validation mechanism exists), so the trimmed set tests final
behavior, not an intermediate state that's about to change again.

## Also closes #670 — the eval CI check has never once passed

`eval-coach-chat.yml` has been red on every run since it started (2026-08-25). All 22-24
transcripts, ~7 failures per run — never diagnosed as "rubric wrong" vs. "product wrong." A gate
that's never been green isn't gating anything; nobody can tell a real regression from the baseline
noise it's already sitting in. This PR is the natural place to fix it: it already rewrites most of
the transcript set, so build the new 10-14 verified to actually pass, not just written and assumed
correct.

For every transcript **carried forward unchanged** from the old set (not rewritten by this PR),
diagnose why it's been failing before keeping it. Read the actual failure output, and sort "the
fixture/expectation is stale" from "this is a real, current product bug" (per the issue's own
framing). A stale-rubric case gets its expectation corrected. A real bug gets filed as its own
issue and the transcript kept red *deliberately*, documented as a known failure — not silently
dropped just to make the gate pass.

## Current state

`ui/api/coach-chat/_tests/coach-chat-eval/transcripts/` holds 24 golden transcripts (numbered
01-28 with some gaps from prior removals), run against a live Gemini call via
`npm run eval:coach-chat` (`docs/eng-docs/coach-chat-testing.md` documents the layer — this LLD
updates that doc too, see below). The athlete's call: 24 is too many to stay meaningful, and a
chunk of them test behavior this redesign deletes outright.

## What gets deleted outright

Anything testing closing-turn-specific behavior that C1 removes:
`03-close-happy-path.json`, `07-false-positive-close-signal.json`,
`09-coach-note-only-close.json`, `22-multi-write-close.json`. Same for any other transcript whose
`expect` block asserts on `session_closed`, `mode: "closing"`, or a closing-only action field
(`template_edit`/`session_plan`/`week_plan`/`session_reconcile`/`plan_edit`). Check each one once
C1's field-availability change is known — some of these move to always-available.

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
- **New — a real finding from B1's own live re-test, not yet covered by any fixture**: profile
  basics, the goal, and the habits all stated together in **one single turn** (not spread across
  turns like fixture #30 tests). B1's live test found `quest_create` did *not* fire in that case —
  only `season_start`/`sports_update` did — and needed an explicit follow-up nudge before it fired.
  Unclear from that test alone whether this is correct behavior (`B_engine.md` Step 4 says quests
  get set up "near the end," so the model may have correctly judged intake wasn't done yet) or a
  real prompt-reliability gap. Add this exact scenario as its own fixture and use a real run to
  settle which — don't guess, and don't silently drop it because #30 already covers a
  similar-looking but structurally different case (separate turns, not one combined turn).
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
since none of layer1/2/3 depend on the eval transcripts. Record the run per this repo's convention
(`tests/<date>/eval/`) as the evidence the gate is real now, not just green by omission.

## Done when

`ui/api/coach-chat/_tests/coach-chat-eval/transcripts/` holds 10-14 files, none testing deleted
closing-turn behavior, at least 2 new ones covering behavior this redesign added.
`eval-coach-chat.yml` is green on the pushed SHA — the first time this gate has ever passed — with
any transcript still deliberately red backed by its own filed issue, not silently dropped.
`docs/eng-docs/coach-chat-testing.md` accurately describes the post-redesign shape.
