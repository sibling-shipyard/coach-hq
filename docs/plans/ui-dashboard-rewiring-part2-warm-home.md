# UI dashboard rewiring — part 2: Warm Home surface

> Status: Current · Owner: UI Expert · Verified: 2026-08-24
> Stack: part 2 of 6. Depends on part 1 (snapshot is split-only). Unblocks part 3.

## Context

See `ui-dashboard-rewiring-part1-snapshot-shape.md` for full background and the stack-wide
decisions (split-only snapshot, web-only scope, adjacent gaps deferred to
`docs/plans/coach-chat-open-items.md`). Read part 1 before starting this one.

## This PR's scope

Rewire the Warm Home surface off the `ChallengeV2`-shaped read, onto the real split fields:

- `ui/client/src/components/home-warm/warmHomeModel.ts`
- `ui/client/src/components/home-warm/warmHomeSnapshots.ts`
- `ui/client/src/components/home-warm/liveWeekContract.ts`
- `ui/client/src/components/home-warm/WarmInstrumentHome.tsx`

For each `ChallengeV2`-shaped read: if it maps to a real split-ledger field, rewire it to read
that field directly. If it maps to something the split design dropped on purpose, remove the read
(dead code) rather than working around it. If it needs genuine new logic to replace dropped
behavior, don't build that here — flag it in the PR body and add a line to
`docs/plans/coach-chat-open-items.md` instead.

Do not fix `warmHomeModel.ts:497`'s unguarded `current_block` crash risk in this PR — it's a
pre-existing, independent bug already tracked in `coach-chat-open-items.md`; fix it separately if
picked up.

## Verification

- `grep -n "challenge_v2\|ChallengeV2" ui/client/src/components/home-warm/` returns nothing.
- Run the UI dev server against real generated snapshots (post part 1) for both `coach-skanda` and
  `coach-akash`; visually confirm Warm Home renders unchanged from before this PR. This is a
  rewire, not a redesign.
