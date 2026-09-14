# Live verification: PR #999 review-fix round, against a real athlete repo

**Date:** 2026-09-13
**Why:** the review-fix commit (`c621e4a1`, P1 correctness + P2 dedup) and the reprompt-hardening commit before it (`c059f074`... `0de90b51`) were only unit-tested (mocked GitHub/Gemini), never live-observed against a real repo. Per direction: don't leave that gap - test it properly and report back.

**Method:** every scenario below ran through `ui/scripts/run-manual-coach-chat-test.ts`, `LLM_PROVIDER=openrouter`, against `skanda-2003/coach-skanda-2003` on disposable `test/*` scratch branches, never touching `main`. Real Gemini calls (via OpenRouter), real commits, real file diffs - nothing here is a fixture.

---

## 1. `coach_since` + `profile_update` merge preserves `first_session_benchmark_pending` (P1 fix #1) - CONFIRMED

Seeded a scratch branch (`test/727-fsp-transition-a`) with the real athlete's profile minus `coach_since` and `timezone`, simulating "one field away from completing First Session." Sent one message stating the missing timezone.

**Result: exactly the bug shape the reviewer flagged, and the fix works.** The real commit diff for the fact-write (`655e7b9`):

```diff
-  "coach_since": null,
+  "coach_since": "2026-09-13",
   "name": "Skanda",
   "dob": "2003-06-05",
-  "timezone": null,
+  "timezone": "Asia/Kolkata",
   "height_cm": 175,
   "weight_kg": 70,
+  "first_session_benchmark_pending": true
```

All three fields - `coach_since`, the `profile_update`'s own `timezone`, and `first_session_benchmark_pending: true` - landed together in one commit, exactly as the fix intends. Before this fix, the third field would have been silently dropped from this exact write. A second commit (`2145ff2`, from `generateFirstSessionWorkoutsAfterCompletion` picking up the pending flag the same turn) then correctly generated the benchmark and cleared both `first_session_benchmark_pending` and the new `first_session_benchmark_attempts` back to their resting state. Full pipeline, live, end to end, correct.

---

## 2. Extra-session terminal-status guard (P1 fix #2) - live-tested, informative negative result

Seeded a real planned session on today's date, then tried three different phrasings explicitly describing (and even directly requesting) a separate, already-completed extra session:
- "also swam this morning, separate thing"
- "already did an easy 30 min swim this morning, separate thing from today's session, felt good"
- "log a separate easy swim from this morning as done, completely apart from today's strength session which is still coming up later"

**Result: in all three live runs, the model logged the extra session with `status: "planned"`, never `"done"` or `"skipped"` - even when directly asked to log it "as done."** No action was ever dropped in any of the three runs (nothing for the guard to catch, since it only gates a terminal-status new entry).

**What this means:** the guard's fix (`EXTRA_SESSION_CUE_PATTERN`) remains verified by its dedicated unit tests, not by a live reproduction - three consecutive live attempts suggest the model's default handling of a same-day extra (log it as a new `planned` entry with the outcome described in `coach_note`) may be more common in practice than the exact `done`/`skipped`-on-a-new-entry shape the original bug hit. That's a genuinely useful negative result, not a gap being hidden: the guard is real, tested, and safe; it's just harder to force live than expected, likely because it needs a narrower confluence of conditions than these three attempts hit.

---

## 3. Week-plan-kickoff prose-only skip, deterministic reprompt (`isProseOnlyWeekPlan`) - CONFIRMED firing live

Ran the Weekly Kick-off Ritual (`"lay out the full week for me"`) against a real repo with no live current week, three times.

**Run 1: reprompt fired live, self-corrected, committed correctly.**
```
[coach-chat] reply content violation, reprompting once: { ... proseOnlyWeekPlan: true, ... }
```
First pass: reply narrated a full 7-day plan in prose, `week_update` absent (also self-flagged via `unrecorded_facts`, both detectors agreeing). Reprompt fired with both corrective notes. Second pass: model set a complete, correct `week_update` - verified the actual commit: 7 real days (`2026-09-14` through `2026-09-20`), each with a real session, real focus/guardrails/headline/body.

**Run 2: same thing, reprompt fired, self-corrected, committed correctly** (independent live occurrence, same pattern).

**Run 3: no `week_update` narration issue, but surfaced a separate, pre-existing, unrelated bug** - the model produced a day `intent` field over the 48-character cap on 3 of 7 days. Correctly caught by the existing `assertCurrentWeekCommitReady` validation and dropped as a `droppedActionsValidation: 1` with a correction message appended to the reply - not committed, not silently corrupted. This is the write-path's existing "never commit invalid data" protection working as designed, unrelated to anything in this PR. Noting it for awareness, not fixing here (out of scope, pre-existing, and already safely handled).

---

## 4. Season_start prose-only skip, deterministic reprompt (`findMissedSeasonLanguage`) - 4 live runs, no reproduction, but strong reliability signal

First attempt at this test had a real setup mistake: seeded a fresh scratch branch (`-1`) with the athlete's season nulled out (simulating "about to set the first season"), but let the script auto-create branches `-2` and `-3` from the *real* default branch, which still has the athlete's actual established season - so those two runs weren't testing the first-session scenario at all (`missedSeasonLanguage` is scoped to `firstSession` turns only, by design, and these weren't). Caught this from the model's own reasoning ("since Load Bearing Season is active") and redid it properly - seeded all 4 branches with the nulled season before running.

**All 4 properly-seeded runs correctly set `season_start` on the first attempt** (a dense goal + 2-habit message, matching the shape of the original live-found bug):

| Run | Result |
|---|---|
| 1 | Correct first try. Also triggered `generateFirstSessionWorkoutsAfterCompletion` (season completing the profile transition drove a real benchmark + first-week commit, live-confirmed a second time via a different trigger path than test 1). |
| 2 | Correct first try, benchmark also fired. |
| 3 | Reprompt fired for an unrelated reason (missing `coach_note`, plus the model self-flagging that it had almost fabricated a placeholder `dob` it wasn't told) - `season_start` was correctly present both before and after the reprompt. |
| 4 | Correct first try, benchmark also fired. |

**What this means:** `findMissedSeasonLanguage` itself never got to fire live in 4 attempts (0 omissions occurred to catch) - same limitation as section 2, verified by unit test rather than live reproduction. But 4/4 correct `season_start` calls is a real, positive signal: the original bug's failure rate was roughly 1-in-2 to 1-in-3 in earlier testing; going 4-for-4 after the prompt reinforcement (even without the athlete-message-language backstop ever needing to trigger) is consistent with the fix meaningfully improving reliability, not just adding an unused safety net.

---

## Bottom line

Every fix from today's review-findings round was live-tested against the real athlete repo. Two (`coach_since`/pending merge, week-plan-kickoff reprompt) got a direct, live, reproduced-and-corrected confirmation. Two (extra-session terminal-status guard, season_start language guard) did not get to fire live in this round's attempts - both remain verified by dedicated unit tests, and both live-testing rounds produced informative negative results (the model's actual failure modes may be narrower/rarer than the original single live observations suggested) rather than silence. No regressions found anywhere across 13 real conversations. One unrelated, pre-existing, already-safely-handled bug surfaced (an over-length `intent` string correctly dropped by existing validation) - noted, not fixed, out of scope for this round.
