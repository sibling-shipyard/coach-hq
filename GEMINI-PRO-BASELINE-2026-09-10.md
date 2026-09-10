# Direct Gemini pro - full baseline, 2026-09-10

One-day-only pass (billing credits topped up for this day specifically) against real
`gemini-pro-latest`, production's real current default. Goal: establish one definitive "does
everything actually work on pro" reference point to work backwards from, before comparing cheaper
models. See `OPENROUTER-K1-RETEST-FINDINGS.md` for the broader OpenRouter/flash/DeepSeek
investigation this continues, and `OPENROUTER-K1-TEST-RESULTS.md` for the same structured format
this doc follows, applied there to the original OpenRouter/flash pass.

Every scenario below is a real conversation via `npm run test:coach-chat-manual` (or
`npm run eval:coach-chat` for Track A), against a real repo, on a real scratch branch (never
pushed as a PR, never touching the repo's real `main`), verified via a real `git diff`/`gh api`
content compare, not the harness's own PASS/FAIL guess. **Turns** records how many real messages
each scenario's conversation had - most of today's pass is single-message, a real gap flagged in
"Multi-turn coverage" below.

## Headline

**Pro is not failure-free.** It has its own real, repeatable, athlete-facing reliability gaps -
different failure shapes than flash's silent omission or DeepSeek's wild hallucination, but real.
The flagship dense-message scenario, the single piece of evidence this whole investigation has
leaned on to justify staying on pro, came back **5/8 (37.5% fail)** today, not 12/12. Every pro
failure across this whole sweep shares one shape: **a false-success claim or a confabulated excuse
that the `unrecorded_facts` self-audit does not catch.** Pro fails less often than flash or DeepSeek,
but when it fails, it fails the same misleading way they do.

| Scope | Result |
|---|---|
| Findings A/B/E re-verification | A: PASS 2/2. B: PASS 1/1. **E: FAIL 0/3** |
| Track A - 23-transcript fixture eval suite | 22/23 |
| Track B - coach-shreyas | 5/5, but a new hallucination found |
| Track B - coach-skanda | 4/4 |
| Track B - coach-date2022 | 4/4, clean |
| Track B - coach-akash | 5/5, one already-known bug reproduces |
| Track B - coach-prateek | 2/2, clean |
| Track B - coach-skanda-testing FSP flagship scenario | **5/8 (37.5% fail)** |

---

## Multi-turn coverage

Most of today's pass is deliberately single-message (fastest way to sample many scenarios in a
one-day pro-only budget), but real multi-turn conversations were run too, not zero:

| Scenario | Turns | Repo |
|---|---|---|
| Several Track A fixture transcripts (`incremental-injury-disclosure`, `fsp-quest-create-after-profile-complete`, others) | 2-3, built into the fixture format | fixture-only, no real repo |
| `new_habits` P0 guard proof | 5, one continuous conversation | coach-date2022 |
| `incremental-injury-disclosure` | 3 | coach-akash |
| `week-plan-kickoff-ritual` | 2 | coach-prateek |
| `fsp-quest-create-after-profile-complete` | 2 | coach-skanda-testing |

**Everything else in Track B below is a single message** - real, but not testing conversational
continuity (memory across turns, a fact stated earlier still holding on turn 3, etc.). That's a
real, honest gap in today's pass, not something to read into the tables below as covered.

---

## Findings A/B/E re-verification

Billing credits were restored today after running out mid-investigation. This was the first thing
tested once the key was live again.

| # | Scenario | Repo / Branch | Turns | Expected | Actual | Verdict |
|---|---|---|---|---|---|---|
| 1 | Finding A - `plan_edit` (swap a session) | coach-prateek / `test/pro-retest2-finding-a-swap` | 1 | `plan_edit` fires, real diff | `sess_20260910_1` changed to Badminton - `discipline`/`kind`/`title` all correct, `status` stayed `planned` | PASS |
| 2 | Finding A - `session_reconcile` (actual differs) | coach-prateek / `test/pro-retest2-finding-a-reconcile` | 1 | `session_reconcile` fires, real diff | `sess_20260908_1` changed `status: planned -> done`, `discipline`/`kind`/`title` updated to match | PASS |
| 3 | Finding B - `template_edit`, exact real id/phase | coach-akash / `test/pro-retest2-finding-b` | 1 | `template_edit` fires and commits | Phase block removed, exercises renumbered, `coaching_note` updated, fresh `_meta` added | PASS |
| 4-6 | Finding E - `quest_event` (mark `6am_wakeup` complete), 3 attempts | coach-skanda / `test/pro-retest2-finding-e-1/2/3` | 1 each | `quest_event` fires | `coach_note` fired every time, `quest_event` never did - `quests.json`/`progress.json` byte-identical to `main` all 3 times. The `unrecorded_facts` self-audit correctly caught the miss and reprompted every time, but the model **confabulated a false "quest_event isn't in the schema" excuse** instead of complying, all 3 times - confirmed false against the real schema source | **FAIL 0/3** |

