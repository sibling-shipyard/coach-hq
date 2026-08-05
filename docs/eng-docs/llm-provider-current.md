# Coach chat LLM provider

## Context

`coach-chat.ts` calls Gemini free tier (`gemini-flash-latest`) directly via raw `fetch`. Free-tier
limits (10 RPM, 1,500 RPD) block real testing with just 4 athletes. Need to unblock now; the
long-term provider call gets made in ~2 weeks once the system is robust enough to have real usage
data and an eval to judge it by.

## Options

Baseline: 4 athletes, ~8 turns/athlete/day → ~960 turns/mo, ~15K input + ~1.5K output tokens/turn
(SOUL.md + state.md + quest_log.md resent uncached every turn — see Caching below).

| Option | $/M in / out | Rate limit | Monthly cost (no cache) | With cache | Caching setup |
|---|---|---|---|---|---|
| Gemini free (today) | $0 | 10 RPM / 1,500 RPD | $0 | — | — |
| Gemini paid | $1.50 / $7.50 | 150–300 RPM / 1M TPM | $32.40 | ~$19 | code change |
| Claude Haiku 4.5 | $1.00 / $5.00 | ~50 RPM / 50K ITPM | $21.60 | ~$11 | code change (SDK swap) |
| GPT-5 mini | $0.25 / $2.00 | 500K TPM (tier 1) | $6.48 | ~$5 | **automatic, no code** |

DeepSeek deferred — cheapest on paper, but no published RPM/TPM (dynamic throttling, same
unpredictability we're leaving Gemini free tier for) plus a data-residency question for athlete
health data we haven't resolved. Not worth it at this volume regardless.

At 4 users, every paid option costs single-digit-to-low-double-digit dollars/month — cost isn't the
constraint. Rate-limit headroom and eventual model quality are.

## Caching

Prompt caching bills a repeated prefix at a fraction of full price. All three paid options support
it, but none of it works today because of one bug: `todayContextLine()` (`coach-chat.ts:133-149`,
"Today is `<date/time>`") sits right after `soul` in the system-instruction prefix, ahead of
`state.md`/`quest_log.md` — a value that changes every minute breaks any cache placed after it, on
any provider. Fix: move it to the end of the prompt (or into the per-turn user message) so
SOUL.md (+ state.md, which barely changes) stays a byte-identical, cacheable prefix.

Estimated ~1 day of work once we act on it — not required for the immediate unblock, since Gemini
paid handles 4-user volume fine uncached. Worth doing before the 2-week provider decision either
way, since it changes the cost story for whichever model wins.

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
2. Fix the `todayContextLine` prompt-ordering bug (small, provider-agnostic, do anytime).
3. Build the eval harness above.
4. Revisit provider choice in ~2 weeks against eval results + real usage numbers, not projections.

## Deferred

- DeepSeek — revisit only if cost becomes decisive at real scale, and only after the rate-limit and
  data-residency questions have real answers.
- Committing to Haiku/GPT-5-mini/Gemini-paid long-term — decided after the eval, not now.
