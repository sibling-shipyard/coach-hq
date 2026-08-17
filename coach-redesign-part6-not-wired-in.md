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
  **Note:** Part 2 has since dropped the `phase` concept from `seasons.json` entirely — `"phase_close"`
  as a row type may no longer make sense once that lands. Revisit both together.
- **`type: "manual"`** — dropped outright, not moved here. No design existed behind it anywhere
  in the LLD, SOUL, or code — not a deferred feature, just dead weight.

## From Part 2 (`seasons.json`)

- **Resolved, not deferred:** no archive folder at all. A completed/retired season stays in
  `seasons[]` with `status` flipped, ordered newest-first. `status: "active" | "completed" |
  "retired"` does real work under this design — nothing to revisit here.
- **`phase` (and `current_block`) dropped entirely from `seasons.json`.** This removes SOUL's
  "Phase Awareness" behavior (`B_engine.md` §5b) as it exists today. Rectifying SOUL's wording and
  the five UI files that read `phase`/`current_block` (`calisthenicsLensModel.ts`,
  `warmHomeSnapshots.ts`, `liveWeekContract.ts`, `warmHomeModel.ts`, `MonthlyAnalytics.tsx`) is
  real follow-up work, not done as part of this doc pass.

## From Part 2 (`quests.json`)

- **`type: "progress"`** — dropped from the generalized `quests.json`. Two live quests use it
  today (`mental-visualization`, `inner-game-of-tennis`, both "N/target unit" trackers) — real
  usage, doesn't map cleanly onto the generalized shape as-is. Revisit if a generalized
  numeric-progress quest type is needed later.
- **`type: "milestone"`** — dropped outright, not moved here. Confirmed zero behavior anywhere in
  the codebase beyond being a valid enum value — not a deferred feature, dead weight, same
  treatment as `sessions.json`'s `"manual"` type above.
- **`main_quest`'s `weekly_floor`/`loaded_floor`/`skill_weight`/`skill_cap`** — dropped from the
  generalized `quests.json`. These exist only for Akash's weekly-session-floor coaching model.
  Revisit if/when a per-athlete or per-model extension mechanism for `main_quest` is designed —
  not part of this pass.
- **README for schema concepts** (quest `type` values, and anything else worth documenting once
  the whole redesign is settled) — needs a home in `user_data/`, for developers if not directly
  athlete-facing. Location TBD once parts 1-5 are fully reviewed.

## Your annotations

(space for anything else that falls out of parts 2-5 review)
