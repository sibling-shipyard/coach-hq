# coach-chat open items

> Status: Current · Owner: Tech Lead · Verified: 2026-08-24

Short list of real, buildable-today items. Each one is re-verified directly against the current
code and `docs/eng-docs/coach-data-schema.md` (not just against other docs) - a fresh agent can
pick it up cold with just the repo and the file references below. Delete each item once it's
actually fixed, not just remembered.

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
   `challenge.phase?.current_block.name`. Blocks don't exist in the current schema at all (Part 2
   dropped the phase/`current_block` concept from `seasons.json`), and no repo - migrated or
   legacy - will ever produce that shape again. This isn't a defensive-guard bug, it's a dead
   read. Fix: delete the `current_block` read (and the `challenge.phase` fallback above it, same
   reasoning) rather than optional-chain it further.
2. **`ui/client/src/lib/activities.ts:100-102`** — `getTrainingCategory()` trusts
   `activity.category` as already valid the moment it's truthy, skipping the name-regex fallback
   on any mismatch. Fix: validate against the real `TrainingCategory` enum before trusting it,
   fall through to the regex classifier on a mismatch.

## Filed as issues, not built here

- `provision-user.sh`'s dead `--migrate` mode (no legacy onboarding will ever happen again - all
  current and future athletes only use `--greenfield`): #564, P0, assigned to Akash.
- `progress.json`/`quests.json` `source` enum dead values: #565, P1.
- P2 route consolidation (`coach-chat.ts`/`coach-chat-context.ts`/`coach-chat-profile-status.ts`
  behind a catch-all, ADR 0017): #566, P2.

