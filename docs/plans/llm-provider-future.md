# Coach chat LLM provider — research

> Status: Current · Owner: Tech Lead · Verified: 2026-08-05

## Context

`coach-chat.ts` calls Gemini free tier (`gemini-flash-latest`) directly via raw `fetch`, no SDK.
This was a "revisit when it becomes a real blocker" doc — it now is one. Free-tier RPD got hit
on 2026-08-03/04 before I could even finish testing the First Session Protocol.

## Does a second Google account with Gemini Pro help?

No. Google AI Pro/Ultra is a consumer subscription (the Gemini app / AI Studio Playground UI).
It's billed and managed completely separately from the Gemini API. Per Google's own docs:

> Google AI plan benefits for developer usage apply only within the Google AI Studio web
> interface. Direct use of the Gemini API (API keys, external applications) is billed and
> managed separately.

An API key minted under a Gemini Pro account lands in the exact same free tier as the one I'm
using now. The only thing that actually raises `coach-chat.ts`'s limits is turning on **Cloud
Billing** (pay-as-you-go) on the Google Cloud project the key belongs to — that's a metered
switch, not a plan purchase, and it moves the key off the free-tier RPD ceiling entirely.

## Free-tier landscape (dev/testing, not production)

**Gemini free tier — confirmed from this project's own AI Studio dashboard** (Coach Phelps
project, Aug 2026): **Gemini 3.6 Flash and Gemini 2.5 Flash are both 5 RPM / 250K TPM / 20 RPD.**
That's the real ceiling for this account, not a generic figure — some public guides quote
10 RPM/1,500 RPD for "the Gemini free tier," but that's not what this project actually gets.
20 requests a day is why FSP testing broke on 2026-08-03/04 with real conversations.

| Provider | What's free | Good for | Not good for |
|---|---|---|---|
| Gemini (current) | 5 RPM / 250K TPM / 20 RPD per Flash model (this account, confirmed) | Quick manual testing | Any real session volume — this is what just broke FSP testing |
| OpenRouter free tier | `:free` suffix models, aggregates many providers (including free Gemini/DeepSeek/Llama) behind one key | Trying several models fast without new accounts | Production — funded by your prompts, rate-capped per model |
| Groq | Fast inference on OSS models (Llama family), generous free RPM | Latency-sensitive dev loops | Persona-heavy work — no persona-tuned model on offer |
| Cerebras | ~1M tokens/day free on Llama-class models | Bulk/batch testing | Real-time chat UX, persona consistency |

Free tiers are all usage-funded and capped by design — treat them as a dev safety net, not a
plan for the live coach.

## Architecture — what's actually being sent, verified against the code

`coach-chat.ts` makes exactly **one Gemini call per turn** — greeting, ordinary reply, and
session close all go through the same `askGemini()` (`coach-chat.ts:335-532`), a plain REST POST
to `generateContent` with the API key as a query param, no SDK. There's no second, cheaper call
for anything: close-session detection is a plain regex (`CLOSE_SESSION_PATTERN`,
`coach-chat.ts:216-217`), not a model call — it only sets the prompt's `mode`, and the model's own
`session_closed` field (returned in that same one response) is what actually gates a commit.

**What's in every request:**
- `systemInstruction` floor ≈ **13,000 input tokens on every single turn**: full `SOUL.md`
  (49,716 bytes ≈ ~12,400 tokens) + `state.md` + `quest_log.md`, sent in full every time
  (`coach-chat.ts:346-361`). Closing turns add four more full files on top
  (`coach_notes.md`, `challenge_v2.json`, `current_week.json`, `sleep_log.json`,
  `coach-chat.ts:362-371`). Only skeleton-template sizes were measurable here (state.md 1.7KB,
  quest_log.md 260B) — a real athlete's files run larger (`docs/eng-docs/scaling-plan.md:231`
  already flags a real `state.md` around 14KB).
- `maxOutputTokens: 16384` (`coach-chat.ts:476-479`).
- `contents` — **the entire prior conversation, unbounded** (`coach-chat.ts:456-464`). Nothing
  caps message count within a thread; only *thread* count is capped (7 threads kept,
  `MAX_RETAINED_THREADS`, `coach-chat.ts:284`). A long single conversation before close grows
  every subsequent request linearly, stacked on top of the ~13K-token fixed prefix — this is real
  and currently unaddressed, independent of which provider gets picked.
- A 60-second, process-local, per-repo context cache (`CONTEXT_CACHE_TTL_MS`,
  `coachChatFiles.ts:102-103`) avoids re-fetching state/quest_log from GitHub on rapid
  repeat calls, but it's a plain in-memory `Map` — only helps within one warm Vercel instance, not
  a cross-instance or provider-level cache.
