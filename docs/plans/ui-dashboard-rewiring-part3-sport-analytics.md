# UI dashboard rewiring — part 3: Sport Analytics surface

> Status: Current · Owner: UI Expert · Verified: 2026-08-24
> Stack: part 3 of 6. Depends on part 1 (snapshot is split-only). Unblocks part 4.

## Context

See `ui-dashboard-rewiring-part1-snapshot-shape.md` for full background and the stack-wide
decisions. Read part 1 before starting this one. This part doesn't depend on part 2 landing first
(different surface) but should land after it in the stack order for a clean review sequence.

## This PR's scope

Rewire the Sport Analytics surface off the `ChallengeV2`-shaped read, onto the real split fields:

- `ui/client/src/components/sport-analytics/calisthenicsLensModel.ts`
- `ui/client/src/components/sport-analytics/SportSpine.tsx`
- `ui/client/src/pages/SportAnalyticsRunning.tsx`
- `ui/client/src/pages/SportAnalyticsCalisthenics.tsx`
- `ui/client/src/pages/SportAnalyticsBadminton.tsx`

Same approach as part 2: rewire fields that map directly, drop reads for fields the split design
intentionally dropped, and defer anything needing real new logic to
`docs/plans/coach-chat-open-items.md` rather than building it here.

## Verification

- `grep -n "challenge_v2\|ChallengeV2" ui/client/src/components/sport-analytics/
  ui/client/src/pages/SportAnalytics*.tsx` returns nothing.
- Run the UI dev server against real generated snapshots (post part 1) for both `coach-skanda` and
  `coach-akash`; visually confirm all three sport analytics pages render unchanged from before
  this PR.
