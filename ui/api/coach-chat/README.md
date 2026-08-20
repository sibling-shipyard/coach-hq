# api/coach-chat/ — coach-chat internals

The HTTP routes for this feature (`coach-chat.ts`, `coach-chat-context.ts`,
`coach-chat-profile-status.ts`) stay one level up at `api/` — Vercel routes by literal file path,
so nesting them here would change their URLs (see [`../README.md`](../README.md)). This folder
holds everything those routes call into.

Full design: [`docs/eng-docs/coach-chat-flow.md`](../../../docs/eng-docs/coach-chat-flow.md).
Commit/retention design: [ADR 0012](../../../kdb/decisions/0012-coach-chat-atomic-commits-and-retention.md).
`coach_since` day-number design: [ADR 0018](../../../kdb/decisions/0018-coach-since-day-number.md).

## `_lib/`

| File | Role |
|---|---|
| `coachChatFiles.ts` | Raw repo file reads + split `CoachContext` loading, with an in-flight/short-TTL cache; profile-complete checks |
| `coachMemoryFiles.ts` | Paths and shapes for `profile.json`/`memory.json`/`injuries.json`/`coach_log.json` |
| `coachContext.ts` | Renders the athlete-context prompt block (Athlete Profile, Equipment, Fitness Baseline, Learned Patterns, Active Injury Flags, Recent Session Notes) from the four files above - same section headers state.md used to carry |
| `soulCache.ts` | Gemini explicit prompt caching for the static SOUL/instructions text |
| `chatThreads.ts` | Thread data model + `chat_history.json` persistence, retention (ADR 0012), title cleanup |
| `closeSignal.ts` | Deterministic close-intent detection — regex trigger + pending-close-attempt lookback |
| `coachDay.ts` | Timezone/day-number math (age labels, day dividers, `coach_since`-aware day count) - takes the athlete's timezone directly (`profile.json`), no more state.md-prose parsing |
| `coachPrompt.ts` | Gemini prompt construction — mode-specific response schemas, static/cacheable text, per-turn dynamic text, onboarding-hint context. Pure text-building, no I/O |
| `geminiClient.ts` | Gemini transport — builds the request from `coachPrompt.ts`'s text + `soulCache.ts`'s caching, retries transient failures once, parses the response |
| `coachWrites.ts` | Shared write helpers and `coach_since` stamping |
| `coachIntents.ts` | Pure appliers for server-owned file writes — `coach_note` (a new row in `coach_log.json`, the single merged continuity log), `memory_update`, `injury_event` |

`_tests/` mirrors `_lib/` one file at a time (drop the `coach-chat-` prefix other repos use —
redundant once you're already inside this folder), plus `_tests/coach-chat-eval/transcripts/`,
the golden-transcript fixtures `ui/scripts/eval-coach-chat.ts` runs against a live Gemini key.