---

## Track A - full 23-transcript fixture eval suite - 22/23

`npm run eval:coach-chat -- --fresh`, no `LLM_PROVIDER` set. Log:
`tests/2026-09-10/eval/eval-coach-chat-log-08-25-57.json`. 22/23 passed, 0 infra errors (the
OpenRouter pass had 2). 1 genuine rubric failure:

| # | Transcript | Turns | Expected | Actual | Verdict |
|---|---|---|---|---|---|
| - | `incremental-injury-disclosure [turn 3/3]` | 3 (turn 3 is pure filler, no new info) | No `coach_note`/`injury_flag` on the filler turn - nothing new was said | Pro re-emitted both anyway, restating the already-flagged hip injury | **FAIL - restraint miss** |
| - | All other 22 transcripts | mixed | Per-transcript rubric | Matched | PASS |

**On the failure:** distinct from the `injury_flag` word-overlap dedup fix (that stops a duplicate
*record* from being minted - confirmed separately it does its job here too, no real
`injuries.json` duplicate would land). This is the model *narrating* an already-known fact again in
`coach_note`/`injury_flag` text on a turn that should stay quiet - no athlete-facing or
data-integrity harm, since the dedup neutralizes it before it reaches the file. Not yet
root-caused further or fixed; deprioritized after verifying real impact is zero.

---

## Track B - real athlete repos, full recreation

Each repo run by a separate agent in parallel, same day, same key. Scratch branches were deleted
after each agent verified its own results - branch names below are the historical record of what
ran, not live references.

### coach-shreyas - 5/5, but a new hallucination found

| # | Scenario | Branch | Turns | Expected | Actual | Verdict |
|---|---|---|---|---|---|---|
| 1 | `memory-update-learned-pattern` | `test/pro-fullsuite-shreyas-1` | 1 | `memory_update` merges onto existing note | Merged correctly, diff confirmed | PASS |
| 2 | `sports-update-new-sport` | `test/pro-fullsuite-shreyas-2` | 1 | Full list with new sport added | `[CrossFit, Badminton, Pickleball, Running, Hiking, Rock Climbing]`, existing preserved | PASS |
| 3 | `returning-coaching-style-explicit-change` | `test/pro-fullsuite-shreyas-3` | 1 | Closest enum match | `"accountability"` - same as original run | PASS |
| 4 | `greeting` | `test/pro-fullsuite-shreyas-4` | 1 | No commit | Empty diff confirmed via compare API | PASS |
| 5-7 | Finding-4 restraint check, 3 trials | `test/pro-fullsuite-shreyas-5/6/7` | 1 each | No `season_start`/`week_plan`/`template_edit` | None fired across all 3 | PASS 3/3 |

