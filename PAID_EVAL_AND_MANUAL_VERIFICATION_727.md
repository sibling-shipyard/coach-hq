# Paid eval + manual verification: #999 hardening round

**Date:** 2026-09-13
**Why:** #999 changed prompt text (`coachPromptText.ts`) for the first time since the last paid eval run (2026-09-08). ADR 0024 says the golden-dataset eval should run once after a prompt/soul change, before calling it done. This also covers the two manual-verification gaps flagged in the prior status report: the web Workouts page and the iOS Workouts tab hadn't actually been looked at, only CI-green.

---

## 1. Paid eval (`npm run eval:coach-chat`, `LLM_PROVIDER=openrouter` - no direct Gemini key configured in this environment)

**First run: 19/23 passed, 0 cached.** Full log: `tests/2026-09-13/eval/eval-coach-chat-log-13-26-12.json`.

**All 4 failures in that run were stale fixtures, not #999 regressions** - three (`plan-edit-vs-template-edit-disambiguation`, `week-plan-kickoff-ritual`, `session-reconcile-actual-differs`) checked for `plan_edit`/`week_plan`/`session_reconcile`, action fields `#973` (already merged, unrelated to this stack) collapsed into `week_update` months before this round - the model did the current-contract-correct thing every time, the fixtures just hadn't been updated. `session-reconcile-actual-differs` also had a second, independent bug: its "planned" session was hardcoded to a date 9 days stale, so it had rotted into testing "create an unplanned session on an empty day" instead of the real session-reconcile-against-an-existing-plan case it was written for.

**Fixed, all three now confirmed passing individually** (`19-plan-edit-vs-template-edit-disambiguation.json`, `41-week-plan-kickoff-ritual.json`, `42-session-reconcile-actual-differs.json`):
1. Updated `expect.actionFieldsPresent` in all three to `week_update`.
2. Updated `19`'s and `42`'s `extraContext` strings to the current real prompt phrasing (`activeWeekSessionsContext`/`activeTemplatesContext` in `coachPromptText.ts`), replacing the stale "use these exact session_ids for session_reconcile AND plan_edit" text.
3. Added `{{TODAY}}` token support to `eval-coach-chat.ts`'s `resolveRelativeDates`, mirroring the existing `{{TOMORROW}}` pattern used by `19` (same date-rot bug, same fix). `42`'s session date is now `{{TODAY}}` instead of a hardcoded date, so it actually exercises session_id matching against a real same-day planned session again.

**The 4th failure (`incremental-injury-disclosure` [turn 3/3]) was investigated, not fixed - see its own section below.**

### New findings surfaced while confirming the fixes (full-suite reruns, `--fresh`)

Re-running the full suite after the fixture fixes surfaced two things worth flagging, neither a fixture bug:

**`week-plan-kickoff-ritual` intermittently fails for a real reason, separate from the field-name issue already fixed.** One full-suite rerun (log `eval-coach-chat-log-13-59-02.json`) had the model describe a complete 7-day week in prose (`reply` text, bulleted days) but never call `week_update` at all - `coach_note`/`reply` present, no structured action, silently nothing gets saved. Two isolated reruns of just this transcript afterward both passed clean. Rough sample: 3/4 pass, 1/4 this specific prose-only skip. **This is the same class of gap as "gap 2" in the technical proposal #999 already hardened** (model describes the thing instead of calling the action) - #999 built a prompt-reinforcement fix (2b) for `workout_create` specifically, but never extended it to the `week_update` kickoff path. Not fixed here - flagging for a decision, not building it unasked.

**`fsp-quest-create-after-profile-complete` [turn 2/2] intermittently fails on a missing `season_start`/`season_start.new_habits`.** Reproduced once more on a targeted rerun (1/2 on `--only fsp-quest-create`). This is First Session quest/season creation - unrelated to workouts or current week, outside #999's and this stack's scope. Flagging for awareness only, not investigating further here.

Both are consistent with the eval script's own documented behavior (live model calls are inherently non-deterministic run to run, per its own header comment) - not evidence either is a new regression from anything in this PR.

### incremental-injury-disclosure [turn 3/3] - investigated, not fixed

