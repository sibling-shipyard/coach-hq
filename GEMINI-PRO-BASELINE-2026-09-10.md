# Direct Gemini pro - full baseline, 2026-09-10

One-day-only pass (billing credits topped up for this day specifically) against real
`gemini-pro-latest`, production's real current default. Goal: establish one definitive "does
everything actually work on pro" reference point to work backwards from, before comparing cheaper
models tomorrow. See `OPENROUTER-K1-RETEST-FINDINGS.md` for the broader OpenRouter/flash/DeepSeek
investigation this continues.

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

## Findings A/B/E re-verification (the original open item from before today's top-up)

Billing credits were restored today after running out mid-investigation. This was the first thing
tested once the key was live again.

**Finding A (`plan_edit`/`session_reconcile`) - PASS, 2/2, on `coach-prateek`.**
- `plan_edit`: swapped a real session (`sess_20260910_1`) to Badminton, diff confirmed
  `discipline`/`kind`/`title` all changed correctly, status stayed `planned`.
- `session_reconcile`: reported a differing actual for `sess_20260908_1`, diff confirmed
  `status: planned -> done`, `discipline`/`kind`/`title` updated to match what was reported.
- Reply text matched the committed diffs exactly in both cases - no false-success narration.

**Finding B (`template_edit`) - PASS, 1/1, on `coach-akash`.**
- Exact real template id (`workout_a`) and exact real phase name (`Warm-up - Wrist Prep`).
- Diff confirmed: phase block removed, exercises renumbered, `coaching_note` updated, new `_meta`
  block added.

**Finding E (`quest_event`) - FAIL, 0/3, on `coach-skanda`. The most important single result of the
day.** All 3 attempts: `coach_note` fired, `quest_event` never did. Real diffs confirm
`quests.json`/`progress.json` were byte-identical to `main` on all 3 scratch branches. The
`unrecorded_facts` self-audit correctly caught the miss and fired the reprompt every time - the
safety net itself worked. But instead of complying, the model **confabulated a false technical
excuse**, verbatim variants of "quest_event isn't in the schema" / "the system isn't letting me
log quest progress today," across all 3 runs. Confirmed false against the actual schema source
(`quest_event` is declared in `RETURNING_ACTIONS`, available on every returning-athlete turn) - not
a real gap on our side, a model confabulation.

---

## Track A - full 23-transcript fixture eval suite - 22/23

`npm run eval:coach-chat -- --fresh`, no `LLM_PROVIDER` set. 22/23 passed, 0 infra errors (the
OpenRouter pass had 2). 1 genuine rubric failure:

**`incremental-injury-disclosure [turn 3/3]` - restraint miss.** Turn 3 is a pure filler message
("Anyway, that's the update. Heading out now.") after the athlete already disclosed a sore hip on
turn 2 and the coach already flagged it. The rubric expects silence on a pure filler turn. Pro
re-emitted both `coach_note` and `injury_flag` anyway, restating the already-flagged fact. Distinct
from the `injury_flag` word-overlap dedup fix (that stops a duplicate *record*, not the model
*narrating* an already-known fact again). Not yet root-caused or fixed.

---

## Track B - real athlete repos, full recreation

All scenarios verified via real `gh api` diffs against actual commits, never the harness's own
PASS/FAIL guess. Each repo run by a separate agent in parallel, same day, same key.

### coach-shreyas - 5/5, but a new hallucination found

memory-update-learned-pattern, sports-update-new-sport, returning-coaching-style-explicit-change,
greeting, and a 3-trial Finding-4 restraint check all passed cleanly, matching the original
OpenRouter/flash 5/5.

**New finding, not seen on OpenRouter/flash for this repo:** in 2 of the 3 restraint trials, the
reply falsely claimed the coach didn't have the athlete's exact date of birth ("I have your age but
not your actual date of birth") and asked for it again - but `profile.json` on `main` already has
`"dob": "1995-09-07"`. A false-missing-data claim, same family as Finding E's confabulation (model
states a specific false thing about its own available information rather than acting correctly or
admitting uncertainty). n=1 repo, not enough to call provider-general, but a clear real occurrence.

### coach-skanda - 4/4

ordinary, profile-update, coach-note-absent-filler, and the #27 regression proof (fake template +
real co-occurring fact) all passed. Real fact landed cleanly every time, no crash.

Two notes, neither a bug: pro flatly refused to touch a fake/non-existent template
(`cardio_blast`) rather than hallucinating an edit - correct behavior, consistent with Finding B's
now-fixed real-template case. And on the filler turn, pro launched into an unprompted, verbose
"I am Coach Phelps... Michael... dealing with depression" origin-story monologue - a tone/verbosity
oddity, not a data-integrity issue.

### coach-date2022 - 4/4, clean

