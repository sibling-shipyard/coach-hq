# coach-chat open items

> Status: Current · Owner: Tech Lead · Verified: 2026-08-21

Running list of real, still-open work, replacing the accumulated `coach-redesign-partN-*.md`
files and `BACKLOG.md` (deleted — their shipped scope is done, this doc keeps only what's still
true). Delete each item once it's actually fixed, not just remembered.

## Day-count badge doesn't actually read `profile.json`'s `coach_since` on either platform

Confirmed by direct code read (2026-08-21), not carried forward from an old doc. Both platforms'
"D-101" absolute day-count badge reads a legacy `challenge_v2`-shaped `coach_since` field, never
the canonical ADR 0018 value the server stamps onto `profile.json`:

- **iOS**: `ios/CoachHQ/CoachHQ/Services/GitHubAPIClient.swift`'s `readCoachDayAnchorDate()`
  (~lines 211-219) reads `user_data/ledger/challenge_v2.json` directly and decodes it into
  `ChallengeV2Summary` — actively called from `CoachChatView.swift`. Both athlete repos are now
  migrated to the split ledger, so this reads a file that no longer exists at all (a `readFile`
  404, not a graceful fallback).
- **Web**: `CoachChat.tsx` computes the badge via `challengeDayNumber()` (`coachChatModel.ts`)
  against `data.challenge_v2` from the prebuilt dashboard snapshot. For a repo with a real
  `challenge_v2.json` still on disk, that file's own `coach_since` field (one-time backfilled per
  issue #179) is used. For a repo migrated to the split ledger, `useRepoData.ts` falls back to
  `splitLedgerAsChallenge()` (`ui/client/src/lib/splitLedgerChallenge.ts`) to project a
  legacy-shaped object from `seasons.json`/`quests.json`/`progress.json` — and that projection
  **drops `coach_since` entirely**, so the badge silently resets to `season.start_date` on every
  new season. This is functionally the same bug issue #179 was filed and closed for, regressed by
  the ledger split and never re-caught because nothing tests the split-ledger path against this
  badge specifically.

**Fix, both platforms**: read `profile.json.coach_since` directly instead of going through
`challenge_v2`'s shape at all (already the correct source per ADR 0018 — `coachDay.ts`'s
`coachDayNumber()` already does this server-side, just isn't currently wired to either client's
badge). Also fix `UserFacingError.swift:66`'s `raw.contains("challenge_v2")` string match (stops
matching once migrated) and stale comments at `CoachSetupState.swift:48`, `OnboardingHints.swift:36`,
`CoachChatView.swift:39,43,488,662`, `CoachChatPreviewData.swift:8`. The iOS half is iOS Builder's
territory per `AGENTS.md` routing — flag for iOS Builder review even if a Tech Lead-directed agent
makes the mechanical fix; the web half is UI Expert's.

## Async closing (design decision needed, not built)

Same idea `docs/plans/coach-chat-follow-up.md`'s item 6 already tracks in full (origin, prior
`ASYNC-CLOSE-PLAN.md` design, PR #283/#287 history) — re-raised independently here for a second
motivation: the redesign's split-file writes add their own commit latency on top of the Gemini
call. One design, don't build twice; see that doc for the shape (`waitUntil`, synchronous reply,
detached write/commit).

**Two open questions, need an explicit answer before building either version:**
- `waitUntil`'s actual time cap vs. worst-case turn latency (a `template_edit` chain triggering a
  second Gemini call) — confirm the cap is sufficient before committing to this design.
- What happens when a background write still fails after every retry — silent forever, or does it
  need to surface next time the athlete opens the app (a banner, a re-sync prompt)? Real product
  decision, not an implementation detail.

## `provision-user.sh`'s legacy-repo migration overlay

Separate from the now-shipped athlete-repo migration (which covered `carve-skeleton.mjs` and the
two live athlete repos specifically) — `platform/scripts/provision-user.sh`'s legacy-repo
migration overlay (confirmed as of a prior review: lines ~142-147, 278-315, 399) still copies
whole old-shape directories verbatim, producing the old layout in a "migrated" repo. Needs the
same schema-mapping fix as part 3's Parts B/C, generalized for any future athlete onboarding
through this path, not just the two current ones.

## `generate_quest_history.py` doesn't read the split ledger yet

`engine/scripts/generate_quest_history.py` only reads `challenge_v2.json` (current + archived
seasons) to build `quest_history.json`, which `MonthlyAnalytics.tsx` consumes. For a migrated repo
`challenge_v2.json` doesn't exist, so `regenerate_derived.py` doesn't crash (the script has a
`FileNotFoundError` guard) but silently produces `quest_history.json` missing the current season's
daily-streak data entirely — Monthly Analytics quietly goes stale for any migrated athlete going
forward. Needs the same treatment as the retired `splitLedgerAsChallenge()` shim: read
`quests.json`/`progress.json` directly instead of (or as a fallback alongside) the legacy file.
Flagged explicitly out of scope in the `ui-dashboard-rewiring` PR stack (part 4) — real rewrite,
not a stale-reference fix.

