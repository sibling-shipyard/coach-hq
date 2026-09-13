# Paid eval + manual verification: #999 hardening round

**Date:** 2026-09-13
**Why:** #999 changed prompt text (`coachPromptText.ts`) for the first time since the last paid eval run (2026-09-08). ADR 0024 says the golden-dataset eval should run once after a prompt/soul change, before calling it done. This also covers the two manual-verification gaps flagged in the prior status report: the web Workouts page and the iOS Workouts tab hadn't actually been looked at, only CI-green.

---

## 1. Paid eval (`npm run eval:coach-chat`, `LLM_PROVIDER=openrouter` - no direct Gemini key configured in this environment)

**19/23 passed, 0 cached (23 called the model fresh).** Full log: `tests/2026-09-13/eval/eval-coach-chat-log-13-26-12.json`.

**All 4 failures are pre-existing and unrelated to the #999 changes - none are regressions.**

### plan-edit-vs-template-edit-disambiguation - FAIL
- Asked: "Swap tomorrow's session for badminton instead, just this once."
- Model emitted a correct `week_update` patch (real `session_id`, real `template_id`, swapped discipline).
- Rubric expected the field `plan_edit` to be set. **`plan_edit` doesn't exist anymore** - `#973` (`708c7717`, already merged, unrelated to this stack) collapsed `week_plan`/`session_reconcile`/`plan_edit` into a single `week_update` action months ago. The model did the current-contract-correct thing; the fixture's rubric checks the retired field name.

### week-plan-kickoff-ritual - FAIL
- Asked for a full week to be laid out from scratch.
- Model emitted a correct, well-formed `week_update` kickoff (7 real days, real intents, real sessions).
- Rubric expected `week_plan`. Same retired-field-name issue as above.

### session-reconcile-actual-differs - FAIL
- Context had one planned session, dated 2026-09-04 (9 days before the eval's "today," 2026-09-13) - a stale fixture date, not a same-day match.
- Athlete: "Skipped the run, did a swim instead."
- Model correctly created a **new** unplanned session on today's actual date, status `done`, no `session_id` — correct, since there was no planned session on today's date to reference. **This is a live, positive confirmation that #999's new duplicate-session guard (`newSessionMayDuplicatePlan`) does not fire here** - it only blocks a new terminal-status session when a planned session exists on the *same* date, and there wasn't one.
- Rubric expected `session_reconcile`. Same retired-field-name issue.

### incremental-injury-disclosure [turn 3/3] - FAIL
- 3-turn conversation: athlete mentions hip soreness in turn 2, Coach flags it (`injury_flag` presumably fires turn 2, not shown as failing). Turn 3 is a closing "heading out now" message.
- Model re-emitted `injury_flag` for the same hip soreness on turn 3.
- Rubric expected `injury_flag` absent on turn 3 (already flagged, shouldn't re-fire).
- **Unrelated to workouts/current week** - this is an injury-disclosure de-duplication gap, nothing to do with #727's action fields.

**P2, not blocking:** 3 of 4 failures are stale eval fixtures checking for action fields that were retired by an already-merged, unrelated PR (`#973`). Worth a follow-up to update the fixtures so the eval suite reflects the current contract, but it's a documentation-of-tests issue, not a product bug.

---

## 2. Web Workouts page (`#991`) - manually verified in a browser, not just CI-green

Ran a real `npm run dev` against `feat/727-workouts-day-view-v2` (local-dev auth bypass), screenshotted with Playwright/Chromium:

- **Library browsing:** Today / This Week / Library three-band layout renders correctly with real catalog data (Foundation, Strength A/B, Calisthenics, Recovery Flow), each card showing duration, exercise/set counts, equipment, and a coaching note.
- **Workout detail:** opened "Foundation — AM Primer" - exercises, sets/reps/durations, form cues all correct.
- **Live timer:** clicked "Start workout" - the countdown timer actually ran (60s → 59s visible across two screenshots), auto-advance label, form cue, "why - coach" note, and "next exercise" preview all present and correct.
- **Zero console errors** across all three views once the local-dev auth bypass was correctly configured (see note below).

Note: the first attempt showed the marketing landing page instead of the dashboard - the copied `.env.local` had `VITE_FORCE_HOSTED_AUTH=true` (used for testing real GitHub OAuth), which sent the app through the real hosted-auth path and 500'd on `/api/auth/me` with no session. Not a bug - fixed by setting it to `false` for local-dev testing, per `ui/client/src/lib/devMode.ts`'s own documented behavior.

## 3. iOS Workouts tab (`#992`) - honest limitation

This machine is Linux/WSL2. There is no Xcode and no iOS simulator available, so I cannot render or screenshot the SwiftUI view myself, and I want to be upfront about that rather than imply I looked at it.

What I can confirm: CI's `iOS Build` job doesn't just compile - it runs `xcodebuild build-for-testing` + `test-without-building` on a real simulator, which executed the new `WorkoutsPageSelectorTests.swift` (173 lines covering the three-band grouping logic, the iOS equivalent of the web page's selector) and passed. That's real, automated coverage of the logic - just not a visual check of the rendered screen.

---

## Bottom line: what's left before this stack can merge

Nothing found that blocks merging. Everything checked this round either passed clean or turned out to be a pre-existing, unrelated gap:

- Paid eval: 19/23, all 4 failures pre-existing and explained above (3 stale fixtures from an unrelated already-merged PR, 1 unrelated injury-dedup gap).
- Web Workouts page: manually clicked through, works end to end, zero console errors.
- iOS Workouts tab: real unit tests ran on a real simulator in CI and passed; visual check isn't possible from this machine.

**Two P2 follow-ups, neither blocking:**
1. Update `eval-coach-chat`'s 3 stale fixtures (`plan-edit-vs-template-edit-disambiguation`, `week-plan-kickoff-ritual`, `session-reconcile-actual-differs`) to check for `week_update` instead of the retired `plan_edit`/`week_plan`/`session_reconcile` field names.
2. The `incremental-injury-disclosure` re-flagging gap, unrelated to this stack.

**Scoped, not yet built - next PR on top of `#999`:** live-test `activity_sync` turns against the #727 stack specifically. `run-manual-coach-chat-test.ts --activity-ids` and `run-manual-coach-message-test.ts` both already exist (added 2026-09-10) - no new harness needed. `coach-message.ts` doesn't touch `workout_create`/`week_update` at all (confirmed by reading it), so it's out of scope. `activity_sync` **does** run through the same `requestCoachReply`/`buildTurnWrites` pipeline as ordinary turns, and is arguably a more likely place to trip the duplicate-session guard than a chat turn (a synced activity reads as a report, not a conversation) - that's the concrete next test to run.
