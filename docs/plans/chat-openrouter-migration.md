# OpenRouter migration

> Status: Current · Owner: Tech Lead · Verified: 2026-08-30 · Issue: #713

## Context

Three call sites reach Gemini independently, each with its own raw `fetch` and its own
hardcoded model string. On 2026-08-30 `gemini-flash-latest` went 0/5 across two manual runs
under real prompt load (#668), so `geminiClient.ts` was pinned to `gemini-pro-latest`. The
other two callers were missed and still run flash. Athletes feel this as a coach that fails
to answer.

One client behind OpenRouter fixes the split and makes the model a config value.

## Goal

```
today                                       after
-----                                       -----
coach-chat.ts    -> geminiClient.ts  --+     coach-chat.ts     --+
coach-message.ts -> raw fetch        --+->G  coach-message.ts  --+-> llmClient -> OpenRouter -> model
coachWorkoutFiles-> raw fetch        --+     coachWorkoutFiles --+    (env)       (US providers)

3 callers, 3 hardcoded models                1 caller path, 1 config value
```

Gemini stays the model through the switch. Holding it constant makes any behaviour change
attributable to the plumbing rather than the model, and the existing 22-transcript gate
becomes a before/after check on the migration itself.

## Milestones

| # | Milestone | Result |
|---|---|---|
| 1 | One model config | `grep -rn '"gemini-' ui/api` returns one file, not three |
| 2 | `llmClient` calls OpenRouter, Gemini held constant | The gate returns the same verdict before and after the swap |
| 3 | Model choice opens up | Changing model is an env edit; a non-Gemini model passes the gate |
| 4 | Provider decision recorded | An ADR in `kdb/decisions/` names the provider and the default model |

## PR stack

| PR | milestone | outcome | final base | files | owner | parallel with | result |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Single source for model ids; strands no caller on flash | `main` | `ui/api/_lib/llmConfig.ts`, `coach-chat/_lib/geminiClient.ts`, `coach-message/_lib/coachMessage.ts`, `coach-chat/_lib/coachWorkoutFiles.ts` | UI Expert | — | |
| 2 | 2 | `llmClient` wraps OpenRouter; `geminiClient` routes through it | PR 1 | `ui/api/_lib/llmClient.ts`, `coach-chat/_lib/geminiClient.ts` | UI Expert | — | |
| 3 | 2 | Other two callers route through `llmClient` | PR 2 | `coach-message/_lib/coachMessage.ts`, `coach-chat/_lib/coachWorkoutFiles.ts` | UI Expert | — | |
| 4 | 3 | US-only provider routing pinned; caching resolved; second model proven | PR 3 | `ui/api/_lib/llmClient.ts`, `coach-chat/_lib/soulCache.ts`, `docs/eng-docs/env-vars.md`, `docs/eng-docs/gemini-flow.md` | UI Expert | — | |
| 5 | 4 | ADR + doc upkeep | PR 4 | `kdb/decisions/`, `docs/eng-docs/llm-provider-current.md` | Tech Lead | — | |

Every PR touches `llmClient.ts` or a caller, so nothing here runs in parallel.

## Open questions

1. **Caching.** `soulCache.ts` creates explicit Gemini caches keyed by model, with names in
   Vercel Edge Config. OpenRouter is not expected to expose that API. PR 4 either ports it to
   `cache_control` passthrough or deletes it — confirm which before building.
2. **Structured output.** `coachReplySchema.ts` drives Gemini `responseSchema`. Each model
   behind the router needs its schema support proven by the gate, not assumed.

## Done when

1. No model id is hardcoded outside `ui/api/_lib/llmConfig.ts`.
2. All three callers reach the model through `llmClient`.
3. The 22-transcript gate gives the same verdict on Gemini before and after the swap.
4. One non-Gemini model passes the gate with only an env change.
5. An ADR records the provider choice — `llm-provider-future.md:200` says a shipped switch is
   when one gets written.

## Deferred

- Choosing the production model on measured quality — that is `chat-coach-bench.md`, P1.
- Streaming responses (#270).
- Real history compaction rather than the `MAX_HISTORY_MESSAGES` hard cap (#572).
