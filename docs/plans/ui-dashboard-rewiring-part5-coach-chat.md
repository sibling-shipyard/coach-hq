# UI dashboard rewiring — part 5: Coach Chat surface + retire fallback wiring

> Status: Current · Owner: UI Expert · Verified: 2026-08-24
> Stack: part 5 of 6. Depends on part 1 (snapshot is split-only). Should land after parts 2-4
> (this PR removes the `useRepoData.ts` fallback branch other surfaces may still rely on until
> they're rewired — landing this last of the "rewire" PRs avoids breaking an unrewired page).
> Unblocks part 6.

## Context

See `ui-dashboard-rewiring-part1-snapshot-shape.md` for full background and the stack-wide
decisions. Read part 1 before starting this one.

This is also where the day-count badge bug gets fixed for real. The shim drops `coach_since`
entirely, so `challengeDayNumber()` (`coachChatModel.ts`) silently resets the badge to
`season.start_date` on migrated repos — the same bug ADR 0018 / issue #179 originally fixed,
regressed by the ledger split. Fixing it here (rather than as a separate patch) is the same work
as this PR's rewire either way.

## This PR's scope

Rewire the Coach Chat surface and the shared data-loading wiring off `ChallengeV2`:

- `ui/client/src/pages/CoachChat.tsx`
- `ui/client/src/components/coach-chat/coachChatModel.ts`
- `ui/client/src/components/RepoDataGate.tsx`
- `ui/client/src/pages/Home.tsx`
- `ui/client/src/hooks/useRepoData.ts` — remove the `challenge_v2`-presence branch; split data is
  the only path from here on.
- `ui/client/src/lib/challenge.ts`

**Day-count badge fix:** `challengeDayNumber()` reads `profile.json`'s `coach_since` directly
(mirrors `coachDay.ts`'s server-side `coachDayNumber()`), not through any `challenge_v2` shape.

## Verification

- `grep -n "challenge_v2\|ChallengeV2" ui/client/src/pages/CoachChat.tsx
  ui/client/src/components/coach-chat/ ui/client/src/components/RepoDataGate.tsx
  ui/client/src/pages/Home.tsx ui/client/src/hooks/useRepoData.ts ui/client/src/lib/challenge.ts`
  returns nothing.
- Run the UI dev server against real generated snapshots (post part 1) for both `coach-skanda` and
  `coach-akash`; confirm the day-count badge shows the correct ADR 0018 `coach_since`-derived
  value on both, and the rest of Coach Chat/Home render unchanged.
