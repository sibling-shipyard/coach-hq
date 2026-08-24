# UI dashboard rewiring — part 4: Monthly Analytics surface

> Status: Current · Owner: UI Expert · Verified: 2026-08-24
> Stack: part 4 of 6. Depends on part 1 (snapshot is split-only). Unblocks part 5.

## Context

See `ui-dashboard-rewiring-part1-snapshot-shape.md` for full background and the stack-wide
decisions. Read part 1 before starting this one.

## This PR's scope

Rewire the Monthly Analytics surface off the `ChallengeV2`-shaped read, onto the real split
fields:

- `ui/client/src/components/monthly-analytics/monthlyAnalyticsModel.ts`
- `ui/client/src/pages/MonthlyAnalytics.tsx`

Same mechanical approach as parts 2-3. **Call out explicitly in the PR body:**
`quest_history.json` (consumed here) is still built from legacy `challenge_v2.json` by
`engine/scripts/generate_quest_history.py`, so quest-streak data stays stale for migrated repos
until that separate fix lands — already tracked in `docs/plans/coach-chat-open-items.md`, not part
of this PR.

## Verification

- `grep -n "challenge_v2\|ChallengeV2" ui/client/src/components/monthly-analytics/
  ui/client/src/pages/MonthlyAnalytics.tsx` returns nothing.
- Run the UI dev server against real generated snapshots (post part 1) for both `coach-skanda` and
  `coach-akash`; visually confirm Monthly Analytics renders unchanged from before this PR, aside
  from the known stale quest-streak data noted above (pre-existing, not introduced by this PR).