**What the transcript checks:** a 3-turn conversation where the athlete discloses hip soreness in turn 2 (correctly fires `injury_flag`), then sends a pure filler "heading out now" message in turn 3, which should fire neither `coach_note` nor `injury_flag` again. This transcript exists specifically because this exact regression (a filler turn re-firing `injury_flag` for an already-flagged injury, reworded) was found live once before and got two real fixes: a prompt restraint instruction, and a deterministic word-overlap dedup guard (`injuryTextsLikelySame`, `applyInjuryFlag` in `coachIntents.ts`).

**What actually happened in this run:** turn 3 re-fired `injury_flag` with reworded text ("Left hip soreness ongoing for 3 days, noticed during runs." vs turn 2's "Left hip soreness for the past 3 days, noticeable during the back half of runs.") - `coach_note` correctly stayed absent, only `injury_flag` regressed.

**Why this probably isn't a reachable production bug, verified, not assumed:** `eval-coach-chat.ts` calls `askGemini()` directly (see its own header comment: "SOUL is NOT in the prompt this script sends... askGemini's own logic only") and never runs `buildTurnWrites`/`applyInjuryFlag` - it can only observe raw model output, never the deterministic write-layer guard built specifically to catch this. I computed `injuryTextsLikelySame`'s actual word-overlap ratio for this run's two texts by hand: 8 shared words out of the shorter text's 10 distinct words = 0.8, well above the 0.5 threshold, no laterality conflict (both say "left"). **In a real turn, `applyInjuryFlag` reads the just-committed `injuries.json` from turn 2 before writing turn 3's flag, and this pair would have been silently deduped** - the athlete would never see a duplicate.

**What this means:** the eval failure is very likely a false negative *for user impact*, but it's still a legitimate canary for the prompt-level restraint instruction alone drifting (which is the layer this eval can actually observe). Recommend keeping the strict expectation as-is rather than loosening it - the real fix, if this is worth chasing further, is either accepting the current two-layer protection (prompt + write-time dedup) as sufficient given production is protected, or extending `eval-coach-chat.ts` to optionally run the real write path for transcripts that specifically need to test it (a bigger, cross-cutting change to the eval harness's architecture, well out of scope here). Handing this off rather than deciding it myself.

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

Nothing found that blocks merging. Everything checked this round either passed clean, got fixed, or turned out to be a pre-existing, out-of-scope gap:

- Paid eval: 3 of the original 4 failures were stale fixtures, now fixed and confirmed passing individually.
- Web Workouts page: manually clicked through, works end to end, zero console errors.
- iOS Workouts tab: real unit tests ran on a real simulator in CI and passed; visual check isn't possible from this machine.

**Not blocking, but worth a decision (not built here, flagged for the athlete):**
1. `week-plan-kickoff-ritual` intermittently (~1/4 in today's sample) has the model describe the whole week in prose without calling `week_update` at all - same class of gap as `workout_create`'s "describes it, doesn't call the action," which #999 already hardened with a prompt-reinforcement fix (2b) for `workout_create` specifically but not for the week kickoff path. A parallel fix here would be small (same pattern as 2b) if wanted.
2. `incremental-injury-disclosure` [turn 3/3] - investigated in depth above. Very likely not a reachable production bug (the real write-time dedup guard would catch it, verified by hand-computing the actual word-overlap ratio), but the eval structurally can't see that guard since it never runs the write path. Recommend keeping the strict check as a canary on the prompt-level layer, and treating "should the eval exercise the real write path" as a separate, bigger question.
3. `fsp-quest-create-after-profile-complete` - unrelated to workouts/current week, intermittent `season_start` omission, out of scope for this stack.

**Scoped, not yet built - next PR on top of `#999`:** live-test `activity_sync` turns against the #727 stack specifically. `run-manual-coach-chat-test.ts --activity-ids` and `run-manual-coach-message-test.ts` both already exist (added 2026-09-10) - no new harness needed. `coach-message.ts` doesn't touch `workout_create`/`week_update` at all (confirmed by reading it), so it's out of scope. `activity_sync` **does** run through the same `requestCoachReply`/`buildTurnWrites` pipeline as ordinary turns, and is arguably a more likely place to trip the duplicate-session guard than a chat turn (a synced activity reads as a report, not a conversation) - that's the concrete next test to run.
