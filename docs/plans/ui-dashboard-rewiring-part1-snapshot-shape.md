# UI dashboard rewiring — part 1: snapshot shape (split-only)

> Status: Current · Owner: UI Expert · Verified: 2026-08-24
> Stack: part 1 of 6. First in stack, no dependency. Unblocks part 2.

## Context

The coach-chat backend redesign shipped a full schema split
(`profile.json`/`memory.json`/`injuries.json`/`coach_log.json` +
`seasons.json`/`quests.json`/`progress.json`/`progressions.json`), but the dashboard UI
(`ui/client/`) was never rewired to it directly. It runs today through a compatibility shim:
`ui/client/src/lib/splitLedgerChallenge.ts`'s `splitLedgerAsChallenge()` projects a legacy
`ChallengeV2`-shaped object from the new split files, and `useRepoData.ts` calls it only when
`snapshot.challenge_v2` is absent — so every dashboard page still reads the old `ChallengeV2`
shape, real or projected, never the split files directly. This already caused one confirmed
regression: the shim drops `coach_since`, silently breaking the day-count badge on migrated repos.

This is part 1 of a 6-part stack that retires the shim for good. Read all 6 parts
(`ui-dashboard-rewiring-part1` through `part6`, this directory) before starting any one of
them — later parts depend on earlier ones landing first.

**Decisions locked for the whole stack:**
- **Snapshot shape: Option B (split-only).** Both live athlete repos (`coach-skanda`,
  `coach-akash`) are migrated, so `gen/dashboard_snapshot.json` drops `challenge_v2`/
  `ledger_schema` entirely — no legacy fallback kept in the shape.
- **Scope: dashboard-only, web.** iOS's mirror bug (`GitHubAPIClient.swift`'s
  `readCoachDayAnchorDate()`) is iOS Builder's territory, untouched by this stack — tracked in
  `docs/plans/coach-chat-open-items.md`.
- Two adjacent gaps stay out of this stack, already added to `docs/plans/coach-chat-open-items.md`:
  `engine/scripts/generate_quest_history.py` still reading legacy `challenge_v2.json`, and
  `platform/scripts/provision-user.sh`'s legacy-path onboarding overlay.

## This PR's scope

Rewrite `engine/scripts/build-dashboard-snapshot.mjs`'s `loadLedger()`/snapshot assembly to emit
split ledger data only — drop `challenge_v2` and the `ledger_schema` tag from
`gen/dashboard_snapshot.json`. `platform/scripts/carve-skeleton.mjs`'s
`DASHBOARD_SNAPSHOT_PLACEHOLDER` is already schema-clean — verify it still matches, don't re-touch
it unless it's drifted. Regenerate real snapshots for both athlete repos to confirm nothing else
in the build step still assumes `challenge_v2`.

Downstream pages still read through the shim after this PR — that's fine, it's the input shape
changing, not the consumers yet. Parts 2-5 rewire the consumers.

## Verification

- Regenerate `gen/dashboard_snapshot.json` for both `coach-skanda` and `coach-akash`; confirm no
  `challenge_v2` or `ledger_schema` key present, and the split ledger fields are populated
  correctly against each repo's real data.
- `splitLedgerAsChallenge()` (still in place until part 6) should still produce the same projected
  output as before, now driven purely by the split fields — spot check one repo's projected output
  is unchanged from pre-PR.
