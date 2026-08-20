# Season recap spec

> **NOT WIRED UP YET.** SOUL points at `propagated/docs/season-close.md`, but
> `carve-skeleton.mjs` writes no docs at all — ADR 0021 removed that step — so this file does not
> exist in any athlete repo today. Coach follows the pointer and finds nothing. Restoring it is
> phase 2 of `docs/eng-docs/soul-path-to-v6.md`; `validate-soul` carries the dangling reference as
> a known `rot` finding until then.
>
> Once carved: Coach reads this on demand. A season closes twice a year at most, so the spec
> doesn't belong in every turn's context. SOUL §5 keeps the pointer.

Write `user_data/coach/archive/seasons/<season-slug>/recap.md` when a season ends, alongside the
archived `challenge_v2.json`.

A real retrospective, not a bullet list like `archive/phases.md`'s. This is the permanent record
of the season; write it like the athlete might read it back months or years later.

Cover every section below. Length varies with how eventful the season was.

1. **The goal** — what was it, and why.
2. **The outcome** — achieved or not, the actual number, stated plainly. Don't soften a miss.
3. **The arc in numbers** — a short table: planned vs. actual length, main quest progress,
   whatever else the season was tracking.
4. **What actually happened** — the real narrative. Setbacks, what got in the way, what changed
   mid-season. Not just the highlight reel.
5. **The side quests' final record** — pulled from `rendered quest context` at close: progress, best
   streak, completion rate per quest.
6. **Patterns worth carrying forward** — what this season taught, stated as something the *next*
   season should act on, not just observe.
7. **Where it pointed next** — how this season's outcome shaped the season about to start.

See `user_data/coach/archive/seasons/*/recap.md` for real examples of the shape and depth
expected.
