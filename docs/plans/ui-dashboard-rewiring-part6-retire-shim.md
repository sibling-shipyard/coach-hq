# UI dashboard rewiring — part 6: delete the shim, close the stack

> Status: Current · Owner: UI Expert · Verified: 2026-08-24
> Stack: part 6 of 6, finishing PR. Depends on parts 1-5 all landed.

## Context

See `ui-dashboard-rewiring-part1-snapshot-shape.md` for full background and the stack-wide
decisions. By this point every consumer of the `ChallengeV2`-shaped shim has been rewired (parts
2-5) and the snapshot itself is split-only (part 1). This PR removes the now-dead shim and closes
out the stack's paper trail.

## This PR's scope

- Delete `ui/client/src/lib/splitLedgerChallenge.ts` and the `ChallengeV2` type.
- Confirm `grep -rl "challenge_v2\|ChallengeV2\|splitLedgerAsChallenge" ui/client/src` returns
  nothing.
- Doc upkeep, same PR (this is the plan's finishing PR — fold durable bits, then delete the plan
  files per `AGENTS.md`'s "Plan delete-on-last-PR" rule):
  - Delete all 6 `docs/plans/ui-dashboard-rewiring-part*.md` files (this one included).
  - Remove the day-count-badge (web half) entry and any other items resolved by this stack from
    `docs/plans/coach-chat-open-items.md`.

## Verification

- Full grep check across `ui/client/src` for `challenge_v2`/`ChallengeV2`/`splitLedgerAsChallenge`
  — empty.
- `tsc --noEmit` passes (necessary, not sufficient).
- Load the dashboard for both `coach-skanda` and `coach-akash` and click through every rewired
  page (Warm Home, all 3 Sport Analytics pages, Monthly Analytics, Coach Chat/Home) — confirm
  nothing regressed across the whole stack, not just the page each individual PR touched.
