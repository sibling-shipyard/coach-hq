# Coach Chat — how it works

> Status: Current · Owner: Tech Lead · Verified: 2026-08-21

Real Coach Phelps sessions from the browser and iOS, backed by Gemini. This is the entry point —
the detailed content that used to live in this one file is now split by concern:

| Doc | Covers |
|---|---|
| [`coach-chat-daily.md`](coach-chat-daily.md) | Day-to-day chat: preload, greeting, ordinary turns, close-session detection, retention, rendering, auth. The full turn-lifecycle module/class reference lives in its appendix. |
| [`coach-chat-fsp.md`](coach-chat-fsp.md) | First Session Protocol: the one-time intake conversation, native-onboarding handoff, resumability, completion signal. |
| [`gemini-flow.md`](gemini-flow.md) | Everything Gemini-specific: model, prompt shape, explicit caching, response schema, retries. |
| [`coach-data-schema.md`](coach-data-schema.md) | Every file Coach reads or writes, every enum, what Gemini gets as input and can write. |

Companion to [`ios-sync.md`](ios-sync.md): that doc covers HealthKit ingestion, this set covers
the coaching-conversation path. For the dated history of how this system got here, see
[`coach-chat-design-history.md`](coach-chat-design-history.md). Commit/retention design: ADR
0012. Vercel function-count constraint that shapes the endpoint layout: ADR 0017.
