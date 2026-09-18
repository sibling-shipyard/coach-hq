# Coach Chat — how it works

> Status: Current · Owner: Tech Lead · Verified: 2026-09-18

Real Coach Phelps sessions from the browser and iOS, backed by Gemini. This is the entry point —
the detailed content that used to live in this one file is now split by concern:

| Doc | Covers |
|---|---|
| [`coach-chat-daily.md`](coach-chat-daily.md) | Day-to-day chat: preload, greeting, ordinary turns, close-session detection, retention, rendering, auth. The full turn-lifecycle module/class reference lives in its appendix. |
| [`coach-chat-fsp.md`](coach-chat-fsp.md) | First Session Protocol: the one-time intake conversation, native-onboarding handoff, resumability, completion signal. |
| [`gemini-flow.md`](gemini-flow.md) | Everything Gemini-specific: model, prompt shape, explicit caching, response schema, retries. |
| [`chat-llm-seam.md`](chat-llm-seam.md) | The `llmClient.ts` provider seam: direct Gemini vs. OpenRouter adapters, retry/error-passthrough differences, usage accumulation across retries. |
| [`coach-data-schema.md`](coach-data-schema.md) | Every file Coach reads or writes, every enum, what Gemini gets as input and can write. |
| [`coach-chat-testing.md`](coach-chat-testing.md) | How to test coach-chat: the layered no-network vitest suite (`npm test`), the eval harness (`npm run eval:coach-chat`), and the manual athlete-repo test tool. |

`platform-workouts-compiler.md` deliberately isn't in the table above - it documents the
no-LLM `compileWorkout()` engine and the three-band Workouts UI, not the coaching-conversation
path this index routes through.

Companion to [`ios-sync.md`](ios-sync.md): that doc covers HealthKit ingestion, this set covers
the coaching-conversation path. For the dated history of how this system got here, see
[`coach-chat-design-history.md`](coach-chat-design-history.md). Commit/retention design: ADR
0012. Vercel function-count constraint that shapes the endpoint layout: ADR 0017.
