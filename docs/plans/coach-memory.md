# Coach memory — what backs "Coach knows me"

> Status: Current · Owner: Tech Lead · Verified: 2026-08-15

Pre-design. Captures what the SOUL v5.7 audit found about Coach's memory, so it isn't
re-derived. The design lands when this work starts — see `docs/eng-docs/soul-path-to-v6.md`,
thread 2.

## Why this matters

Asked what he'd miss most if it all vanished tomorrow, the athlete said: *"just talking to
coach. Coach knows me for 4-5 months now, understands and helps me stay on track despite a busy
life."*

That is the product. Everything else in SOUL is apparatus around it. So it's worth knowing
exactly what backs it — and the answer is thinner than the architecture implies.

## What actually holds the memory

```
state.md          ← read every session. Learned Patterns, Coaching Priorities,
                    Fitness Baseline. Hand-curated by Coach. Doing all the work.
   Recent Session Notes  ← capped at the LAST 3 SESSIONS
coach_notes.md    ← 5 months of observations. Never read.
```

- **`state.md` is the whole memory.** It's read every turn in both runtimes, and its
  Learned Patterns / Coaching Priorities sections are where continuity actually lives.
- **Recent Session Notes is capped at 3.** Session 200 has no more history available to it than
  session 20. Memory doesn't compound.
- **`coach_notes.md` is never read.** §1 says don't read it at boot; §2 lists it as on-demand
  only; the app tells Coach outright: *"You never see or need to see coach_notes.md's current
  content"* — the server appends a `coach_note` and Coach never opens the file.

## The design is sound; one half was never built

Append-only journal + curated summary + periodic distillation between them is a good memory
architecture. The journal exists. The summary exists. **The distillation step is not written down
anywhere in SOUL.** Checked all three places it would live:

| Where it would go | What it actually says |
|---|---|
| §2 guardrails | read `coach_notes.md` on-demand "when investigating a long-term pattern" — reactive, athlete-initiated |
| §5 closing a phase | write a retrospective. Never says read the notes first |
| §5 closing a season | pull the side-quest record from `rendered quest context`. Never mentions the notes |

**And it worked, once, by hand.** From three PRE data points in April 2026, Coach drew an insight
and promoted it into `state.md`'s Learned Patterns:

> *"Low PRE override (Apr 20): PRE 4 'mind too scattered from work' → 5W-2L + rank #4. Poor
> pre-state can be overridden by an intentional strategy going in — it is not a ceiling."*

That line is still shaping how Coach reads the athlete in August — **the conclusion outlived its
signal by four months**, and PRE itself is being cut. One manual pass, real durable value. The
mechanism is right; it just never runs.

## Two pieces

**1. Rhythms digest.** A computed summary of training, the way `rendered quest context` is a computed
summary of quests. Pipeline writes it, Coach reads it read-only, SOUL says don't compute it
yourself.

- Data exists: 894 activities in `coach-akash` back to Jan 2024 (254 / 296 / 282 across 2024–26),
  each carrying `sport_type`, `moving_time`, `start_date_local`, `average_heartrate`,
  `max_heartrate`, `calories`, and a `description` holding RPE notes.
- Works in both runtimes with no new capability, and **doubles as the activity history the app is
  missing** — so it partly pays for thread 1.
- A script won't hallucinate a number; a model summarising 900 activities will.
- `ui/client/src/components/monthly-analytics/monthlyAnalyticsModel.ts` already computes month
  overviews, sport breakdowns, VO2 and sleep models. Client-side TS producing UI models, so not
  directly reusable — but the logic is worked out and validated against real data.

Candidate contents, aimed at conversation rather than statistics: sessions/week trended by month;
sport mix and how it shifted; day-of-week and time-of-day rhythm; longest streak and longest gap
**with dates** (the gaps are the conversation); strong vs weak months; session length and average
HR drift per sport.

**2. Compaction pass.** Coach reads its own journal, finds durable patterns, promotes them into
`state.md`. Write the instruction that was never written — and give it a trigger that fires.

## Open question — the trigger

Phase and season close were the natural hooks and both are dead ends: unreachable in the app
(`archive/**` isn't in the writable set), and in BYOB they fire a few times a year with nothing
prompting them. Same failure shape as the deload rule — a good mechanism hung on a moment that
doesn't reliably arrive.

Needs an answer before this is buildable. Options not yet weighed: elapsed sessions since last
compaction, `coach_notes.md` exceeding a size threshold, a fixed cadence, or the athlete asking.

## Prototype before it touches SOUL

Deciding what counts as a pattern worth surfacing is judgment the script has to encode, and
getting it wrong produces noise Coach reads out faithfully. Write the generator, run it against
the real 894 activities, read the output together. **If the digest doesn't tell the athlete
something true about their own training, it won't help anyone else.**

Ownership: generator in `engine/scripts/` (Bob), injection in `ui/api/` (UI Expert), a few lines
in SOUL. Not part of the v5.8 trim PRs.

## Later, not now

- **The athlete's own words.** `state.md` and `coach_notes.md` hold Coach's summaries of the
  athlete. For a memory system the verbatim matters — *"I'm scared of getting injured again"*
  carries something *"athlete reports injury anxiety"* doesn't. Cheap to keep a thin thread of
  real quotes; belongs with v7's memory work.
