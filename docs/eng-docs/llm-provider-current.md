# Coach chat LLM provider

> Status: Current · Owner: Tech Lead · Verified: 2026-09-15

**Live status, 2026-09-15: production itself now runs on OpenRouter, `google/gemini-3.8-flash`.**
The athlete set `LLM_PROVIDER=openrouter` and `OPENROUTER_API_KEY` directly in Vercel's Production
environment on 2026-09-05, and removed `GEMINI_API_KEY` from Vercel entirely. Confirmed in the
Vercel dashboard, then cross-checked against real runtime data (`get_runtime_errors`/
`get_runtime_logs`): one isolated rate-limit 429 cluster 2026-09-05 through 2026-09-10. Nothing
since, clean in the last 24h. This was a real switch, not a dev-account credit workaround - the
paragraph below describing `gemini-pro-latest` as the production default is stale and describes
the state before this switch. No ADR exists for this change yet. It's a locked/architectural
decision (provider + model, not just a dev testing workaround) and should get one - see
`kdb/decisions/README.md`.

This dev environment's own `GEMINI_API_KEY` (in `ui/.env.local`, separate from Vercel's) also has
no credit right now. Local live/manual/eval/simulation-suite runs need `LLM_PROVIDER=openrouter`
too - a direct-Gemini call here fails or silently no-ops depending on the call path, not a clean
error. That part of this doc's original "live status" note still holds; only the production-default
claim below it was overtaken by the Vercel switch.

## Context

