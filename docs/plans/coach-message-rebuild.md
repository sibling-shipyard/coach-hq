# coach-message: build it properly

> Status: Blocked on the OpenRouter migration · Owner: Tech Lead · Verified: 2026-09-05 · Issue: #828

## Context

`coach-message` shipped as a proof of concept (#320, PR #543) and has not been revisited. Three things measured on 2026-09-04 show what that left
behind. It pays full input price on a 5,371-token SOUL it re-sends every call. coach-chat never
reads the message it produces. And no test in the suite touches a real model, which is why a
Google-side change to thinking mode broke production in silence. This plan is the cleanup. It starts **after** the OpenRouter migration lands, so the
adapters and `llmClient` seam already exist to build on.

## Goal

```mermaid
flowchart LR
  A["SOUL — 5,371 tokens"] --> B["one cached entry"]
  B --> C["coach-chat"]
  B --> D["coach-message"]
  C --> E["own instructions, dynamic half"]
  D --> F["own instructions, dynamic half"]
```

One cached SOUL serves both callers. Each keeps its own instructions and few-shots in the dynamic
half, where they belong.

## What is already fine — do not "optimise" it

`loadProactiveContext` is not a raw dump. Every field passes a `project*` allow-list with length
caps (`coachMessage.ts:510` onward): 16 activity fields, `effort_shape` sliced to 12 blocks,
injuries filtered to `status === "active"`. Against `shared/golden-dataset/`, projection keeps 98%
of an already-lean 681-byte activity — about 166 tokens each. The athlete payload is not the cost.
The uncached static prefix is.

## Measured baseline

| Thing | Value | How |
|---|---|---|
| SOUL share of the proactive prompt | 5,371 of ~6,859 tokens (78%) | section split of `buildProactivePrompt` output |
| SOUL share of chat's cached prefix | 5,371 of 5,795 tokens (93%) | `staticSystemText(SOUL)` |
| Cache discount coach-message receives | none | 3 identical back-to-back calls, `cachedContentTokenCount = 0` each |
| Thinking-token variance, same prompt | 893 → 1,519 | 3 runs, `gemini-pro-latest` |

## Milestones

```mermaid
flowchart LR
  M1["M1 A check that catches this"] --> M2["M2 One shared SOUL cache"] --> M3["M3 Close the continuity gap"]
```

| # | Size | Milestone | State | Result |
|---|---|---|---|---|
| 1 | S | A check that catches this | PR 1 open | One scheduled job calls the real model through `llmClient` and fails on an invalid reply |
| 2 | M | One shared SOUL cache | not started | `coach-chat` and `coach-message` resolve the same cache entry; coach-message's input bill drops ~90% |
| 3 | S | Close the continuity gap | not started | coach-chat knows what the last proactive message said, or an ADR records why it should not |

## PR stack

| PR | milestone | outcome | final base | files | owner | parallel with | result |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Live-model smoke check on a schedule, failing loudly on a truncated or unparseable reply | `feat/713-llm-client-review` | `ui/scripts/`, `.github/workflows/`, `ui/api/_lib/_tests/`, `kdb/decisions/` | Bob the Builder | — | built: `smoke-coach-message.ts` + daily workflow + ADR 0037; 21 mocked tests, live call unrun (needs `OPENROUTER_API_KEY` in Actions) |
| 2 | 2 | Cache SOUL alone; both callers move their own instructions into the dynamic half | PR 1 | `ui/api/_lib/`, `ui/api/coach-chat/_lib/`, `ui/api/coach-message/_lib/`, matching `_tests/`, `docs/eng-docs/gemini-flow.md` | Bob the Builder | — | not started |
| 3 | 3 | coach-chat reads `latest_message.json`, or an ADR says why not | PR 2 | `ui/api/coach-chat/_lib/`, `ui/api/coach-chat/_tests/`, `kdb/decisions/` | Bob the Builder | — | not started |

## Decisions taken while building

Milestone 1 only. One row per call a reasonable builder could have made the other way.

| # | Decision | Why | Reversible? |
|---|---|---|---|
| 1 | Branch PR 1 off `feat/713-llm-client-review`, not `main` | `llmClient` and both adapters exist only on that stack; a canary on `main` has nothing to call | yes — rebase onto `main` once the stack lands |
| 2 | One prompt, sent to both adapters | Same input to both means a difference in the replies is a provider difference, not a prompt difference | yes |
| 3 | Daily, not hourly | Provider drift is a days-scale event and the bill is per run: ~$0.32/month daily against ~$7.70 hourly | yes — one cron line |
| 4 | The athlete fixture lives in `smoke-coach-message.ts`, not `shared/golden-dataset/` | Golden-dataset carries no raw activity, profile, memory, injury or coach-log file, which is what `loadProactiveContext` reads; `shared/` is also outside this PR's scope. Only `latest_message.json` is read from it | yes |
| 5 | `current_live_week` is null in the canary prompt | The golden week fixture is a frozen placeholder, and the live-week gate correctly resolves a placeholder to null | yes |
| 6 | Truncation is detected in two places | The adapters catch `MAX_TOKENS` / `finish_reason: length` before we ever see text; a reply that arrives cut off shows up as unterminated JSON | yes |
| 7 | The canary calls production's own `validateGeneratedBody` rather than its own schema check | If production would 502 on the reply, the canary goes red on it. Cost: a stray em dash from the model is a real red | yes |
| 8 | Retry once on transport, never on a contract failure; exit 2 for transport, 1 for contract | ADR 0024: most Gemini reds are 503s, and a canary whose reds are weather stops being read | yes |
| 9 | ADR 0037 sits beside ADR 0024 instead of widening it | 0024 works because of one sentence — name what this diff could catch. Widening it to cover diffless checks blunts it | no — reversing means superseding an ADR |

## Done when

1. A real-model check runs on a schedule and fails on a truncated or unparseable reply.
2. One cache entry serves both callers, and `cachedContentTokenCount` is non-zero on coach-message.
3. Output budgets are derived from a measured thinking ceiling, not a constant tuned to a retired model.
4. The chat/proactive continuity gap is closed or explicitly declined in an ADR.

## Deferred

- Trimming the athlete payload — measured, already lean. Reopen only with a number.
- Shrinking SOUL itself. Separate concern, coach quality owns it.
- Proactive-message quality scoring — #714 and `chat-coach-bench.md` cover it.
