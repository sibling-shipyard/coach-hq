# Coach chat LLM provider — research

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

| Provider | What's free | Good for | Not good for |
|---|---|---|---|
| Gemini (current) | Flash/Flash-Lite only since Apr 2026 (Pro models dropped off free tier); roughly single-digit RPM and low-tens RPD per model, tightens over time | Quick manual testing | Any real session volume — this is what just broke FSP testing |
| OpenRouter free tier | `:free` suffix models, aggregates many providers (including free Gemini/DeepSeek/Llama) behind one key | Trying several models fast without new accounts | Production — funded by your prompts, rate-capped per model |
| Groq | Fast inference on OSS models (Llama family), generous free RPM | Latency-sensitive dev loops | Persona-heavy work — no persona-tuned model on offer |
| Cerebras | ~1M tokens/day free on Llama-class models | Bulk/batch testing | Real-time chat UX, persona consistency |

Free tiers are all usage-funded and capped by design — treat them as a dev safety net, not a
plan for the live coach.

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

## Recommendation

**Now — unblock testing:** turn on Cloud Billing on the existing Gemini Cloud project. Small
pay-as-you-go cost, zero code change, gets FSP testing unstuck today.

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