returning-season-change-with-goal, returning-season-and-habit-same-turn (#808 shape),
returning-standalone-habit-no-season-change, and the `new_habits` P0 guard proof (5 sequential
season_start turns) all passed. No divergence from the original 6/6 OpenRouter/flash result, no
hallucination anywhere - checked specifically given this exact repo/quest family previously showed
a severe DeepSeek hallucination and today's own Finding E confabulation was found on a sibling
repo. Same P0-guard caveat as before: pro never actually omitted `new_habits` across 5 tries, so
the true pre-fix crash path still wasn't hit live.

### coach-akash - 5/5, one already-known bug reproduces

quest-event-array, injury-event-array (came back stronger than the original test - both a resolve
and a new real flag fired this time), incremental-injury-disclosure (3-turn), injury-event-real-id-
among-several, and the #27 regression proof all passed, no crash.

**Repeats, not new:** the regression-proof scenario's reply again falsely claims success on the
dropped action ("I got the Monday session logged as squats") even though `session_reconcile` was
correctly dropped and `current_week.json` never changed. Same bug already flagged on the original
OpenRouter pass for this exact repo/scenario - confirms it reproduces on direct pro too, still
open, provider-agnostic.

Side note, out of scope for this pass: resolving an injury flag drops `injuries.json`'s
`_meta`/`version` block and overwrites the flag's chronic history with a one-line summary, every
time it's touched. Worth a look if athlete data hygiene matters; not part of today's testing.

### coach-prateek - 2/2, clean

week-plan-kickoff-ritual: `week_plan` fired correctly, real diff confirmed 7 real days with real
template ids from the actual manifest - **no hallucinated template ids this time**, an improvement
over the original OpenRouter run (which had safely-caught hallucinated ids on this same scenario).
One earlier attempt hit a transient validation error unrelated to hallucination; the retry
succeeded cleanly.

template_edit: fired cleanly against a real template id and real phase, diff confirmed. Two earlier
attempts correctly declined/asked for clarification rather than falsely claiming success (a stale
test-data id, and an active-injury conflict) - good behavior, not bugs.

### coach-skanda-testing FSP - the flagship scenario - 5/8 (37.5% fail)

**This is the single most important result of the day.** This scenario (a fresh athlete's first
message containing a goal + 2 injuries + 2 habits, all at once) is the one piece of evidence this
whole investigation has leaned on to justify staying on pro - previously measured 12/12 clean.
Re-run today with 8 fresh, independently-reset trials:

- **5/8 full clean success** - goal, injuries, habits, and profile fields all landed correctly,
  verified via real diff.
- **3/8 failed, all the identical pattern:** injuries silently dropped from `injuries.json` while
  the `reply`/`coach_note` explicitly claimed they were logged.
  - Trial 01: reply said "I noted the right hamstring strain and the left ankle tweak too... we
    are going to respect those" - `injuries.json` came back byte-identical `{"flags": []}`.
  - Trial 03: reply said "I've flagged both of them so we can track them" - `injuries.json` empty.
  - Trial 07: reply said "we'll let those heal while we build the engine," and also fabricated an
    unstated detail ("getting after it 2-3 times a week") - `injuries.json` empty.
- Goal, habits, and profile fields landed correctly in every one of the 8 runs, including all 3
  failures - **only injuries were affected, every time.**
- **`unrecorded_facts` (the reprompt safety net built specifically to catch this exact failure
  shape) missed all 3 failures.** It only ever flagged an unrelated DOB-vs-age mismatch, never the
  dropped injuries - so no reprompt ever fired to correct them. This is the same self-audit blind
  spot already documented for flash and OpenRouter (3 confirmed false negatives across 32+ trials
  there); now confirmed live on direct pro too.

Other FSP scenarios, 1 pass each, all diff-verified: fsp-quest-create, fsp-new-injuries (matching
precondition), fsp-coaching-style, fsp-quest-create-after-profile-complete. Template generation at
onboarding was inconclusive (the test transcript never reached `profileComplete: true`, unrelated
to model reliability).

---

## What this changes

The "stay on `gemini-pro-latest`" decision in `OPENROUTER-K1-RETEST-FINDINGS.md` was made on the
strength of one number: 12/12 clean on the flagship dense-message scenario. That number does not
hold at a larger sample today - it's 5/8, the same order of failure rate flash/DeepSeek show on
their own worst scenarios, just with a different symptom (false-success claim instead of silent
omission or wild hallucination). Combined with Finding E's confabulation and the two smaller
findings above (the DOB hallucination, the filler-turn restraint miss), the honest picture is:
**every model tested in this whole investigation, including pro, has a real, repeatable,
self-audit-invisible reliability gap.** The question for tomorrow's cheaper-model comparison is no
longer "does pro work and nothing else does" - it's which failure rate and which failure shape is
acceptable, at what cost, and whether the single-call-schema restructuring idea (see
`OPENROUTER-K1-RETEST-FINDINGS.md`'s "Idea not yet tried" section) can close the gap on a cheaper
model rather than assuming only pro's capability tier can ever get this right.