- **Shipped:** SOUL.md is no longer fetched from the athlete's own repo at all. It's verified
  100% generic (no per-athlete substitution anywhere in the carve process), so the backend now
  bundles `platform/SOUL.chat.md` at build time (`ui/scripts/build-soul.mjs`) instead — one fewer
  GitHub API call every turn, and a coach-behavior change now reaches every athlete's chat
  immediately instead of waiting on their next carve. See the ADR amending 0011.

iOS has no separate LLM logic at all — confirmed thin client of the same endpoint
(`CoachChatAPIClient.swift:3-7`), same request/response shape, same unbounded history.

## Paid comparison (Aug 2026 pricing, $ per million tokens)

| Model | Input / Output | Structured JSON output | Fit for this project |
|---|---|---|---|
| Gemini 3.6 Flash (current) | $1.50 / $7.50 | Yes, `responseSchema` — already in use | Same integration, no free-tier ceiling |
| Gemini 2.5 Flash-Lite | $0.10 / $0.40 | Yes | Cheapest Google option, noticeably weaker quality |
| DeepSeek V4 Flash | $0.14 / $0.28 | Yes, but schema compliance less mature than Gemini/Claude/OpenAI | Cheapest overall — risky given every turn depends on structured output |
| DeepSeek V4 Pro | $0.435 / $0.87 | Same caveat as Flash | Same risk, less savings |
| Qwen3-Max (Alibaba) | ~$0.86 / $3.44 | Yes, native JSON schema | Solid mid-tier, unproven persona fit |
| Kimi K2.5 (Moonshot) | $0.60 / $3.00 | Yes, JSON schema + prompt caching | Cheapest option with reliable structured output |
| Kimi K2.6 (Moonshot) | $0.95 / $4.00 | Yes, JSON schema + prompt caching | Slightly pricier sibling of K2.5 |
| GPT-5.4 Mini | $0.75 / $4.50 | Yes, strict JSON schema mode | Good middle ground, no caching upside here |
| GPT-5.4 Nano | $0.20 / $1.25 | Yes | Cheap, but weakest OpenAI option for a persona-heavy job |
| Claude Haiku 4.5 | $1 / $5 | Yes, GA structured outputs | **Recommended** — see below |
| Claude Sonnet 5 | $2 / $10 through Aug 31 2026, then $3 / $15 | Yes | Step up if Haiku quality isn't enough |
| Claude Fable 5 | $10 / $50 | Yes | Anthropic's persona/character-tuned line — closest purpose-built fit, priced out at current scale |

Kimi's K2 family is worth noting separately: it exposes both an OpenAI-compatible and an
Anthropic-compatible endpoint, so it can be trial-swapped into `coach-chat.ts` without a new
client shape either way.

## Rate limits — verified against each provider's own docs (Aug 2026), not estimated

- **Gemini paid (Tier 1) — now live and confirmed from this project's own dashboard**
  (2026-08-06): **1,000 RPM / 2,000,000 TPM / 10,000 RPD** (3.6 Flash) and **1,000 RPM /
  1,000,000 TPM / 10,000 RPD** (2.5 Flash). Google doesn't publish these as a static table — they
  came from `aistudio.google.com/rate-limit` after billing went on, not from docs, so re-check
  there rather than trust this figure indefinitely (Google can raise/lower tiers without notice).
  At this project's real volume (~960 turns/mo), none of RPM/TPM/RPD are remotely close to being
  constrained.
- **Claude Haiku 4.5 — officially confirmed** (`platform.claude.com/docs/en/api/rate-limits`,
  Start tier): **1,000 RPM / 2,000,000 ITPM / 400,000 OTPM.** At this project's volume (a
  handful of athletes, well under a thousand turns/month), Haiku isn't remotely close to being
  rate-limit-constrained — headroom here is not a real concern.
