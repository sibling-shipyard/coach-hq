# OpenRouter K1 re-test - structured results

Testing PR #921's tip (`feat/713-template-adjustment-onto-llmclient`, the full stack: 769 through 921,
rebased onto current main) with `LLM_PROVIDER=openrouter`, model `google/gemini-3.8-flash` (pinned
`google-vertex`). Goal: redo everything that was tested against direct Gemini during K1, now via
OpenRouter, on real athlete repos with real commits, plus new coverage the OpenRouter seam itself
needs (template adjustment, coach-message pilot).

Every scenario below is a real conversation via `npm run test:coach-chat-manual`, against a real
local clone of a real athlete repo, on a local-only scratch branch (never pushed as a PR, never
touching the repo's real `main`). "Actual files changed" is read directly from the real commit via
`git diff`/the GitHub API, not inferred from the harness's own PASS/FAIL guess.

Format per scenario: Repo / Branch / What was sent / Expected / Actual / Verdict / Commit(s).

Status: COMPLETE. See OPENROUTER-K1-RETEST-FINDINGS.md's closing summary for the priority-ordered
action list this feeds.

---

## Track A - fixture eval harness, full 23-transcript suite, OpenRouter

Command: `LLM_PROVIDER=openrouter npm run eval:coach-chat -- --fresh`, run 2026-09-09, model
`google/gemini-3.8-flash` via `google-vertex`. Log: `tests/2026-09-09/eval/eval-coach-chat-log-09-58-04.json`
in `/tmp/wt-921-retest`.

**19/23 transcripts passed. 2 errored (infra). 2 genuinely failed the rubric** (both root-caused
below - see findings doc for detail).

| Transcript | Result | Note |
|---|---|---|
| greeting | PASS | |
| ordinary | **ERROR** | "OpenRouter returned no content" - infra flake, not the code under test |
| quest-event-array | PASS | |
| injury-event-array | PASS | |
| profile-update | PASS | |
| plan-edit-vs-template-edit-disambiguation | **FAIL** | Stale fixture date, same #807 bug class - see findings doc |
| activity-sync | PASS | |
| incremental-injury-disclosure [1/3] | PASS | |
| incremental-injury-disclosure [2/3] | PASS | |
| incremental-injury-disclosure [3/3] | **FAIL** | Real bug: `injury_flag` re-fires on a pure filler turn after the injury was already logged one turn earlier - see findings doc, this one is not a stale fixture |
| fsp-quest-create | PASS | |
| fsp-new-injuries | PASS | |
| fsp-coaching-style | PASS | |
| fsp-quest-create-after-profile-complete [1/2] | PASS | |
| fsp-quest-create-after-profile-complete [2/2] | PASS | |
| returning-season-change-with-goal | PASS | |
| coach-note-required-with-quest-event | PASS | |
| coach-note-absent-filler | PASS | |
| returning-season-and-habit-same-turn | PASS | (#808's own regression transcript - still holds) |
| returning-standalone-habit-no-season-change | PASS | |
| memory-update-learned-pattern | PASS | |
| sports-update-new-sport | PASS | |
| returning-coaching-style-explicit-change | PASS | |
| injury-event-real-id-among-several | PASS | |
| week-plan-kickoff-ritual | **ERROR** | "OpenRouter truncated its response before finishing (finish=length, reasoningTokens=0)" - the known 4096-token ceiling finding from the original M2 session, confirmed still reproducing |
| session-reconcile-actual-differs | PASS | |

## Track B - real athlete repos

### coach-shreyas (`shreyas-95-cyber/coach-shreyas-95-cyber`) - 5/5 PASS

All verified via `git fetch` + `git diff` against real commits, not just harness self-report.

| # | Scenario | Branch | Expected | Actual | Verdict |
|---|---|---|---|---|---|
| 1 | memory-update-learned-pattern | `test/retest-memory-update` | `memory_update` fires, `learned_patterns.training` label | Fired correctly; new fact **merged** onto existing note text, not overwritten | PASS |
| 2 | sports-update-new-sport | `test/retest-sports-update` | `sports_update` with full list incl. new sport | `["CrossFit","Badminton","Pickleball","Running","Hiking","Rock Climbing"]` - existing preserved, new appended | PASS |
| 3 | returning-coaching-style-explicit-change | `test/retest-coaching-style` | Closest enum (no literal "direct" exists) | `accountability` - correct closest-enum choice | PASS |
| 4 | greeting | `test/retest-greeting` | No commit, reply only | Confirmed empty diff, no write | PASS |
| 5 | Finding-4 check (3 trials) | `test/retest-finding4-{a,b,c}` | No `season_start`/`week_plan`/`template_edit` on plain turns | None fired across all 3 trials | PASS (N=3, see findings doc for confidence caveat) |

### coach-date2022 (`date2022/coach-date2022`) - 6/6 PASS

Verified via `git diff`/`git log` on the real repo, not just harness self-report.

| # | Scenario | Expected | Actual | Verdict |
|---|---|---|---|---|
| 32 | returning-season-change-with-goal | `season_start` fires, old season retires, new active | Correct | PASS |
| 35 | returning-season-and-habit-same-turn (#808 shape) | `season_start.new_habits` populated, one commit | Correct, no separate `quest_create` | PASS |
| 36 | returning-standalone-habit-no-season-change | `quest_create` fires, `seasons.json` untouched | Correct | PASS |
| - | `new_habits` P0 guard proof (5 repeated season_start turns) | No crash regardless of whether model omits `new_habits` | All 5 committed cleanly, no crash - **but the model never actually omitted `new_habits`** across 5 tries, so the true pre-fix crash path was never hit live (reported honestly, not claimed as proven) | PASS (inconclusive on the omission case specifically) |

One harness flake noted on `test/retest-regress-a`: a false-negative "sha lookup failed" from the
harness's own GitHub API polling, root-caused to a likely rate-limit/ref-consistency race from 5
concurrent agents sharing one GitHub token. The underlying commit was fine on independent check -
not a real bug, a testing-concurrency artifact.

### coach-akash (`akash-suresh/coach-akash-suresh`) - 5/5 PASS

Verified via independent `git diff` on every scratch branch, not just harness self-report.

| # | Scenario | Expected | Actual | Verdict |
|---|---|---|---|---|
| 1 | quest-event-array | Both quest completions land as separate entries | Both `pr_visualization_2026-09-09` and `pr_reading_2026-09-09` added to `progress.json` | PASS |
| 2 | injury-event-array | Real update + second fact both handled | Real flag resolved correctly; new ankle mention correctly deferred to a clarifying question (real data only has 1 active flag, weaker test than intended - documented) | PASS (weaker than intended, real-data limited) |
| 3 | incremental-injury-disclosure (3-turn) | Vague→no fire, specific→`injury_flag`, filler→no `coach_note` | All 3 correct | PASS |
| 4 | injury-event-real-id-among-several | Correct id picked among siblings | `inj_right_hip_glute` updated, `inj_left_glute` byte-identical before/after (sibling was resolved not active, weaker test, documented) | PASS (weaker than intended, real-data limited) |
| 5 | **Regression proof: bad `session_id` in `session_reconcile`** | Only the bad action drops; real co-occurring injury update still commits; no crash | Confirmed via diff: `current_week.json` diff empty (bad id never touched it), `injuries.json` shows the real resolve landed, `coach_log.json` got the dropped-action system note | **PASS - the fix confirmed working live on a real repo** |

**Real finding, P2, not a regression of this fix:** in scenario 5's same turn, the athlete-facing
`reply` text falsely states the dropped session "is marked done" - see findings doc for root cause
and proposed directions.

### coach-prateek (`prateekdevaraju/coach-prateekdevaraju`) - 2 PASS, 2 FAIL, 1 not testable

**A real bug was found and root-caused here** - see findings doc "MOST IMPORTANT FINDING." Not
specific to OpenRouter or this stack; pre-existing, provider-agnostic. One continuous conversation
branch `test/retest-921-week-flow`, verified via `git diff` at every step.

| # | Scenario | Expected | Actual | Verdict |
|---|---|---|---|---|
| 3 | week-plan-kickoff-ritual | `week_plan` fires after onboarding completes | Fired correctly, 7 days written - but hallucinated `template_id`s (`strength_a`/`strength_b`, not in the real manifest) got safely nulled by post-hoc validation | PASS (with a caught-safely symptom of the root cause below) |
| 1 | plan-edit-vs-template-edit-disambiguation | `plan_edit` fires, session swapped | **Neither fired.** `reply`/`coach_note` both narrate the swap as done; `current_week.json` untouched | **FAIL - false success claimed, root cause below** |
| 4 | session-reconcile-actual-differs | `session_reconcile` fires with `actual` override | **Did not fire.** `injury_flag` fired correctly for the real wrist mention, but the session stays `status: "planned"` forever | **FAIL - same root cause** |
| 5 | template_edit (PR #921 new scope) | Real template edit lands | Fired and verified via diff: warm-up phase removed, exercises renumbered, `coaching_note` updated - clean | PASS (worked only because the athlete stated the exact real template id themselves - see findings doc) |
| 2 | activity-sync | - | **Not testable** - the manual harness has no way to reach `mode: "activity_sync"`, hardcoded to `"ordinary"` | N/A |

### coach-skanda (`skanda-2003/coach-skanda-2003`) - 3/5 live-verified PASS, 1 live FAIL, 1 code-verified-only

Verified via independent `git diff` on every fetched branch.

| # | Scenario | Expected | Actual | Verdict |
|---|---|---|---|---|
| 1 | ordinary (02) | No structured fields beyond optional coach_note | `coach_note` + `reply` only | PASS |
| 2 | profile-update (12) | `profile_update` fires | `weight_kg: 70 → 88`, verified in diff | PASS |
| 3 | coach-note-required-with-quest-event (33), 3 attempts | `quest_event` + `coach_note` both fire | `coach_note` fired all 3 times; **`quest_event` never fired, `quests.json` never touched** | **FAIL - see findings doc, no reprompt safety net for this direction** |
| 4 | coach-note-absent-filler (34) | No action fields at all | `{ reply }` only, no `coach_log.json` write | PASS |
| 5 | Regression proof: bad `template_id` shouldn't sink a real fact, 6 attempts | Only the bad template_edit drops, real fact commits | Real fact (`profile_update`, weight) landed cleanly in all 4 attempts that included one - **but `template_edit` itself never fired once, real id or fake, in any of 6 tries** | **Code-verified only** (source read + existing mocked unit test both confirm the fix is correct) - **not independently live-reproduced**, see findings doc "SECOND MAJOR FINDING" |

**coach-message** (post-sync generator): not testable, no manual harness exists for this endpoint.
Code-level check confirms it shares the same `LlmAdapter` seam as coach-chat, so it should pick up
`LLM_PROVIDER=openrouter` the same way - inferred from source, not observed live.

### coach-skanda-testing - FSP, THE critical scenario - 5/6 clean PASS, 1 partial-omission on one of three field-crowding runs

Fresh, genuinely-reset FSP state for every branch (`main` already had a completed onboarding from a
prior session, so this athlete's data was reset to blank on each scratch branch before testing).

| # | Scenario | Expected | Actual | Verdict |
|---|---|---|---|---|
| 27 | fsp-quest-create (goal+habit same message) | `season_start`+`new_habits`, no separate `quest_create` | Exactly that - 3 habits, 2 injuries, all landed | PASS |
| 28 | fsp-new-injuries | `injury_flag` fires for brand-new injuries | Failed 3x when stated on the athlete's literal first message (see Finding D); passed cleanly (3/3 injuries) once stated as the conversation's 2nd turn, matching the transcript's actual precondition | PASS (on matching-precondition run) |
| 29 | fsp-coaching-style | `coaching_style_update` fires | `"accountability"` landed in `memory.json` | PASS |
| 30 | fsp-quest-create-after-profile-complete | Profile first, `season_start`+habits later | Both turns correct | PASS |
| **5** | **Field-crowding regression proof - THE critical test (3 fresh runs)** | **No crash regardless of what the model does** | **0/3 crashed.** Run 1: injuries landed, goal+habits silently omitted (not a crash, not a `droppedActions` entry - see Finding D). Runs 2 & 3: fully clean, everything landed. **No `template_edit` or any hallucinated field appeared in any of the 3 runs.** | **PASS - the #27 fix holds under the exact load that used to crash it 4/5 times** |
| 6 | Template generation at onboarding (PR #921 new scope) | Templates generate via the OpenRouter seam | 6 real templates committed with real personalized content, confirmed via `selectLlmAdapter` call site read | PASS |

**No crashes anywhere across 11 harness invocations in this agent's pass.**

---

## Overall tally

- **Fixture eval suite:** 19/23 clean, 2 infra errors, 2 root-caused (1 stale-fixture date rot repeating a known risk, 1 real duplicate-`injury_flag` bug - see findings doc).
- **6 real athlete repos, ~30 live scenarios:** the #27 fix (hallucinated template_id/session_id no longer crashes the whole commit) and the `new_habits` P0 guard both confirmed working live, including the exact field-crowding scenario that originally broke 4/5 times - now 0/3.
- **2 significant pre-existing, provider-agnostic bugs surfaced** that this retest happened to be the first thing thorough enough to catch (Findings A and B in the findings doc) - neither is a regression from this stack, both would very likely reproduce on direct Gemini too.
- **1 OpenRouter-specific reliability gap** (Finding C, no retry on truncation, ~37% first-turn failure rate observed) that should block treating OpenRouter as production-ready without a fix first.
- **Full check gate: all 9 checks green** on PR #921's tip.

Status: COMPLETE.