**New finding, not in the original OpenRouter/flash pass for this repo:** in 2 of the 3 restraint
trials, the reply falsely claimed the coach didn't have the athlete's exact date of birth ("I have
your age but not your actual date of birth") and asked for it again - but `profile.json` on `main`
already has `"dob": "1995-09-07"`. A false-missing-data claim, same family as Finding E's
confabulation. n=1 repo, not enough to call provider-general, but a clear real occurrence -
**reconsidered and not worth fixing**: age is sufficient for daily coaching, the real issue is the
model unnecessarily asking for exact DOB, not a data gap - not chased further.

### coach-skanda - 4/4

| # | Scenario | Branch | Turns | Expected | Actual | Verdict |
|---|---|---|---|---|---|---|
| 1 | `ordinary` | `test/pro-fullsuite-skanda-1` | 1 | No structured fields beyond optional `coach_note` | `coach_note` + `reply` only, real context referenced | PASS |
| 2 | `profile-update` | `test/pro-fullsuite-skanda-2` | 1 | `profile_update` fires | `weight_kg: 70 -> 68`, diff confirmed | PASS |
| 3 | `coach-note-absent-filler` | `test/pro-fullsuite-skanda-4` | 1 | No action fields at all | Only `chat_history.json` touched, zero action fields | PASS |
| 4 | #27 regression proof (fake template + real co-occurring fact) | `test/pro-fullsuite-skanda-5` | 1 | Fake template edit refused/dropped, real fact still commits | `weight_kg` change landed cleanly; `template_edit` never attempted - pro flatly declined the fake template (correct behavior, not a bug) | PASS |

Also unrelated to any scenario's primary check: on the filler turn, pro launched into an
unprompted, verbose "I am Coach Phelps... Michael... dealing with depression" origin-story
monologue - a tone/verbosity oddity, not a data-integrity issue, not investigated further.

### coach-date2022 - 4/4, clean

| # | Scenario | Turns | Expected | Actual | Verdict |
|---|---|---|---|---|---|
| 1 | `returning-season-change-with-goal` | 1 | New season active, old one retired | "Half Marathon Prep" active, `chin-over-the-bar` retired, goal text preserved | PASS |
| 2 | `returning-season-and-habit-same-turn` (#808 shape) | 1 | `season_start.new_habits` populated, one write | Real habit landed, no separate `quest_create` | PASS |
| 3 | `returning-standalone-habit-no-season-change` | 1 | `quest_create` fires, `seasons.json` untouched | Fired correctly, `seasons.json` byte-identical before/after | PASS |
| 4 | `new_habits` P0 guard proof | **5, one continuous conversation** | No crash regardless of what the model does | Final state: 1 active season + 5 retired, clean chain, no crash. Same caveat as original: pro never actually omitted `new_habits` across 5 tries, so the true pre-fix omission path still wasn't hit live | PASS (inconclusive on the omission case specifically) |

No hallucination observed anywhere in this run, checked specifically given this exact
repo/quest family previously showed a severe DeepSeek hallucination and Finding E's confabulation
was found on a sibling repo.

### coach-akash - 5/5, one already-known bug reproduces

| # | Scenario | Turns | Expected | Actual | Verdict |
|---|---|---|---|---|---|
| 1 | `quest-event-array` | 1 | Both completions land as separate entries | Both `pr_visualization_2026-09-10` and `pr_reading_2026-09-10` added | PASS |
| 2 | `injury-event-array` | 1 | Real update + second fact both handled | Both fired this time - a resolve AND a new real flag - stronger result than the original weaker test | PASS |
| 3 | `incremental-injury-disclosure` | **3** | Vague -> no fire, specific -> `injury_flag`, filler -> no `coach_note` | All 3 correct | PASS |
| 4 | `injury-event-real-id-among-several` | 1 | Correct id picked among siblings | `inj_right_hip_glute` resolved, `inj_left_glute` untouched (only 1 active flag exists, same real-data limitation as before) | PASS (weaker than intended) |
| 5 | #27 regression proof (bad `session_id`) | 1 | Only the bad action drops, real fact still commits | `session_reconcile` on a hallucinated-style id dropped safely, `current_week.json` diff empty, real injury resolve landed, `coach_log.json` got the system note. **Reply again falsely claimed success** ("I got the Monday session logged as squats") - repeats the same bug already flagged on the original OpenRouter pass for this exact repo/scenario, confirms it's provider-agnostic | PASS on the regression itself; the false-success reply bug reproduces, not new |

Side note, out of scope for this pass, since fixed separately (PR #953): resolving an injury flag
used to drop `injuries.json`'s `_meta`/`version` block and overwrite the flag's chronic history
with a one-line summary - found here, fixed and live-verified in the same-day follow-up work.

### coach-prateek - 2/2, clean

| # | Scenario | Turns | Expected | Actual | Verdict |
|---|---|---|---|---|---|
| 1 | `week-plan-kickoff-ritual` | **2** | `week_plan` fires after onboarding | Fired on turn 2, real diff: `data_status: placeholder -> live`, 7 real days, template ids matched the real manifest exactly - **no hallucinated ids this time**, an improvement over the original OpenRouter run (which had ids safely caught, not avoided). One earlier attempt hit a transient validation error unrelated to hallucination; retry succeeded cleanly | PASS |
| 2 | `template_edit`, exact real precondition | 1 | Fires cleanly against a real id/phase | Diff confirmed. Two earlier attempts correctly declined/asked for clarification (a stale test-data id, an active-injury conflict) rather than falsely claiming success - good behavior, not bugs | PASS |

### coach-skanda-testing FSP - the flagship scenario - 5/8 (37.5% fail)

**This is the single most important result of the day.** This scenario (a fresh athlete's first
message containing a goal + 2 injuries + 2 habits, all at once) is the one piece of evidence this
whole investigation has leaned on to justify staying on pro - previously measured 12/12 clean at a
smaller sample. Re-run today with 8 fresh, independently-reset trials, each 1 turn:

| Trial | Result | Detail |
|---|---|---|
| 01 | **FAIL** | Reply: "I noted the right hamstring strain and the left ankle tweak too... we are going to respect those" - `injuries.json` came back byte-identical `{"flags": []}` |
| 02 | PASS | Goal, both injuries, both habits all landed, verified via diff |
| 03 | **FAIL** | Reply: "I've flagged both of them so we can track them" - `injuries.json` empty |
| 04 | PASS | Clean |
| 05 | PASS | Clean |
| 06 | PASS | Clean |
| 07 | **FAIL** | Reply: "we'll let those heal while we build the engine," also fabricated an unstated detail ("getting after it 2-3 times a week") - `injuries.json` empty |
| 08 | PASS | Clean |

Goal, habits, and profile fields landed correctly in every one of the 8 runs, including all 3
failures - **only injuries were affected, every time.** `unrecorded_facts` (the reprompt safety net
built specifically to catch this exact failure shape) **missed all 3 failures** - it only ever
flagged an unrelated DOB-vs-age mismatch, never the dropped injuries, so no reprompt ever fired to
correct them. Same self-audit blind spot already documented for flash and OpenRouter (3 confirmed
false negatives across 32+ trials there); now confirmed live on direct pro too, at a rate (3/8,
37.5%) in the same order of magnitude as flash's own failure rate on other scenarios.

Other FSP scenarios, 1 pass each, all diff-verified:

| # | Scenario | Turns | Verdict |
|---|---|---|---|
| - | `fsp-quest-create` (goal + habit same message) | 1 | PASS |
| - | `fsp-new-injuries` (matching precondition) | 1 | PASS |
| - | `fsp-coaching-style` | 1 | PASS |
| - | `fsp-quest-create-after-profile-complete` | **2** | PASS |
| - | Template generation at onboarding | 1 | Inconclusive - transcript never reached `profileComplete: true`, unrelated to model reliability |

**A same-day fix for this exact failure was built and live-verified afterward (PR #953):**
`findMissedInjuryLanguage`, a deterministic keyword safety net scoped to first-session turns with
zero existing injury flags, catching what `unrecorded_facts` missed. 3/3 on a fresh live sample (1
real catch, 2 clean passes with no false-positive interference) - see PR #953 for detail.

---

## What this changes

The "stay on `gemini-pro-latest`" decision in `OPENROUTER-K1-RETEST-FINDINGS.md` was made on the
strength of one number: 12/12 clean on the flagship dense-message scenario. That number does not
hold at a larger sample today - it's 5/8, the same order of failure rate flash/DeepSeek show on
their own worst scenarios, just with a different symptom (false-success claim instead of silent
omission or wild hallucination). Combined with Finding E's confabulation and the smaller findings
above (the DOB hallucination, the filler-turn restraint miss), the honest picture is: **every model
tested in this whole investigation, including pro, has a real, repeatable, self-audit-invisible
reliability gap.** A same-day fix closed the specific 3/8 injury-drop failure (PR #953); Finding
E's confabulation was investigated live but no working fix was found (see
`OPENROUTER-K1-RETEST-FINDINGS.md`'s "Still open" section for the full detail).

The question for the next phase is no longer "does pro work and nothing else does" - it's which
failure rate and which failure shape is acceptable, at what cost, and whether the
single-call-schema restructuring idea (see `OPENROUTER-K1-RETEST-FINDINGS.md`'s "Idea not yet
tried" section) can close the gap on a cheaper model rather than assuming only pro's capability
tier can ever get this right.
