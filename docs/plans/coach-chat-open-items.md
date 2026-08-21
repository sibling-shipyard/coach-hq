# coach-chat open items

> Status: Current · Owner: Tech Lead · Verified: 2026-08-21

Running list of real, still-open work, replacing the accumulated `coach-redesign-partN-*.md`
files and `BACKLOG.md` (deleted — their shipped scope is done, this doc keeps only what's still
true). Delete each item once it's actually fixed, not just remembered.

## iOS — stale read of the retired ledger shape (iOS Builder's territory)

`ios/CoachHQ/CoachHQ/Services/GitHubAPIClient.swift`'s `readCoachDayAnchorDate()` (~lines 211-219)
reads `user_data/ledger/challenge_v2.json` and decodes it into `ChallengeV2Summary` for the
day-count header label — actively called from `CoachChatView.swift`. Once an athlete repo
migrates to the split ledger (`skanda-part3-migration-and-skeleton.md`), this reads a file that no
longer exists. Fix: read `profile.json.coach_since` directly instead (already the correct source
per ADR 0018 — `coachDay.ts`'s `coachDayNumber()` already does this server-side). Also fix
`UserFacingError.swift:66`'s `raw.contains("challenge_v2")` string match (stops matching once
migrated) and stale comments at `CoachSetupState.swift:48`, `OnboardingHints.swift:36`,
`CoachChatView.swift:39,43,488,662`, `CoachChatPreviewData.swift:8`. Flag for iOS Builder review
even if a Tech Lead-directed agent makes the mechanical fix.

## Async closing (design decision needed, not built)

The athlete's HTTP request blocks on the full closing pipeline (Gemini call, every write, the
GitHub commit) — worse when an action field triggers a second Gemini call (`template_edit`'s
content generation, `generateInitialTemplates`). Proposed shape: keep the reply synchronous,
detach write/commit/retry to run via Vercel's `waitUntil` after the response returns. The
pipeline's atomic-commit + upsert-by-id discipline is a good sign this is safely retryable, not a
rewrite.

**Two open questions, need an explicit answer before building:**
- `waitUntil`'s actual time cap vs. worst-case turn latency (a `template_edit` chain triggering a
  second Gemini call) — confirm the cap is sufficient before committing to this design.
- What happens when a background write still fails after every retry — silent forever, or does it
  need to surface next time the athlete opens the app (a banner, a re-sync prompt)? Real product
  decision, not an implementation detail.

## `provision-user.sh`'s legacy-repo migration overlay

Separate from `skanda-part3-migration-and-skeleton.md` (which covers `carve-skeleton.mjs` and the
two live athlete repos specifically) — `platform/scripts/provision-user.sh`'s legacy-repo
migration overlay (confirmed as of a prior review: lines ~142-147, 278-315, 399) still copies
whole old-shape directories verbatim, producing the old layout in a "migrated" repo. Needs the
same schema-mapping fix as part 3's Parts B/C, generalized for any future athlete onboarding
through this path, not just the two current ones.

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
  schema additions — migration/backfill territory, same owner as `skanda-part3`.

## Stack-wide real end-to-end verification (once, after the current stack merges)

Every PR in the SOUL-catchup stack has been verified mechanically per-PR (unit tests, `tsc
--noEmit`, `compose-soul.mjs --check` where relevant), but nothing has been run against a real
athlete repo yet:

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