- **GPT-5 mini — officially confirmed** (OpenAI's own rate-limit increase announcement, Tier 1):
  **500,000 TPM (5M batch).** RPM isn't published in static docs for this specific model —
  check the platform dashboard rather than assume a number.

## Cost minimization — techniques beyond "turn on caching"

**Shipped:** Gemini already has free, automatic prompt caching — confirmed via
`developers.googleblog.com` and `ai.google.dev/gemini-api/docs/caching`, implicit caching has
been on by default for every Gemini 2.5+ model since 2025 (no opt-in, no code, 90% discount on
cached tokens, minimum cacheable prefix 1,024 tokens). The only reason it wasn't paying off was
the `todayContextLine()` bug: the per-minute-changing "Today is ..." line sat between `soul` and
`state.md`/`quest_log.md` in the prefix, breaking the cache on every single call. **Fixed** —
`todayContextLine()` is now the last element in the `systemInstruction` array instead of the 3rd,
so the persona/instructions/few-shot/state block stays a stable, cacheable prefix. Also added: 3
worked few-shot examples inside that same cached prefix (persona consistency + fewer
structured-output errors, per Anthropic's multishot-prompting guidance — one-time cost, not
per-turn since it's cached), and a hidden `reasoning` field ahead of the final JSON answer (per
OpenAI's structured-outputs guidance on reasoning-before-answer for non-reasoning models),
stripped before the reply ever reaches the athlete.

**Caching mechanics differ by provider** — worth knowing before assuming "caching" means the same
thing everywhere:
- **Gemini:** automatic implicit caching, no code change, 90% discount on cache hits.
- **Claude:** explicit `cache_control` breakpoints — a real code change, but cached tokens are
  also excluded from the ITPM rate limit (not just billed cheaper), which raises effective
  throughput on top of cost savings.
- **OpenAI (GPT-5 family):** automatic for prompts over 1,024 tokens, no code change — same
  "free" caching as Gemini.

**Other techniques researched:**
- **Context/history windowing** — **shipped.** `MAX_HISTORY_MESSAGES = 40` now caps in-thread
  history before it's sent (`coach-chat.ts`, next to the existing `MAX_RETAINED_THREADS`
  thread-count cap). This is a hard window, not real conversation compaction/summarization
  (Anthropic's recommended longer-term pattern) — that's still future work once real
  conversation-length data exists to size it properly.
- **Model routing** (cheap model for easy turns, expensive model for hard ones) — doesn't cleanly
  apply to this architecture as it stands: one call already does reply + structured file-updates
  + commit message + title in a single shot. Splitting that into a cheap-classify/expensive-reply
  pipeline is a real redesign, not a config change — worth a later look, not a near-term win.
- **Batch API** (~50% off on all providers that offer it) — not applicable. This is real-time
  interactive chat; nothing here is batchable.

## Recommendation

**Unblocked.** Cloud Billing went live on the existing Gemini Cloud project 2026-08-06 (₹2,500
prepaid credit, Tier 1 confirmed on the Rate Limit dashboard) — testing is no longer
rate-limited at this account's scale. The `todayContextLine` prefix-ordering fix, few-shot
examples, history cap, and SOUL bundling (see Cost minimization and Architecture above) were
already shipped ahead of this, so the current provider is running as cheaply as it can. Nothing
left to unblock; the only open item is the 2-week provider re-decision itself, once real usage
and eval data exist.

**Production default — Claude Haiku 4.5.** Same reasoning as before, restated because it still
holds:
1. **Persona consistency.** `SOUL.md` is a large, identity-heavy system prompt re-sent whole
   every turn, and staying in character as Coach Phelps across a long conversation is the whole
   point. Claude models are generally stronger at sustained persona adherence than same-tier
   competitors.
2. **Structured output fits the existing contract.** GA, schema-based, same
   `reply`/`commit_message`/`file_updates` shape `coach-chat.ts` already produces for Gemini —
   closer to a client-call swap than a response-handling rewrite.
3. **Prompt caching.** `SOUL.md` + `state.md` + `quest_log.md` get resent every turn; Claude's
   cache-hit pricing (10% of input rate) could cut effective cost well below the sticker price.

**Cheapest viable fallback — Kimi K2.5.** Real JSON schema support, prompt caching, roughly half
Haiku's price. Worth trying if cost becomes the actual binding constraint at 2-athlete scale.

**Not recommended:** DeepSeek, despite the lowest price on paper — its structured-output
reliability is the weak point for a product that hard-depends on schema-valid JSON every single
turn, and a malformed response breaks the chat flow, not just degrades quality. Also not
recommended right now: GPT-5.5 and Fable-5-tier flagship models — no usage volume today
justifies flagship pricing.

**Cost sanity check:** at hobby scale (2 athletes, sub-daily chat sessions) even Haiku 4.5 lands
in low single-digit dollars a month. Once off the Gemini free tier, this is a quality/fit
decision, not a budget one.

## Done when

Nothing to build — still a reference doc. Move on this when actually switching providers, not
before. The free-tier and pricing numbers above move fast; re-check Google's quota page and each
provider's pricing page before trusting exact figures more than a few months old.

## Deferred

- No provider-abstraction layer — `coach-chat.ts` stays a direct single-provider caller until a
  switch is actually decided.
- No ADR yet — provider choice isn't a locked architectural decision, per `kdb/decisions/README.md`.
  If/when a switch ships, that's when an ADR gets written.
