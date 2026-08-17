# Coach redesign review — Part 4: prompting architecture

> Working doc for review, not a final eng-doc. Delete or fold into `docs/eng-docs/` once you've
> annotated it and we've implemented. Comes last on purpose: several of its recommendations (a
> per-athlete cache tier, windowed reads) are about the new files Parts 1-3 create, so this is
> scoped against the redesigned architecture, not the current one. Companion docs:
> `coach-redesign-part1-memory.md` (state.md split), `part2-ledger.md` (challenge_v2.json split),
> `part3-rollout.md` (everything else).

## What we actually have today

`ui/api/coach-chat/_lib/`:
- **`coachPrompt.ts`** — `staticSystemText()` (persona + fixed instructions + 2 few-shot examples,
  uploaded once via explicit caching) and `buildDynamicText()` (state.md + quest_log + mode
  instructions + `extraContext` + today's date, sent fresh every turn). Response schema:
  `{coach_note?, session_closed?, reply}`, `required: ["reply"]`, `maxOutputTokens: 2048`.
- **`geminiClient.ts`** — builds the request (cached vs. inline system instruction), one retry on
  a stale-cache 400 or a 503/timeout, no retry on anything else.
- **`soulCache.ts`** — explicit per-model cache of the static block, keyed by content hash, backed
  by Vercel Edge Config.
- **`coachIntents.ts`** — pure appliers (`applyRollingState` so far) for facts Gemini reports.

That's already a two-layer split (static/cacheable vs. dynamic/per-turn), which is the basic form
of "layered prompting." What it *isn't* yet: layered by **audience** (every layer currently goes
to every turn) or by **mode** (greeting/ordinary/closing share one dynamic-block shape, branching
inside `buildDynamicText`'s ternary rather than composing separate instruction layers).

## Failure history that should drive every recommendation below

Three fields have independently triggered the same failure mode — a runaway repetition loop that
burns the output budget on degenerate rambling, sometimes taking `session_closed` down with it:
`reasoning` (removed first), `title` (removed second, same symptom), `session_note` (tried during
this redesign's step 2, pulled after one live reproduction). The one field that's been reliable
across dozens of real closes is `coach_note` — short, single-purpose, declared early in the
schema. **Every recommendation below is filtered through this: does it add another free-text
field competing for the model's attention, or does it constrain the ask further?** The former is
the actual demonstrated risk in this app, not a hypothetical.

## Research areas

### 1. Layered prompting — where we already are vs. where the redesign could take it

Current layering is *content*-based (static vs. dynamic). The redesign's own step 4 (size tiers:
always / closing-only / on-demand) is layering by **access frequency** — a third axis. Once
`profile.json`/`memory.json` exist as their own files (Part 1), they're natural candidates for a
**third cache tier**: near-static per-athlete content (changes rarely) sitting between the
fully-shared SOUL cache and the fully-fresh chat history. Gemini's explicit caching supports this
today — nothing here needs new infra, just a second `cachedContents` entry keyed by
athlete+content-hash instead of one shared entry. Worth scoping as part of Part 1's `memory.json`
work, not deferred to step 4 — the file split *is* what makes it possible.

Recommend **against** extending layering to instructions themselves (a per-mode instruction file
loaded separately) — `buildDynamicText`'s ternary is already effectively that, just as inline
branches instead of separate files. Splitting it into files buys organization, not reliability or
cost; not worth the churn given the real risk area is schema fields, not instruction structure.

### 2. Structured output reliability

The field-ordering theory (commitment fields before narrative `reply`) is validated by real
evidence now, not just theory — worth writing that up explicitly as a standing rule the moment a
new field is proposed (Part 1/2 will each add one). One thing *not* yet tried: whether a closing
turn's ask is fundamentally too large for one schema once it has multiple fact fields (Part 2
adds `quest_event`, Part 1 may add a session-log entry) — **sequential smaller calls** (one call
per fact type, each with a 1-2 field schema) is a real alternative to a single wide schema, at the
cost of extra round-trips and losing shared context across the calls in one response. Flag as a
genuine open question for Part 1/2, not a settled recommendation — needs a real A/B against the
actual failure rate once there's more than one fact field live again.