## `build-dashboard-snapshot.mjs` still has a legacy `challenge_v2.json` fallback path

`engine/scripts/build-dashboard-snapshot.mjs`'s `loadLedger()` prefers the split ledger (all four
of `seasons.json`/`quests.json`/`progress.json`/`progressions.json` present → `ledger_schema:
"split_v1"`), but falls back to reading legacy `challenge_v2.json` whole (`ledger_schema:
"challenge_v2_v4"`) whenever the split files are incomplete or absent. Both live athlete repos
(`coach-skanda`, `coach-akash`) are migrated, so this fallback is currently dead in practice — but
the code path, the `ledger_schema` tag values, and the `challenge_v2: null` field it emits still
exist. Once the `ui-dashboard-rewiring` PR stack lands (client no longer reads `challenge_v2` at
all) and no onboarding path can still produce an unmigrated repo, remove this fallback branch and
the `challenge_v2`/`ledger_schema` fields from the snapshot shape entirely — don't leave a
never-taken legacy branch as the only place in the pipeline still searching for the old setup.
Flagged for `coach-chat-redesign-final-audit.md`'s dead-code sweep.

## Real bugs — cheap, still unfixed

1. **`ui/client/src/components/home-warm/warmHomeModel.ts:497`** —
   `challenge.phase?.current_block.name` optional-chains `phase` but not `current_block` beneath
   it. Confirmed still unguarded. Real crash risk for an unmigrated athlete whose legacy
   `challenge_v2.json` has `phase` set without `current_block`. Fix: guard `current_block` too, or
   confirm no live unmigrated repo can produce that shape and drop the requirement from the type.
2. **`ui/client/src/lib/activities.ts:100-102`** — `getTrainingCategory()` trusts
   `activity.category` as already valid the moment it's truthy, skipping the name-regex fallback
   on any mismatch. Fix: validate against the real `TrainingCategory` enum before trusting it,
   fall through to the regex classifier on a mismatch.
3. **Five UI files reading the dropped `phase`/`current_block` fields from `seasons.json`**
   (`calisthenicsLensModel.ts`, `warmHomeSnapshots.ts`, `liveWeekContract.ts`, `warmHomeModel.ts`,
   `MonthlyAnalytics.tsx`) — never actually investigated. For each: is the read now dead code
   (safe to remove), or does it change rendered UI behavior (needs a real replacement)? Same root
   cause as item 1, investigate together.
4. **`progress.json`'s `source: "athlete"` enum value** — no direct athlete-write path into
   `progress.json` exists; only `"model"` and `"pipeline"` are real writers. Decide: drop the
   value from the type, or confirm a real future write path justifies keeping it.
5. **P2 — consolidate coach-chat's 3 routes behind a catch-all**, matching `auth/[...action].ts`
   (ADR 0017). `coach-chat.ts`, `coach-chat-context.ts`, `coach-chat-profile-status.ts` are 3
   separate Vercel functions at flat URLs. Not urgent (no function-count cap pressure); would
   change URLs (frontend + iOS `CoachChatAPIClient.swift` update needed), so do as its own small
   PR if/when worth it, not bundled.

## Test coverage gap

Missing end-to-end test proving a real `athlete_insights.json` survives `loadCoachContext()` →
`renderCoachContext()` → the actual `handleGreet`/ordinary-turn handler call sites (currently
tested at each layer separately, never together), plus a multi-sport render test and one
extreme-value case (a 0-day gap, a single-session sport).

## Stays deferred, documented only

- `coach_log.json`'s `type: "phase_close"/"week_close"` row types — needs an
  `archive/phases.md`/`archive/week_plans.md` folding decision first.
- `main_quest`'s `weekly_floor`/`loaded_floor`/`skill_weight`/`skill_cap` and `progress.json`'s
  `meta` — Akash's weekly-session-floor model, needs a real per-athlete extension mechanism
  design first.
- Fitness Snapshot's singular wording, sport ordering, rate-rounding display, no token-size cap —
  cosmetic/low-priority, not worth a dedicated pass.
- `gen/athlete_insights.json`'s missing schema-version/freshness check — same class of gap every
  other `loadCoachContext`-fetched file already has.
- `plan_edit` can't touch `week.guardrails[]`; free-form template/session edits beyond structured
  skip-by-number — real feature gaps, unrelated to wiring/efficiency.
- Regenerating templates for existing athletes, migration script for workout-backend-wiring's
  schema additions — migration/backfill territory, same class of work as the (now-shipped)
  athlete-repo migration.

## Stack-wide real end-to-end verification

Promoted to its own file — `docs/plans/coach-chat-redesign-testing.md` — since it's the biggest
single piece of remaining risk in this redesign, not a minor item on this list. See that doc.
