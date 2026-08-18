# Coach redesign review — Part 6: not wired in / UI-affecting leftovers

> Working doc for review, not a final eng-doc. Catch-all, scope narrowed to: fields/concepts
> dropped during review that made changes a UI rebuild will need to account for, or that are
> speculative/unused in the UI specifically. Implementation/wiring work lives in Part 5
> (`coach-redesign-part5-wiring-plan.md`) instead. Add to this as each part gets reviewed.

## From Part 1 (`coach_log.json`)

- **`actor`** — dropped from `coach_log.json`. Coach is the only writer today, so the field only
  ever holds one value. Revisit if a second writer (athlete, a backend job) is ever added.
- **`thread_id`** — dropped from `coach_log.json`. No current read/write path uses it.
- **`type: "phase_close" | "week_close"`** — real concept, no writer yet. Today Coach's
  end-of-phase and end-of-week retrospectives live in separate files
  (`archive/phases.md`, `archive/week_plans.md`, both named in `platform/soul/B_engine.md` and
  `platform/SOUL.claude.md`'s commit ritual). The redesign LLD's idea was to fold those into
  `coach_log.json` as rows with these `type` values instead of separate files — real, but out of
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

## From Part 2 (`quests.json` / `progress.json`)

- **`type: "progress"` — resolved, not deferred.** Restored after review: it's the only type
  covering a self-reported cumulative count not tied to a specific day or derivable from synced
  activity data (`mental-visualization`, `inner-game-of-tennis`). Kept in `quests.json`, `value`
  kept in `progress.json` to match. Nothing to revisit here.
- **`type: "milestone"`** — dropped outright, not moved here. Confirmed zero behavior anywhere in
  the codebase beyond being a valid enum value — not a deferred feature, dead weight, same
  treatment as `coach_log.json`'s `"manual"` type above.
- **`main_quest`'s `weekly_floor`/`loaded_floor`/`skill_weight`/`skill_cap`** — dropped from the
  generalized `quests.json`. These exist only for Akash's weekly-session-floor coaching model.
  Revisit if/when a per-athlete or per-model extension mechanism for `main_quest` is designed —
  not part of this pass.
- **`progress.json`'s `meta`** — dropped. Its only documented purpose (`weekly_sessions only:
  {label, kind, weight}`) is tied to `main_quest.sessions[]`, the same weekly-session-floor model
  whose other fields are already deferred above. Revisit together if that model ever gets a real
  extension mechanism.
- **`progress.json`'s `source: "athlete"`** — unconfirmed. `"model"` and `"pipeline"` are both
  real, confirmed writers; no direct athlete-write path into `progress.json` was found. Settle
  whether this value is real or should be dropped, separately from the field itself (which stays).
- **README for schema concepts** (quest `type` values, and anything else worth documenting once
  the whole redesign is settled) — needs a home in `user_data/`, for developers if not directly
  athlete-facing. Location TBD once parts 1-5 are fully reviewed.

## From Part 3 (`current_week.json`, `chat_history.json`)

- **`current_week.json`'s `week.phase_name`/`week.block_name` — resolved, not deferred.** Dropped
  from the file entirely (Part 3), same root cause as the SOUL "Phase Awareness" rewording already
  tracked under Part 2's entry above — one fix covers both once that lands.
- **`chat_history.json`'s `ageLabel`/`status`/`dayOffset` — resolved, not deferred.** All three
  dropped from the stored shape in Part 3 after review (dead in storage or already deprecated in
  the UI). Nothing to revisit here.

(The `current_week.json` daily-update requirement moved to Part 5 — that's implementation work
for whoever wires this file into coach-chat, not a UI-leftover item.)

## From workout-backend-wiring (`week_plan`/`session_reconcile` now live)

- **iOS's bundled offline template fallback (`BundledTemplates.swift`) drifting** now that
  templates are backend-generated per athlete rather than hand-authored and shipped with the app.
  iOS Builder's territory — revisit once the generic-library pipeline has run for real athletes.

## Your annotations

(space for anything else that falls out of parts 2-5 review)
