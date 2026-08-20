# Coach redesign review — Part 6: not wired in / UI-affecting leftovers

> Working doc for review, not a final eng-doc. Catch-all, scope narrowed to: fields/concepts
> dropped during review that made changes a UI rebuild will need to account for, or that are
> speculative/unused in the UI specifically. Implementation/wiring work lives in Part 5
> (`coach-redesign-part5-wiring-plan.md`) instead. Add to this as each part gets reviewed.

## Stack-wide: real end-to-end verification, once, after part 11 lands

Every PR in the SOUL-catchup stack (#435 → part 8 → part 9 → part 10 → part 11) has been verified
mechanically per-PR — unit tests, `tsc --noEmit`, `compose-soul.mjs --check` where relevant — but
**nothing in the whole stack has been run against a real athlete repo yet.** No real
`gen/athlete_insights.json` has been generated from real activity history, no actual rendered
Gemini prompt/context has been inspected, no live chat turn has happened, no browser has opened
the dashboard against a migrated repo. This has been flagged PR by PR (#439, #443) as a known gap
rather than blocking each individual PR — but it needs to actually happen once, for the stack as a
whole, before calling this effort done. Do this after part 11 merges (or is ready to merge), not
before — SOUL needs to be in its final state for this to be a meaningful end-to-end check, not a
partial one that gets re-run again anyway once part 11 lands:

1. Fresh scratch branch off a real athlete repo (per the verification discipline in
   `coach-redesign-part4b-fsp-reliability.md`).
2. Run the sync/generator pipeline for real (the GitHub Actions sync workflow, or the equivalent
   local scripts) so `gen/dashboard_snapshot.json` and `gen/athlete_insights.json` are real,
   generated output, not synthetic test fixtures.
3. A full first session (fresh athlete) and a few turns of ordinary chat (returning athlete) via
   the hosted chat API, checking real committed files via the GitHub API after each turn, not
   trusting reply text.
4. Open the webapp dashboard against that migrated repo and confirm quest/season widgets actually
   render (this is the literal bug #439 fixed — confirm it stays fixed against real data, not just
   the unit-test fixtures that already pass).
5. Confirm the rendered Fitness Snapshot section (part 10) actually reads sensibly for a real
   athlete's real activity mix, and that Coach's FSP behavior (part 11's SOUL rewrite) references
   it the way the new SOUL text says it should.
6. BYOB, separately: a first session and ordinary chat via Claude Code against the same or a
   different scratch branch, confirming part 11's SOUL text works for the terminal runtime too,
   not just hosted chat.

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

(The `current_week.json` daily-update requirement — resolved, not deferred. `session_reconcile`
(workout-backend-wiring §5) patches the matching session's status/completion immediately on a
logged workout, not deferred to a weekly rewrite. Nothing left to revisit here.)

## From workout-backend-wiring (`week_plan`/`session_reconcile` now live)

- **iOS's bundled offline template fallback (`BundledTemplates.swift`) drifting** now that
  templates are backend-generated per athlete rather than hand-authored and shipped with the app.
  iOS Builder's territory — revisit once the generic-library pipeline has run for real athletes.

## From part 9 (`dashboard_snapshot.json`/`generate_quest_log.py` retirement, PR #439)

Found during PR #439 review, deliberately deferred rather than fixed in that PR (out of scope,
not blocking):

- **Stale doc references to `quest_log`/`aggregate`, outside `platform/soul/`**:
  `docs/plans/coach-intent-schema.md` still says to regenerate a quest log; several older
  design/history docs still use "quest log" or "aggregate" terminology. Mostly historical
  (`docs/plans/` is delete-on-ship anyway — see `AGENTS.md`), not runtime instructions. Fix
  opportunistically if you're already touching one of these files for something else; not worth a
  dedicated pass.
- **Naming-only cosmetics, not bugs, don't bother**: UI code has local variables still named
  `aggregate`; ADR 0020 and some architecture prose still use "aggregate" as the general concept
  word, not a reference to the deleted file. Renaming these would be cosmetic/historical
  rewriting, not a correctness fix — leave them.
- **`platform/scripts/provision-user.sh`'s legacy overlay** maps `data/dashboard_snapshot.json`
  from a very old (`training/`-era) legacy repo layout as an *optional* copy (`required=0` — a
  missing source just warns and skips, doesn't fail provisioning). Old legacy source repos likely
  still have `data/aggregate.json` under the old name, so this specific copy will warn-and-skip on
  them. Confirmed non-fatal and confirmed this script is one-time-operator tooling, not part of
  any current athlete's ongoing pipeline — leave it, not worth chasing.

(Already fixed directly, not deferred: `engine/README.md`'s "aggregate, quest log/history"
description and `docs/plans/coach-chat-modularization.md`'s reference to the deleted
`generate-widget-snapshots-from-aggregate.bundle.js` — both were live enough to be actively
misleading, not just historical, so they were corrected rather than listed here.)

## Pre-existing findings surfaced during PR #439 review (neither introduced nor worsened by it)

Both checked directly: PR #439's diff doesn't touch either file, and its new split-ledger code
path doesn't change either bug's reachability. Real, but the wrong PR to fix them in — filed as
separate issues instead of folded into #439's scope.

- **`ui/client/src/components/home-warm/warmHomeModel.ts:497`** —
  `challenge.phase?.current_block.name` optional-chains `phase` but not `current_block` under it.
  Introduced by PR #420 (Part 3), already on `main`, unrelated to #439. Not reachable via #439's
  new `splitLedgerAsChallenge()` bridge (it never sets `phase` at all — migrated athletes always
  short-circuit safely at `.phase?.`). Only a real crash risk for an **unmigrated** athlete whose
  legacy `challenge_v2.json` has `phase` set without `current_block` — the type declares
  `current_block` required under `Phase`, so this depends on real-world data not honoring that
  type, same class of risk this codebase has hit before (`CurrentWeekContract`'s `coach_read`
  shipping `null` despite being typed required, per `generate-widget-snapshots-from-dashboard-
  snapshot.ts`'s own comment). Fix: guard with `?.` on `current_block` too, or confirm no live
  unmigrated repo can actually produce that shape and drop the guard requirement.
- **`ui/client/src/lib/activities.ts:100-102`** — `getTrainingCategory()` trusts
  `activity.category` as already a valid `TrainingCategory` the moment it's truthy
  (`if (activity.category) return activity.category as TrainingCategory;`), skipping the
  name-regex fallback classification entirely whenever `category` is set to anything, even a
  mismatched/misspelled value. Predates #439 (from `412fe9d`), untouched by it. Risk is silent
  misclassification, not a crash — worth validating `activity.category` against the real
  `TrainingCategory` enum before trusting it, falling through to the regex classifier when it
  doesn't match, rather than trusting it blindly.

## From part 10 (wiring athlete insights into coach-chat context, PR #443)

2a (unused `sessions_365d`) and 2b (hardcoded "last 12 months" heading) from review were fixed
directly in #443 — not deferred, since both were quick and directly improved prompt accuracy.
Everything below is genuinely deferred:

- **Singular wording** — `fitnessSnapshotSection()` always renders plural ("1 days ago",
  "longest gap 1 days") regardless of value. Prompt-quality polish, not a functional failure —
  fold into Part 11's FSP/SOUL wording pass, or fix standalone if someone's already in this file.
- **Sport ordering** — `Object.entries(insights.sports)` renders in JSON insertion order (which
  is itself whatever order `generate-athlete-insights.mjs` wrote them, currently alphabetical
  since it sorts before building `sports`). No explicit ordering by session count/relevance in the
  render layer itself — low priority, the input happens to already be sorted today.
- **Rate rounding display** — `formatRate()` shows one decimal (2.25 → "2.3"), which is coarser
  than the source data's two decimals. Deliberate simplicity for prompt brevity, not a bug — leave
  as-is unless it causes a real coaching-accuracy issue.
- **No token-size cap** — the section emits one line per valid sport with no upper bound. Not a
  problem for any athlete with a normal handful of sports; would only matter for a pathological
  case (dozens of distinct sport strings in `activities/hist/`). Not worth guarding against
  speculatively — revisit only if it's ever actually observed.
- **Test coverage gaps**: no true end-to-end test proving a real file survives
  `loadCoachContext()` → `renderCoachContext()` → the actual `handleGreet`/ordinary-turn handler
  call sites (the wiring itself was reviewed statically, not test-covered end to end); no test for
  multiple sports rendering together, sport-label normalization edge cases, or extreme values
  (e.g. a 0-day gap, a sport with only ever 1 session). The unit-level coverage that exists (load
  degradation, render degradation, one populated happy-path) is solid; this is about the seam
  between layers specifically, not missing coverage everywhere.
- **No schema-version/freshness check** on `gen/athlete_insights.json` — Part 10 trusts whatever
  Part 9's generator wrote, whenever it last ran. If the generator's output shape ever changes
  incompatibly, or the file goes stale (sync stopped working for an athlete), nothing here detects
  it — same class of gap the rest of `loadCoachContext`'s files already have (none of the 9 fetched
  files carry a version/freshness check today), so this isn't a new inconsistency, just not solved
  for insights specifically either.
- **Still externally unverified** (carried over from #439's same gap, now doubled up): no real
  athlete's generated `athlete_insights.json` has been used, no actual rendered Gemini request has
  been inspected, no live API/Gemini/eval/browser flow has been run for either #439 or #443.
  Recommend a real-repo check before the whole stack (#435 → part 8-11) is considered done, not
  gating each individual PR on it.

## Your annotations

(space for anything else that falls out of parts 2-5 review)