`coach-chat.ts` reaches Gemini through the shared seam (`ui/api/_lib/llmClient.ts`'s
`selectLlmAdapter`, #713 M2) rather than opening its own socket - every direct-Gemini caller in
the codebase (chat, coach-message, template adjustment) does now. `LLM_PROVIDER` unset/`gemini`
resolves to the direct adapter (`_lib/llmAdapters/geminiAdapter.ts`); `LLM_PROVIDER=openrouter`
resolves to `_lib/llmAdapters/openRouterAdapter.ts`, pinned to `google/gemini-3.8-flash`. **As of
2026-09-15, production's real `LLM_PROVIDER` is `openrouter`** (see Live status above) - the
`gemini-pro-latest` pin in `ui/api/_lib/geminiModel.ts` is real code, but it's now dead in
production specifically because `LLM_PROVIDER` routes past it, not because the pin itself changed.
Flash was the originally intended model back when direct Gemini was the default. It moved off
after capacity failures (#668) at the time - that finding was about direct-Gemini Flash
specifically, not Flash-via-OpenRouter. OpenRouter is a different rate-limit/routing path
(this project's OpenRouter key is pinned to Vertex, per `chat-provider-bench.md`) and hasn't shown
the same failure pattern in real production traffic so far. **This means the Options table below
does not describe today's real production cost path.** It's priced against Flash's per-token rate
through direct Gemini, written before both the flash-to-pro pin and the later pro-to-OpenRouter-
flash switch, and never re-priced for either. Re-verify OpenRouter's own rate
limits/pricing at real production volume before treating this table as current. See
`GEMINI-PRO-BASELINE-2026-09-10.md` for the reliability findings from testing directly against
pro, and the 2026-09-15 live coverage pass (issue #1067) for the most recent real findings against
exactly what's in production now.
**Unblocked:**
Cloud Billing is live on the project, confirmed 2026-08-06 — the AI Studio Billing page shows
"Paid 1 · $250 Billing Account Tier Cap" against ₹2,500 prepaid credit. The Rate Limit dashboard
confirms Tier 1 is active, so real testing is no longer rate-limited at this account's scale. See Options
below for the exact numbers. The long-term provider call still gets made in ~2 weeks, once there is real usage data and an
eval to judge it by. Billing does not close that question. It removes the reason it was urgent.

## Options

Baseline: 4 athletes, ~8 turns/athlete/day → ~960 turns/mo, ~15K input + ~1.5K output tokens/turn
(SOUL.md + state.md + rendered quest context resent uncached every turn — see Caching below).

Rate limits below are verified against each provider's own docs (Aug 2026), not estimated —
several of the original numbers here were wrong or unverifiable and have been corrected:

| Option | $/M in / out | Rate limit (verified) | Monthly cost (no cache) | With cache | Caching setup |
|---|---|---|---|---|---|
| Gemini free (superseded) | $0 | 5 RPM / 250K TPM / 20 RPD, both 3.6 Flash and 2.5 Flash | $0 | — | — |
| **Gemini paid (live now)** | $1.50 / $7.50 | **1,000 RPM / 2,000,000 TPM / 10,000 RPD** (3.6 Flash, Tier 1) · **1,000 RPM / 1,000,000 TPM / 10,000 RPD** (2.5 Flash, Tier 1) — confirmed from this project's own AI Studio Rate Limit dashboard, 2026-08-06 | $32.40 | ~$3.24 | **automatic, no code** |
| Claude Haiku 4.5 | $1.00 / $5.00 | **1,000 RPM / 2,000,000 ITPM / 400,000 OTPM** (Start tier, officially confirmed) | $21.60 | ~$11 | code change (`cache_control` breakpoints) |
| GPT-5 mini | $0.25 / $2.00 | **500,000 TPM** (Tier 1, officially confirmed; RPM not published — check console) | $6.48 | ~$5 | automatic, no code |

At this account's actual volume (4 athletes, ~960 turns/mo, well under 10,000 RPD), Gemini paid
now has enormous headroom on every dimension — RPM and TPM are effectively non-issues, RPD is
~500x this project's daily turn count.

Corrections from the first draft: the free-tier row was a generic figure, not this account's
actual limit (20 RPD was the real ceiling, and the direct cause of the original block). Haiku's
rate limit was quoting pre-July-2026 numbers — Anthropic raised it since; at this project's
volume Haiku has enormous headroom either way. Gemini paid's caching column was wrong —
Gemini's implicit caching is automatic and free, not a code change (see Caching below); that
changes its "with cache" cost from ~$19 to ~$3.24.

DeepSeek deferred — cheapest on paper, but no published RPM/TPM (dynamic throttling, same
unpredictability we're leaving Gemini free tier for) plus a data-residency question for athlete
health data we haven't resolved. Not worth it at this volume regardless. **Both blockers now have
partial answers**, measured 2026-09-05 through OpenRouter rather than direct. The account's ZDR
policy refuses 5 of the model's 15 provider endpoints outright, answering data residency by
enforcement rather than by promise. Pinning a provider replaces dynamic-throttling roulette with
one known host, at the cost of that host's own rate limit and no fallback. Measured numbers
are in `docs/plans/chat-openrouter-migration.md`.

At 4 users, every paid option costs single-digit-to-low-double-digit dollars/month — cost isn't the
constraint. Rate-limit headroom and eventual model quality are.

## Architecture — grounding these numbers in what the code actually sends

Verified against `ui/api/coach-chat.ts`: one model call per turn through the `llmClient` seam, no
separate/cheaper call for anything. There is no more separate close-session detection step at all
(C1 removed `CLOSE_SESSION_PATTERN`/`session_closed` entirely — every turn just commits). The
`systemInstruction` floor is real SOUL.md size: ~49,700 bytes ≈ ~12,400 tokens, plus `state.md` +
`rendered quest context`, sent in full every turn — roughly matches the ~15K input tokens/turn
assumed above. A turn whose reply asks for a template/session-artifact write pays for the
templates manifest and `current_week.json` on top of that, fetched lazily only when needed.

**Fixed:** conversation history within a thread is now capped at `MAX_HISTORY_MESSAGES = 40`
(previously the entire prior conversation resent every turn, unbounded — only *thread count* was
capped at 7, `MAX_RETAINED_THREADS`). **Fixed:** SOUL.md is no longer fetched from the athlete's
own repo on every turn either — see Caching below.

## Caching

Prompt caching bills a repeated prefix at a fraction of full price. The mechanism differs by
provider, and one of them needs no work at all.

- **Gemini:** implicit caching is on by default for every Gemini 2.5+ model, no code, no opt-in —
  90% off cached tokens, minimum cacheable prefix 1,024 tokens (well under our ~13K-token prefix).
  Confirmed via Google's own developer blog and API docs. **Measured behaviour does not match that
  description on the coach-message path.** Two prompts sharing a 6,876-token prefix, differing only in their tail, returned
  `cached_tokens: 0` on the second. A discount appeared only when the whole prompt repeated byte
  for byte. Measured 2026-09-05 on `google/gemini-3.8-flash` through OpenRouter, pinned to Vertex;
  the measurement is in `docs/eng-docs/chat-provider-bench.md`. Chat runs a different
  path — direct AI Studio, not Vertex — so this does not disprove the row above for chat. It does
  mean **nobody should assume the prefix discount without measuring it on their own path**, with a
  varying tail.
- **Claude:** explicit `cache_control` breakpoints — a real code change, but cached tokens are
  also excluded from the ITPM rate limit, not just cheaper, which raises effective throughput too.
- **GPT-5 mini:** automatic for prompts over 1,024 tokens, same as Gemini — no code change.

**Fixed.** `todayContextLine()` (`coach-chat.ts:133-149`, "Today is `<date/time>`") used to sit
right after `soul` in the system-instruction prefix, ahead of `state.md`/`rendered quest context` — a value
that changes every minute broke any cache placed after it. It's now the *last* element in the
`systemInstruction` array instead of the 3rd, so persona + instructions + state + quest_log stay
a stable, cacheable prefix and only the timestamp changes turn to turn. The same pass added 3 worked
few-shot examples inside that cached prefix, for persona consistency and fewer structured-output
errors; they are cached, so they cost once. It also added a hidden `reasoning` field ahead of the
JSON answer, stripped before the reply reaches the athlete.

**Also fixed:** in-thread history is now capped at `MAX_HISTORY_MESSAGES = 40`, having been
fully unbounded (see Architecture above). SOUL is bundled from `platform/SOUL.chat.md` at build
time by `ui/scripts/build-soul.mjs`, rather than fetched from the athlete's own repo every turn.
The ADR amending 0011 carries the full rationale.

## Eval — how we actually pick, not vibes

**Harness** (`ui/eval/eval-coach-chat.ts`, `npm run eval:coach-chat`) - see
[`coach-chat-testing.md`](coach-chat-testing.md) for the current, accurate description of the
suite (14 diagnosed transcripts as of G1/#670, the closing-turn concept C1 removed no longer
exists to test, `session_closed` is gone from the schema). This section only tracks the
provider-decision angle below, not the suite's own shape.

**Not automated yet** — still manual/future work:
1. Voice/persona match to SOUL.md — needs a judge-model call per transcript (real added cost per
   run), a decision the athlete should weigh in on before it's default-on.
2. More transcripts as real usage data shows which scenarios matter most.
3. Multi-judge scoring across model families (to avoid the same self-preference risk that showed
   up in this doc's first draft) — depends on #1 existing first.

## Done when

~~4 athletes can chat-test without hitting a rate ceiling~~ — **done**, billing is live (see
Context above). Eval scores + real usage data to make the long-term provider call are still
pending — that's the one thing left before this doc's job is finished.

## Next steps

1. ~~Enable billing on the existing Gemini project~~ — **done**, 2026-08-06.
2. ~~Fix the `todayContextLine` prompt-ordering bug~~ — **done.**
3. ~~Cap/window in-thread conversation history~~ — **done** (hard cap; real
   compaction/summarization is still future work, blocked on real usage data - tracked in issue #572).
4. ~~Build the eval harness~~ — **done**, structural rubric only (see Eval above).
5. ~~Revisit provider choice in ~2 weeks~~ — **in progress, 2026-09-10**: a full one-day pro
   baseline pass (`GEMINI-PRO-BASELINE-2026-09-10.md`) plus an OpenRouter/flash/DeepSeek retest
   (`OPENROUTER-K1-RETEST-FINDINGS.md`) both ran. Current plan: merge the reliability-fix stack
   this both produced, stay on direct pro in production a while longer, gather more real usage
   data, then make the provider call - not deciding today on projections alone. The Options table
   above still needs re-pricing against pro specifically before that decision (see Context).

## Deferred

- DeepSeek — revisit only if cost becomes decisive at real scale. The rate-limit and data-residency
  questions now have partial answers (see Options); what is still missing is a contract probe and a
  provider allow-list, tracked under #713.
- Committing to Haiku/GPT-5-mini/Gemini-paid long-term — decided after the eval, not now.
