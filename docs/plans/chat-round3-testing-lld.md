# Chat round 3 testing: scenarios and method

> Status: Plan · Owner: Tech Lead · Created: 2026-09-19 · Parent: [`chat-round3-testing.md`](chat-round3-testing.md)

Method is [`coach-chat-testing.md`](../eng-docs/coach-chat-testing.md) type 3 and the scenario list in
[`coach-chat-test-scenarios.md`](../eng-docs/coach-chat-test-scenarios.md). This file adds only what round 3 needs.

## Rules for every run

1. Check OpenRouter headroom first (`GET https://openrouter.ai/api/v1/key`) and tell the athlete. The dev key is the production key.
2. Use a freshly reset scratch branch on `skanda-testing/coach-skanda-testing` for every First Session run.
3. Check every result off the branch, never by the harness alone.
4. Change no code while a batch runs. A fix goes in a new stacked PR with the third sibling as reviewer.
5. Rerun only failures and their neighbours. Repeat any scenario that depends on model behaviour up to three times, since round 2 saw one failure in four.
6. Results, costs and raw logs go in the round-3 test PR.

## Group A: untested paths

| ID  | Scenario                                | Trigger                                                            | Pass when                                                              |
| --- | --------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| A1  | Carry-over fires (also #1256)           | Repeat `fsp-end-to-end` until a reprompt reply drops a field       | `reprompt_fields_carried` seen and the field is written                |
| A2  | Coaching-style guard fires (also #1256) | Repeat until the style is stated and not set                       | Trace shows `missedCoachingStyleLanguage`, then the style lands        |
| A3  | Named days                              | "Tuesdays, Thursdays and Saturdays"                                | `preferred_days` set, week uses them, message says "the days you said" |
| A4  | Count below named                       | "4 days a week, Monday to Friday"                                  | `days_per_week` is 5                                                   |
| A5  | Count only                              | "4 days a week", no days                                           | Coach asks which days; no days are invented                            |
| A6  | Zero days                               | "0 days a week right now"                                          | `days_per_week` 0, a legal week is built                               |
| A7  | Sunday                                  | Run on a Sunday with every stated day past                         | Week left empty with an honest message                                 |
| A8  | Native hints                            | Greeting with name and sports already saved                        | Nothing re-asked, First Session still completes                        |
| A9  | Second injury or habit                  | Both stated after the first quest and flag exist                   | Both are written                                                       |
| A10 | Returning availability                  | "Now training Monday, Wednesday, Friday, Saturday" on a daily turn | `memory.training_availability` updated                                 |
| A11 | Worst-case latency                      | A turn that triggers every reprompt layer                          | Wall time is under the 300s function limit, and the number is recorded |
| A12 | Fresh skeleton                          | New repo from the recarved skeleton, then `fsp-end-to-end`         | Completes; shape validator passes; `rollover.yml` present              |
| A13 | Every athlete repo after backfill       | One daily turn per repo                                            | No shape error, the validator passes, lazy rollover still works        |

A7 needs the run to happen on a Sunday. A8 needs the harness to send `onboardingHints`; check that first and add it if missing.

## Group B: signals from the observability plan

Each row needs one message that should trigger it and one that should not. Numbers refer to the
PRs in [`chat-observability-and-guards.md`](chat-observability-and-guards.md).

| ID  | Signal                                | PR  | Trigger                                                | Pass when                                                                  |
| --- | ------------------------------------- | --- | ------------------------------------------------------ | -------------------------------------------------------------------------- |
| B1  | Reprompt reasons on the LLM span      | 1   | Any live turn that reprompts                           | `reprompt.count` and `reprompt.reasons` in the trace                       |
| B2  | `llm_calls` and total tokens per turn | 1   | A one-call turn and a multi-call turn                  | Both values match the server log                                           |
| B3  | Adapter retry marker                  | 1   | A transient 503 or a truncated reply                   | `llm.retried` and its reason present                                       |
| B4  | `text_truncated` fixup                | 2   | A pasted 3000-character log into a memory note         | Fixup recorded and the saved text is capped                                |
| B5  | First Session fallback fixups         | 2   | No frequency stated; a late-week run; a Sunday run     | `availability_defaulted`, `benchmark_moved_to_tomorrow`, `week_left_empty` |
| B6  | Completion and stuck events           | 3   | A full First Session; one where no style is ever given | Completion event fires once; stuck event lists the missing field           |
| B7  | Detect-only detectors G1 to G10       | 4   | One triggering and one benign message each             | Detector logged, and the model call count is unchanged                     |
| B8  | Promoted reprompts                    | 5   | The messages that showed real misses in B7             | Reprompt fires and the write lands                                         |
| B9  | Turn time budget                      | 6   | A slow provider, by stub or an env timeout             | No turn runs past the limit; a skipped extra call is recorded              |
| B10 | Auto-note stays out of the prompt     | 6   | A turn with a synthesized note, then the next turn     | The next turn's context has no `Auto-note` prefix                          |

B3 and B9 need a fault: use a preview deployment or a stub adapter, as in
[`sentry-runbook.md`](../eng-docs/sentry-runbook.md) "Prove before merge". Local runs are not `environment:production`,
so no alert fires. Read the signal in the trace, not from an alert.

## Cost

23 scenarios at about $0.03 each, three repeats where model behaviour decides the result: roughly $2 to $3.
Check headroom against that number first.

## Report

`test-results/<date>-round3.md` in the round-3 test PR: one table per group with result, cost and raw log
path, then the list of failures, their causes and their fix PRs, then what was not run and why.
