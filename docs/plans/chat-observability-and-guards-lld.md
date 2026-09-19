# Chat observability and guard gaps: audit and detail

> Status: Plan · Owner: Tech Lead · Created: 2026-09-19 · Parent: [`chat-observability-and-guards.md`](chat-observability-and-guards.md)

Paths are under `ui/api/coach-chat/_lib/` unless they start with `ui/api/_lib/`. I read the code on
the round-2 stack head (PRs #1251, #1252, #1254 and #1255); nothing here was run against production.

## 1. Sentry audit: what is captured today

A turn goes: load state, LLM call, guards and reprompts, build writes, commit, First Session completion.

| Stage                                   | Captured today                   | Where                                                           |
| --------------------------------------- | -------------------------------- | --------------------------------------------------------------- |
| Missing SOUL bundle, unconfigured chat  | Exception                        | `turnRequest.ts`, `coach-chat.ts`, `commit/activitySyncTurn.ts` |
| Context file reads (non-404)            | Exception                        | `decide/coachChatFiles.ts`, `turnRequest.ts`                    |
| LLM call fails for good                 | LLM failure event                | `requestCoachReply.ts` (`captureLlmFailure`)                    |
| Reprompt did not fix the reply          | Warning event, detector names    | `requestCoachReply.ts` (`captureStillUnresolvedGuard`)          |
| Action dropped for a bad reference      | Validation failure per action    | `buildTurnWrites.ts` (`captureValidationFailure`)               |
| Server fixes the model did not ask for  | One warning per turn, by kind    | `decide/silentFixups.ts`                                        |
| Facts or chat commit fails              | Exception                        | `turnCompletion.ts`, `buildTurnWrites.ts`                       |
| Benchmark generation fails, or gives up | Exception, then an error message | `turnCompletion.ts`                                             |
| `coach_since` stamp fails               | Exception                        | `decide/coachSinceStamp.ts`                                     |
| Every LLM and GitHub call               | Spans with usage and outcome     | `ui/api/_lib/sentry.ts`                                         |

Silent fixup kinds today: `phase_no_match`, `phase_ambiguous`, `template_id_nulled`,
`discipline_coerced`, `quest_event_synthesized`, `coach_note_synthesized`, `reprompt_fields_carried`.

## 2. Sentry gaps

| #   | Gap                                                                                                                                   | Evidence                                                                                              | Fix (PR)                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| S1  | A reprompt firing is console-only. Only a reprompt that fails reaches Sentry.                                                         | `requestCoachReply.ts` logs "reprompting once" with `console.warn` and no capture                     | Span attributes `reprompt.count` and `reprompt.reasons` on the LLM span (1)                                           |
| S2  | No per-turn total of model calls or cost. A turn can make four calls.                                                                 | Spans are per call; nothing sums them for the turn                                                    | Tag the turn span with `llm_calls` and total tokens (1)                                                               |
| S3  | Adapter retries leave no marker. Gemini retries once on 503, 504 or a stale cache. OpenRouter retries a truncated reply.              | Both adapters sum usage across attempts but I found no retry attribute; confirm in PR 1               | Attribute `llm.retried` and its reason (1)                                                                            |
| S4  | Text truncation is silent. It is the last backstop after the prompt caps and the reprompt.                                            | `capText` in `coachNoteWrite.ts`, `memoryWrite.ts`, `injuryWrite.ts`, `turnRequest.ts` has no capture | New fixup kind `text_truncated` (2)                                                                                   |
| S5  | First Session fallbacks are silent: default availability, notes-parse used, benchmark moved to tomorrow, week left empty on a Sunday. | `decide/firstWeekCompile.ts` has no capture; `turnCompletion.ts` logs only failures                   | Fixup kinds `availability_defaulted`, `availability_from_notes`, `benchmark_moved_to_tomorrow`, `week_left_empty` (2) |
| S6  | No completion funnel. Nothing says a First Session finished, or that one is stuck.                                                    | Completion is derived state (`isFirstSessionRitualDone`); no event on the transition                  | Event on the transition; a stuck event after N turns listing the missing fields (3)                                   |
| S7  | The auto-note text reaches the model through `coach_log` and gets copied into its own notes.                                          | Seen in round-2 traces; not yet quantified                                                            | Exclude the prefix from the prompt context (6)                                                                        |
| S8  | Retry layers share no deadline. Per-call timeout is 60s, the function limit 300s.                                                     | `coachLlmClient.ts`, `geminiAdapter.ts`, `openRouterAdapter.ts`                                       | One turn-level budget checked before each extra call (6)                                                              |

## 3. Guard scope audit

A guard is a check on the athlete's own words that forces one reprompt when a field was narrated
and not set. Scope today, from the gate line of each `find*` function in `turnReplyValidation.ts`:

| Scope              | Guards                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| First Session only | new injury, habit, season, profile (dob, height, weight, timezone), coaching style                        |
| Daily only         | new habit, removal, workout create, template edit, session plan, week update, uncounted injuries          |
| Both               | sports (new-activity phrasing), injury update (exactly one active flag), oversized text, unrecorded facts |

First Session only was a false-positive choice: a stated age or weight is reliably new there and may
be a restatement in daily chat. Daily can compare against the stored value, which the First Session cannot.

## 4. Guard gaps

| #   | Gap                                                                                             | Impact                                                                      | Plan (PR)                                             |
| --- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------- |
| G1  | Daily has no profile guard: a weight, height or timezone change can be narrated and not saved.  | Wrong body data or timezone drives coaching                                 | Detect first, compare against the stored value (4, 5) |
| G2  | Daily has no coaching style guard.                                                              | A change of style is lost                                                   | Detect on change wording plus a style word (4, 5)     |
| G3  | Daily has no season guard for a new goal.                                                       | A new goal exists only in the transcript                                    | Detect only; reprompt stays deferred (4)              |
| G4  | First Session timezone guard misses "I live in ..." and "I'm from ...".                         | Timezone is required for completion                                         | Widen the pattern (4, 5)                              |
| G5  | First Session has no name guard.                                                                | Name is required for completion; native onboarding usually saves it first   | Detect only (4)                                       |
| G6  | First Session sports guard needs new-activity phrasing, so a plain "I'm a runner" is unguarded. | Sports is required for completion; native onboarding usually saves it first | Detect only (4)                                       |
| G7  | `memory_update` has no guard in either mode.                                                    | Durable facts can be lost                                                   | Detect only; reprompt stays deferred (4)              |
| G8  | `training_availability_update` has no guard.                                                    | The notes parse is the only fallback                                        | Detect only (4)                                       |
| G9  | The First Session never tells the model which required fields are still missing.                | The model relies on the protocol steps alone                                | Decide after the stuck-session numbers from PR 3      |
| G10 | The First Session habit guard stops once a quest exists, and the new-habit guard is daily only. | A second habit in the same intake is unguarded                              | Detect only (4)                                       |

"Detect only" means a log-and-span detector that never reprompts. PR 5 promotes a detector to a
reprompt only when PR 4's numbers show real misses. That keeps false positives from costing an
extra call, about $0.013 and up to 20 seconds, on every daily turn.

## 5. Build handoff

- **Sentry quota.** `level: warning` events count against the free plan (`ui/api/_lib/sentry.ts`). Rate-
  proportional signals go on spans. Only once-per-failure signals become events.
- **Reuse.** `recordSilentFixup` and `flushSilentFixups` already batch fixups into one event per turn.
  Add kinds there rather than new capture calls.
- **Tests.** Each detector needs the same set as the existing guards: fires, does not fire when the field
  is set, wrong scope, field already on file, unrelated message, and a still-missed Sentry case.
- **Live checks.** Reprompt telemetry (PR 1) is verified by any live turn that reprompts. Guards are
  verified on `fsp-end-to-end` and the daily scenarios, checked off the branch, not by the harness alone.
- **Docs.** `docs/eng-docs/gemini-flow.md` (guard table and Sentry sections) and `coach-chat-testing.md`
  change with each PR; bump their `Verified:` dates.
