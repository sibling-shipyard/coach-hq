# coach-chat open items

> Status: Current · Owner: Tech Lead · Verified: 2026-08-24

Short list of real, buildable-today items. Each one is self-contained - a fresh agent can pick it
up cold with just the repo and the file references below, no other doc needed. Delete each item
once it's actually fixed, not just remembered.

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
Flagged explicitly out of scope in `docs/plans/ui-dashboard-rewiring-web.md` (step 4) — real
rewrite, not a stale-reference fix.

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
3. **`progress.json`'s `source: "athlete"` enum value** — no direct athlete-write path into
   `progress.json` exists; only `"model"` and `"pipeline"` are real writers. Decide: drop the
   value from the type, or confirm a real future write path justifies keeping it.
4. **P2 — consolidate coach-chat's 3 routes behind a catch-all**, matching `auth/[...action].ts`
   (ADR 0017). `coach-chat.ts`, `coach-chat-context.ts`, `coach-chat-profile-status.ts` are 3
   separate Vercel functions at flat URLs. Not urgent (no function-count cap pressure); would
   change URLs (frontend + iOS `CoachChatAPIClient.swift` update needed), so do as its own small
   PR if/when worth it, not bundled.

## Test coverage gap

Missing end-to-end test proving a real `athlete_insights.json` survives `loadCoachContext()` →
`renderCoachContext()` → the actual `handleGreet`/ordinary-turn handler call sites (currently
tested at each layer separately, never together), plus a multi-sport render test and one
extreme-value case (a 0-day gap, a single-session sport).

