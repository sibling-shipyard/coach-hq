# Part 14 — triage and close out the review-leftovers backlog (supersedes Part 6's stub)

Stacked on Part 13. Branch off Part 13's tip once it exists.

## Context

`coach-redesign-part6-not-wired-in.md` accumulated real findings across every part of this
redesign, but never triaged them into "fix now" vs. "stays deferred" vs. "out of scope" — this
plan does that, so the list stops just growing and some of it actually gets resolved.

## Part A — fix now, real and cheap

1. **`ui/client/src/components/home-warm/warmHomeModel.ts:497`** —
   `challenge.phase?.current_block.name` optional-chains `phase` but not `current_block` beneath
   it. Real crash risk for an unmigrated athlete whose legacy `challenge_v2.json` has `phase` set
   without `current_block` — the type declares it required, but this codebase has already hit real
   data not honoring a required-typed field once before (`CurrentWeekContract`'s `coach_read`).
   Fix: guard `current_block` too (`challenge.phase?.current_block?.name`), or confirm no live
   unmigrated repo can actually produce that shape and drop the requirement from the type — don't
   leave it unguarded either way.
2. **`ui/client/src/lib/activities.ts:100-102`** — `getTrainingCategory()` trusts
   `activity.category` as already a valid `TrainingCategory` the moment it's truthy, skipping the
   name-regex fallback classification entirely on any mismatch or misspelling. Fix: validate
   against the real `TrainingCategory` enum before trusting it; fall through to the regex
   classifier on a mismatch instead of silently misclassifying.
3. **Five UI files reading the dropped `phase`/`current_block` fields from `seasons.json`**
   (`calisthenicsLensModel.ts`, `warmHomeSnapshots.ts`, `liveWeekContract.ts`, `warmHomeModel.ts`,
   `MonthlyAnalytics.tsx` — flagged in the original Part 6 doc, never actually investigated). For
   each: is the read now always `undefined`/dead code (safe to remove), or does it change rendered
   UI behavior when it silently returns nothing (needs a real replacement, not just deletion)? Same
   root cause as item 1 (`warmHomeModel.ts`) — investigate and fix together.
4. **`progress.json`'s `source: "athlete"` enum value** — confirmed no direct athlete-write path
   into `progress.json` exists; only `"model"` and `"pipeline"` are real, confirmed writers.
   Decide: drop the value from the type if genuinely unreachable, or confirm a real future write
   path justifies keeping it. Resolve the ambiguity either way — don't leave an enum value nobody
   can explain.

## Part B — worth doing now that the redesign is settled

5. **Schema-concepts README** — quest `type` values and anything else worth documenting for
   developers now that the whole redesign has landed. Needs a home under `user_data/` (per the
   original doc's own note). Write it now — "once the whole redesign is settled" was always the
   stated trigger condition, and it's true.
6. **Part 10's test coverage gaps** — add the missing end-to-end test proving a real
   `athlete_insights.json` survives `loadCoachContext()` → `renderCoachContext()` → the actual
   `handleGreet`/ordinary-turn handler call sites (currently tested at each layer separately, never
   together), plus a multi-sport render test and one extreme-value case (a 0-day gap, a
   single-session sport). Cheap, closes a real gap in otherwise-solid coverage.

## Part C — stays deferred, don't build, just keep documented

- `coach_log.json`'s `type: "phase_close"/"week_close"` row types — needs an `archive/phases.md`/
  `archive/week_plans.md` folding decision first; real but a bigger design question than this PR.
- `main_quest`'s `weekly_floor`/`loaded_floor`/`skill_weight`/`skill_cap` and `progress.json`'s
  `meta` — Akash's weekly-session-floor model, needs a real per-athlete extension mechanism design
  before these come back.
- Fitness Snapshot's singular wording, sport ordering, rate-rounding display, no token-size cap —
  all confirmed cosmetic/low-priority, not worth a dedicated pass.
- `gen/athlete_insights.json`'s missing schema-version/freshness check — same class of gap every
  other `loadCoachContext`-fetched file already has, not new, not solved here either.
- Stale doc references to `quest_log`/`aggregate` outside `platform/soul/` (mostly `docs/plans/`,
  which is delete-on-ship anyway) — fix opportunistically only, not a dedicated pass.

**`BACKLOG.md` maintenance:** promote the two substantive items above to `BACKLOG.md` entries — the
`phase_close`/`week_close` row type (with the archive-folding dependency noted), and the
`gen/`-sourced context files' missing schema-version/freshness check (broader than just
`athlete_insights.json` — every file `loadCoachContext` fetches has this same gap). The rest stay
noted in this doc only — not durable/important enough for the running list.

## Part D — explicitly out of scope

- iOS's `BundledTemplates.swift` offline-fallback drift — iOS Builder's territory, unrelated to
  this backend-focused cleanup.
- Anything migration/skeleton-related — yours, per your standing instruction, not touched here
  (same exclusion as Part 13).

## Part E — stack-wide real end-to-end verification, repositioned to here

The task already logged in Part 6's doc ("run the whole thing against a real athlete repo, once")
still needs to happen — do it **after this PR lands**, not after #446 alone, since Parts 12-14 also
touch real behavior (route/`handle()` internals, the two real bug fixes in Part A) the original
checklist didn't cover. Carry the existing 6-step checklist forward unchanged from
`coach-redesign-part6-not-wired-in.md`, just move its trigger point to "after Part 14 merges":

1. Fresh scratch branch off a real athlete repo.
2. Run the sync/generator pipeline for real so `gen/dashboard_snapshot.json` and
   `gen/athlete_insights.json` are genuinely generated, not synthetic fixtures.
3. A full first session and a few turns of ordinary chat via the hosted API, checking real
   committed files via the GitHub API after each turn.
4. Open the webapp dashboard against a migrated repo, confirm quest/season widgets render.
5. Confirm the Fitness Snapshot section reads sensibly for a real athlete's real activity mix, and
   Coach's FSP behavior references it correctly.
6. BYOB, separately: a first session and ordinary chat via Claude Code, confirming the SOUL text
   works for the terminal runtime too.

## Verification

- `cd ui && npx tsc --noEmit`, `npm run test` clean.
- Part A's two bug fixes each get a regression test: a `phase` set without `current_block` no
  longer crashes; a mismatched `activity.category` value falls through to the regex classifier.
- Live scratch-branch check for the season/quest UI files if Part A item 3's investigation finds
  live (not dead) behavior depending on the dropped fields.

## PR

Branch off Part 13's tip. Title something like `core: close out review-leftovers backlog — real
bug fixes, schema docs, deferred-item triage`. Body: what got fixed vs. what's staying deferred and
why, the two new `BACKLOG.md` entries, and a clear call-out that the stack-wide real end-to-end
verification (Part E) is the last remaining step once this merges.
