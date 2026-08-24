# coach-chat open items

> Status: Current · Owner: Tech Lead · Verified: 2026-08-24

Short list of real, buildable-today items. Each one is re-verified directly against the current
code and `docs/eng-docs/coach-data-schema.md` (not just against other docs) - a fresh agent can
pick it up cold with just the repo and the file references below. Delete each item once it's
actually fixed, not just remembered.

## `provision-user.sh`'s migrate mode still targets the pre-redesign schema wholesale

Bigger than a narrow overlay bug. `platform/scripts/provision-user.sh`'s `migrate` mode:

- `copy_tree` (lines ~142-159) maps legacy directory names straight onto new paths -
  `training/coach` → `user_data/coach`, `training/ledger` → `user_data/ledger` - but copies each
  directory's contents verbatim. So a "migrated" repo ends up with `user_data/coach/` holding old
  `state.md`/`coach_notes.md`, not the real schema (`profile.json`/`memory.json`/`injuries.json`/
  `coach_log.json`), and `user_data/ledger/` holding the old ledger shape, not
  `seasons.json`/`quests.json`/`progress.json`/`progressions.json`.
- `verify_migration()` (~line 278) and `stamp_coach_since()` (~line 320) both read/write
  `user_data/ledger/challenge_v2.json` directly as the expected post-migration file - the file the
  redesign retired. `stamp_coach_since()` in particular writes `coach_since` into
  `challenge_v2.json`; per ADR 0018 and `coach-data-schema.md`, `coach_since` now lives in
  `profile.json`.

Confirmed this whole mode predates the redesign and was never touched by it - not a narrow
overlay edge case. Needs the full split-schema treatment: `copy_tree`'s legacy→new map rewritten
to translate old field shapes into the new files (same class of work as the now-shipped
`carve-skeleton.mjs` fix), and `verify_migration()`/`stamp_coach_since()` updated to check/write
the split ledger and `profile.json` instead of `challenge_v2.json`.

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
3. **`progress.json`'s `ProgressRow.source` type is `"model" \| "pipeline" \| "athlete"`
   (`coachQuestFiles.ts:76`), but only `"model"` is a real writer.** Checked every writer:
   `applyQuestEvent`/`applyQuestCreate` (`coachIntents.ts:220,404`) always stamp `"model"`; no
   `engine/` script writes `progress.json` at all (grepped the whole `engine/scripts/` tree, zero
   hits), so `"pipeline"` is dead too, not just `"athlete"`. Same is true of the separate
   `Quest.source: "model" | "athlete"` field in `quests.json` (`coachQuestFiles.ts:57`) - always
   `"model"`, and a comment at `coachIntents.ts:357` says this was already a resolved design
   choice (FSP-created quests are Coach-authored, not athlete-typed), so that one isn't an open
   question. Decide on `progress.json`'s two dead values only: drop `"pipeline"`/`"athlete"` from
   the type, or confirm a real future writer (a pipeline script logging progress directly, an
   athlete-facing manual-log UI) justifies keeping either.
4. **P2 — consolidate coach-chat's 3 routes behind a catch-all**, matching `auth/[...action].ts`
   (ADR 0017). `coach-chat.ts`, `coach-chat-context.ts`, `coach-chat-profile-status.ts` are 3 of
   only 7 top-level Vercel functions repo-wide today (`find ui/api -maxdepth 1 -name "*.ts" | grep
   -v '_lib\|_tests' | wc -l`) - well under the 12-function cap ADR 0017 exists to manage, so even
   less urgent than previously noted. Would change URLs (frontend + iOS
   `CoachChatAPIClient.swift` update needed), so do as its own small PR if/when worth it, not
   bundled.

## Test coverage gap

Missing end-to-end test proving a real `athlete_insights.json` survives `loadCoachContext()` →
`renderCoachContext()` → the actual `handleGreet`/ordinary-turn handler call sites (currently
tested at each layer separately, never together), plus a multi-sport render test and one
extreme-value case (a 0-day gap, a single-session sport).

