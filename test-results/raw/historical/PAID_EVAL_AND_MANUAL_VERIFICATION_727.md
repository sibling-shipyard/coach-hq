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

### New findings surfaced while confirming the fixes, both now fixed

Re-running the full suite after the fixture fixes surfaced two more real bugs, same class as #999's already-shipped 1a/2b/3a/3b hardening. Both fixed in this same round rather than left open, per direction: don't leave a found gap for later, fix it or bring back a concrete reason not to.

**`week-plan-kickoff-ritual` - model narrates the week, never calls `week_update`.** One full-suite rerun (log `eval-coach-chat-log-13-59-02.json`) had the model describe a complete 7-day week in prose (bulleted days) with no structured action at all - `coach_note`/`reply` present, `week_update` absent, silently nothing gets saved. Same class as "gap 2" from the original technical proposal, which #999 already hardened for `workout_create` (2b) but never extended to the kickoff path.

Fixed two ways:
1. Prompt reinforcement (same style as 2b) in the Weekly Kick-off Ritual instructions. Verified this alone is not sufficient: 2 reruns after the prompt fix still failed the same way (`eval-coach-chat-log-14-11-09.json` through `-14-12-28.json` are the rerun batch).
2. A new deterministic reprompt, `isProseOnlyWeekPlan` in `coachTurn.ts`: if the reply mentions 5+ distinct weekday names but `week_update` is absent (and it's not a first-session turn, which never gets `week_update` at all), trigger one corrective reprompt. Chose a weekday-name count specifically because it's a near-zero-false-positive signal - ordinary coaching chat doesn't name 5+ weekdays by accident, only a real day-by-day narration does. This is a different, safer shape than the reply-text heuristic already rejected for `workout_create`'s gap 2a (that one risked misfiring on ordinary conversation describing exercises; this one only fires on a very specific, rare pattern). Verified deterministically with 4 new unit tests in `coachTurn-reprompt.test.ts` (fires on the exact live-captured failure shape, stays silent when `week_update` is present, stays silent on a firstSession turn, stays silent under the 5-weekday threshold) - live eval reruns can't prove the reprompt code itself works, since `eval-coach-chat.ts` never calls `requestCoachReply` (same structural limit as the `incremental-injury-disclosure` finding below).

**`fsp-quest-create-after-profile-complete` [turn 2/2] - same bug, for `season_start`.** The athlete states a goal (`"By end of 2026 I want to be stronger overall..."`), the model's `coach_note`/`reply` narrate the season as launched and habits as logged, but `season_start` is never set - `profile_update: []` too, a fully silent skip. Reproduced on a targeted rerun (`eval-coach-chat-log-14-08-24.json`).

Fixed two ways, same pattern:
1. Prompt reinforcement in both the first-session and returning-athlete `season_start` instructions.
2. A new deterministic reprompt, `findMissedSeasonLanguage` in `coachTurn.ts` - but scoped like `findMissedInjuryLanguage`/`findMissedHabitLanguage` already in this file, not like the week-plan fix above: it checks the **athlete's own message** for goal-declaring language ("my goal", "want to be/get/run/...", "by end of"), not the model's reply phrasing, first-session only. This sidesteps the false-positive risk a reply-text keyword match would carry. First draft included looser terms (`target`/`targeting`/`training for`/`aim for`) and two *existing* unit tests caught it colliding with ordinary first-session chat ("still reaching my weekly mileage target" isn't a season-start moment) - narrowed the pattern to the phrasings specific enough they essentially only show up on a real goal declaration, confirmed via 5 new unit tests (fires on the real live-captured phrasing, stays silent on a returning-athlete turn, stays silent once `season_start` is already set, stays silent on the generic "target" phrasing that collided during development).

Both fixes: `npx tsc --noEmit` clean, full `api/coach-chat/` suite 566/566 (9 new tests, zero regressions once the two pre-existing tests that collided with the new season-language pattern were updated to use goal/habit-free messages).

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

Nothing found that blocks merging. Everything checked this round either passed clean, got fixed, or turned out to be a pre-existing, correctly-not-fixed gap:

- Paid eval: 3 of the original 4 failures were stale fixtures, now fixed and confirmed passing individually. Two more real bugs surfaced while confirming those fixes (`week-plan-kickoff-ritual`, `fsp-quest-create-after-profile-complete`), both fixed with a prompt reinforcement plus a new deterministic reprompt, both covered by new unit tests.
- Web Workouts page: manually clicked through, works end to end, zero console errors.
- iOS Workouts tab: real unit tests ran on a real simulator in CI and passed; visual check isn't possible from this machine.

**Not blocking, deliberately left as-is:**
1. `incremental-injury-disclosure` [turn 3/3] - investigated in depth above. Very likely not a reachable production bug (the real write-time dedup guard would catch it, verified by hand-computing the actual word-overlap ratio), but the eval structurally can't see that guard since it never runs the write path. Recommend keeping the strict check as a canary on the prompt-level layer, and treating "should the eval exercise the real write path" as a separate, bigger question - not something to build inside this hardening round.

**Scoped, not yet built - next PR on top of `#999`:** live-test `activity_sync` turns against the #727 stack specifically. `run-manual-coach-chat-test.ts --activity-ids` and `run-manual-coach-message-test.ts` both already exist (added 2026-09-10) - no new harness needed. `coach-message.ts` doesn't touch `workout_create`/`week_update` at all (confirmed by reading it), so it's out of scope. `activity_sync` **does** run through the same `requestCoachReply`/`buildTurnWrites` pipeline as ordinary turns, and is arguably a more likely place to trip the duplicate-session guard than a chat turn (a synced activity reads as a report, not a conversation) - that's the concrete next test to run.
