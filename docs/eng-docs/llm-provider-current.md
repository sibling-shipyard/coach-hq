# Coach chat LLM provider

## Context

`coach-chat.ts` calls Gemini free tier (`gemini-flash-latest`) directly via raw `fetch`. Free-tier
limits (5 RPM, 20 RPD — confirmed from this project's own AI Studio dashboard, see Options below)
block real testing with just 4 athletes. Need to unblock now; the
long-term provider call gets made in ~2 weeks once the system is robust enough to have real usage
data and an eval to judge it by.

## Options

Baseline: 4 athletes, ~8 turns/athlete/day → ~960 turns/mo, ~15K input + ~1.5K output tokens/turn
(SOUL.md + state.md + quest_log.md resent uncached every turn — see Caching below).

Rate limits below are verified against each provider's own docs (Aug 2026), not estimated —
several of the original numbers here were wrong or unverifiable and have been corrected:

| Option | $/M in / out | Rate limit (verified) | Monthly cost (no cache) | With cache | Caching setup |
|---|---|---|---|---|---|
| Gemini free (today) | $0 | **5 RPM / 250K TPM / 20 RPD** — confirmed from this project's own AI Studio dashboard, both 3.6 Flash and 2.5 Flash | $0 | — | — |
| Gemini paid | $1.50 / $7.50 | No static table published anymore (Google's own docs point to the live `aistudio.google.com/rate-limit` dashboard, not a fixed number) — check there after billing is on | $32.40 | ~$3.24 | **automatic, no code** |
| Claude Haiku 4.5 | $1.00 / $5.00 | **1,000 RPM / 2,000,000 ITPM / 400,000 OTPM** (Start tier, officially confirmed) | $21.60 | ~$11 | code change (`cache_control` breakpoints) |
| GPT-5 mini | $0.25 / $2.00 | **500,000 TPM** (Tier 1, officially confirmed; RPM not published — check console) | $6.48 | ~$5 | automatic, no code |

Corrections from the first draft: the free-tier row was a generic figure, not this account's
actual limit (20 RPD is the real ceiling, and the direct cause of Tuesday's/Wednesday's block).
Haiku's rate limit was quoting pre-July-2026 numbers — Anthropic raised it since; at this
project's volume Haiku has enormous headroom either way. Gemini paid's caching column was wrong —
Gemini's implicit caching is automatic and free, not a code change (see Caching below); that
changes its "with cache" cost from ~$19 to ~$3.24.

DeepSeek deferred — cheapest on paper, but no published RPM/TPM (dynamic throttling, same
unpredictability we're leaving Gemini free tier for) plus a data-residency question for athlete
health data we haven't resolved. Not worth it at this volume regardless.

At 4 users, every paid option costs single-digit-to-low-double-digit dollars/month — cost isn't the
constraint. Rate-limit headroom and eventual model quality are.

## Architecture — grounding these numbers in what the code actually sends

Verified against `ui/api/coach-chat.ts`: one Gemini call per turn, no separate/cheaper call for
anything (close-session detection is a plain regex, `CLOSE_SESSION_PATTERN`,
`coach-chat.ts:216-217`, not a model call — it just sets prompt `mode`; the model's own
`session_closed` field in that same response is what gates a commit). The `systemInstruction`
floor is real SOUL.md size: 49,716 bytes ≈ ~12,400 tokens, plus `state.md` + `quest_log.md`, sent
in full every turn (`coach-chat.ts:346-361`) — roughly matches the ~15K input tokens/turn assumed
above. Closing turns add four more full files on top (`coach-chat.ts:362-371`).

One real, currently-unaddressed risk worth fixing alongside the caching bug: **there's no cap on
conversation history within a thread** — the entire prior conversation resends every turn
(`coach-chat.ts:456-464`), only *thread count* is capped (7 threads,
`MAX_RETAINED_THREADS`, `coach-chat.ts:284`), not messages within one. A long single conversation
before close grows every subsequent request linearly, on top of the ~13K-token fixed prefix. This
is provider-agnostic and should be scoped alongside the eval work below.

## Caching

Prompt caching bills a repeated prefix at a fraction of full price — but the mechanism differs by
provider, and one of them needs no work at all:

- **Gemini:** implicit caching is on by default for every Gemini 2.5+ model, no code, no opt-in —
  90% off cached tokens, minimum cacheable prefix 1,024 tokens (well under our ~13K-token prefix).
  Confirmed via Google's own developer blog and API docs.
- **Claude:** explicit `cache_control` breakpoints — a real code change, but cached tokens are
  also excluded from the ITPM rate limit, not just cheaper, which raises effective throughput too.
- **GPT-5 mini:** automatic for prompts over 1,024 tokens, same as Gemini — no code change.

None of it works today, on any provider, because of one bug: `todayContextLine()`
(`coach-chat.ts:133-149`, "Today is `<date/time>`") sits right after `soul` in the
system-instruction prefix, ahead of `state.md`/`quest_log.md` — a value that changes every minute
breaks any cache placed after it. Fix: move it to the end of the prompt (or into the per-turn user
message) so SOUL.md (+ state.md, which barely changes) stays a byte-identical, cacheable prefix.

**This is the highest-leverage fix in this whole doc.** It's ~1 day of work, it's provider-agnostic,
and on the current Gemini setup it's genuinely free — no migration, no eval, no SDK swap. It pays
off *today's* provider before any provider-choice question even needs answering, so it shouldn't
wait for the 2-week decision — do it alongside enabling billing, not after.

## Eval — how we actually pick, not vibes

1. Build ~15–25 golden transcripts covering: greeting, ordinary check-in, close-session happy path,
   close-session with missing info (must ask, not fabricate a save), quest completion, injury/sore
   flag handling, false-positive close-signal.
2. Rubric: voice/persona match to SOUL.md, never claims "saved" without real `file_updates`,
   edits/merge-patches are schema-valid, doesn't touch files outside the turn-mode's allowed set.
3. Run the same transcripts through whichever candidates are still live at the 2-week mark; score
   with a mix of judges (not just one model family) plus a human spot-check, to avoid the
   same self-preference risk that showed up in this doc's first draft.

## Done when

4 athletes can chat-test without hitting a rate ceiling, and we have eval scores + real usage data
to make the long-term provider call.

## Next steps

1. Enable billing on the existing Gemini project — unblocks testing today, zero code change.
2. Fix the `todayContextLine` prompt-ordering bug — do this at the same time as step 1, not
   later. It's free savings on the current provider (Gemini's caching is automatic, no migration
   needed), independent of the eval or the provider decision.
3. Cap/window in-thread conversation history — currently unbounded (see Architecture above);
   provider-agnostic, worth doing alongside step 2.
4. Build the eval harness above.
5. Revisit provider choice in ~2 weeks against eval results + real usage numbers, not projections.

## Deferred

- DeepSeek — revisit only if cost becomes decisive at real scale, and only after the rate-limit and
  data-residency questions have real answers.
- Committing to Haiku/GPT-5-mini/Gemini-paid long-term — decided after the eval, not now.
