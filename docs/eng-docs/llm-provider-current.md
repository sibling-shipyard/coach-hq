# Coach chat LLM provider

> Status: Current · Owner: Tech Lead · Verified: 2026-08-20

## Context

`coach-chat.ts` calls Gemini directly via raw `fetch` (`gemini-flash-latest`). **Unblocked:**
Cloud Billing is live on the project (confirmed 2026-08-06, AI Studio Billing page shows "Paid 1
· $250 Billing Account Tier Cap", ₹2,500 prepaid credit). The Rate Limit dashboard confirms Tier
1 is active — real testing is no longer rate-limited at this account's scale. See Options below
for the exact numbers. The long-term provider call still gets made in ~2 weeks, once the system
is robust enough to have real usage data and an eval to judge it by. Billing doesn't close that
question, it just removes the reason it was urgent.

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
health data we haven't resolved. Not worth it at this volume regardless.

At 4 users, every paid option costs single-digit-to-low-double-digit dollars/month — cost isn't the
constraint. Rate-limit headroom and eventual model quality are.

## Architecture — grounding these numbers in what the code actually sends

Verified against `ui/api/coach-chat.ts`: one Gemini call per turn, no separate/cheaper call for
anything. There is no more separate close-session detection step at all (C1 removed
`CLOSE_SESSION_PATTERN`/`session_closed` entirely — every turn just commits). The
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
provider though, and one of them needs no work at all.

- **Gemini:** implicit caching is on by default for every Gemini 2.5+ model, no code, no opt-in —
  90% off cached tokens, minimum cacheable prefix 1,024 tokens (well under our ~13K-token prefix).
  Confirmed via Google's own developer blog and API docs.
- **Claude:** explicit `cache_control` breakpoints — a real code change, but cached tokens are
  also excluded from the ITPM rate limit, not just cheaper, which raises effective throughput too.
- **GPT-5 mini:** automatic for prompts over 1,024 tokens, same as Gemini — no code change.

**Fixed.** `todayContextLine()` (`coach-chat.ts:133-149`, "Today is `<date/time>`") used to sit
right after `soul` in the system-instruction prefix, ahead of `state.md`/`rendered quest context` — a value
that changes every minute broke any cache placed after it. It's now the *last* element in the
`systemInstruction` array instead of the 3rd, so persona + instructions + state + quest_log stay
a stable, cacheable prefix and only the timestamp changes turn to turn. Same pass also added
3 worked few-shot examples inside that cached prefix — persona consistency, fewer
structured-output errors, cached so it's a one-time cost. It also added a hidden `reasoning`
field ahead of the JSON answer, stripped before the reply reaches the athlete.

**Also fixed:** in-thread history is now capped at `MAX_HISTORY_MESSAGES = 40` (was fully
unbounded — see Architecture above). SOUL is bundled from `platform/SOUL.chat.md` at build time
instead of being fetched from the athlete's own repo every turn (`ui/scripts/build-soul.mjs`) —
see the new ADR amending 0011 for the full rationale.

## Eval — how we actually pick, not vibes

**Harness built** (`ui/scripts/eval-coach-chat.ts`, `npm run eval:coach-chat`, 7 transcripts in
`ui/api/coach-chat/_tests/coach-chat-eval/transcripts/`): greeting, ordinary check-in, close-session happy
path, close-session with missing info (must ask, not fabricate a save), quest completion,
injury/sore flag handling, false-positive close-signal. It runs each transcript through the real
`askGemini()` and checks the *objective* rubric automatically: valid schema, no fabricated
"saved" language, every `file_updates` path is coach-writable and matches what the turn mode
allows, `session_closed` only true where expected.

**Not automated yet** — still manual/future work:
1. Voice/persona match to SOUL.md — needs a judge-model call per transcript (real added cost per
   run), a decision the athlete should weigh in on before it's default-on.
2. The full 15-25-transcript target from the original plan — 7 covers every code branch in
   `askGemini`/`resolveFileUpdate` for now; more are cheap to add once real usage data shows which
   scenarios matter most.
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
5. Revisit provider choice in ~2 weeks against eval results + real usage numbers, not projections
   — the only step left. Nothing else in this doc is blocking that anymore.

## Deferred

- DeepSeek — revisit only if cost becomes decisive at real scale, and only after the rate-limit and
  data-residency questions have real answers.
- Committing to Haiku/GPT-5-mini/Gemini-paid long-term — decided after the eval, not now.