### 3. Caching strategy

Already covered under layered prompting above — a per-athlete cache tier for `profile.json` +
`memory.json` is the concrete win here, once those files exist.

### 4. Context window / selective injection

Today: `state.md` (up to 14KB) + `quest_log.md` sent whole, every turn, regardless of mode. The
redesign's file split is what makes selective injection possible at all — right now there's
nothing to select, it's one file. Real recommendation: once `sessions.json` exists (Part 1),
**don't send the whole log every turn** — send only the last-N window (mirrors what
`rolling_state.json` already does) on ordinary turns, and only pull older entries in on a closing
turn if a "look back further" need is actually detected. This is Akash's step 4 in spirit, landed
early because the sessions log is the fastest-growing file of the bunch and the one most likely to
matter for token cost within weeks, not quarters.

### 5. Guardrail/reliability patterns

- **Retry-with-repair** (re-ask with the malformed output + "fix this" instruction) vs. today's
  blind retry (re-run the same request): worth trying specifically for the JSON-truncation failure
  mode (seen live this session — "Unterminated string in JSON"), since a blind retry re-triggers
  the same repetition-loop risk while a repair prompt could ask directly for a shorter response.
  Scope as a small, isolated change to `finishGeminiResponse`'s error handling — doesn't touch the
  schema, low risk to try.
- **Prompt-injection defense**: the athlete's own message reaches Gemini unfiltered inside
  `contents` (by design — it's a coaching conversation). Real risk surface is narrow (single-user
  chat, no shared/multi-tenant prompt, no tool-calling to exploit) — not worth building defenses
  against a threat model that doesn't apply here. Flagging as considered-and-rejected, not
  overlooked.
- **Self-consistency / verification passes** (asking the model to double-check its own output
  before returning): the honesty-guard/retry mechanism from the old design already tried something
  like this and it's currently deferred (BACKLOG-equivalent, Part 3). Don't re-introduce until the
  simpler fields (coach_note, whatever Part 1/2 add) show a real unreliability rate that
  demonstrates a guard is worth its added complexity and cost.

### 6. Multi-turn state management

`MAX_HISTORY_MESSAGES = 40` is a hard window, no summarization. For a daily check-in/close-out
usage pattern (SOUL's actual design), 40 messages is generous — a single day's conversation
essentially never hits it. Not worth building summarization-on-overflow now; revisit only if usage
data ever shows real sessions running long. The close/no-close state machine
(`isCloseSignal`/`wasCloseAttemptPending`) is a deterministic trigger, not model-driven — already
the right shape (a close is too consequential to leave to the model noticing on its own), no
change recommended.

## Changes I'm flagging for your review
1. Per-athlete cache tier for `profile.json`/`memory.json` — pull forward from step 4 into Part 1,
   since the file split enables it directly.
2. Sequential-smaller-calls vs. one-wide-schema for closing turns with multiple fact fields — open
   question, not a decision; needs real failure-rate data once Part 1/2 land a second fact field.
3. Windowed `sessions.json` reads (not the whole log every turn) — pull forward into Part 1 rather
   than waiting for step 4, since it's the fastest-growing file.
4. Retry-with-repair for JSON-truncation specifically — small, isolated, worth trying regardless
   of the rest of this redesign's timeline.

## Your annotations

**Deferred as a whole, per your call.** None of the six research areas or four flagged changes
get decided here. Building a cache tier, choosing retry strategy, or deciding sequential-vs-wide
schema calls is optimizing a system that doesn't exist yet — Parts 1-3/5 aren't implemented, so
there's no real failure-rate data or usage pattern to decide any of this against. Revisit all of
it in Part 6 (`coach-redesign-part6-wiring-plan.md`) once the restructure is actually running —
that's where these decisions get made for real, informed by what's built, not guessed at now.
