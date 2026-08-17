# Coach redesign review — Part 6: not wired in yet

> Working doc for review, not a final eng-doc. Catch-all for fields/concepts dropped from parts
> 1-4 during review that aren't ready to ship now but shouldn't be forgotten either — either
> because nothing writes them yet, or because they need more design before they're real. Add to
> this as each part gets reviewed.

## From Part 1 (`sessions.json`)

- **`actor`** — dropped from `sessions.json`. Coach is the only writer today, so the field only
  ever holds one value. Revisit if a second writer (athlete, a backend job) is ever added.
- **`thread_id`** — dropped from `sessions.json`. No current read/write path uses it.
- **`type: "phase_close" | "week_close"`** — real concept, no writer yet. Today Coach's
  end-of-phase and end-of-week retrospectives live in separate files
  (`archive/phases.md`, `archive/week_plans.md`, both named in `platform/soul/B_engine.md` and
  `platform/SOUL.claude.md`'s commit ritual). The redesign LLD's idea was to fold those into
  `sessions.json` as rows with these `type` values instead of separate files — real, but out of
  scope for this pass. Revisit when/if `archive/phases.md`/`archive/week_plans.md` get folded in.
- **`type: "manual"`** — dropped outright, not moved here. No design existed behind it anywhere
  in the LLD, SOUL, or code — not a deferred feature, just dead weight.

## Your annotations

(space for anything else that falls out of parts 2-5 review)
