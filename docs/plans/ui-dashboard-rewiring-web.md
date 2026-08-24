# UI dashboard rewiring — web (stacked PRs)

> Status: Current · Owner: UI Expert · Verified: 2026-08-24
> Companion file: `ui-dashboard-rewiring-ios.md` (iOS half of the same shim retirement — separate
> stack, separate owner, no shared PRs).

## Context

The coach-chat backend redesign shipped a full schema split
(`profile.json`/`memory.json`/`injuries.json`/`coach_log.json` +
`seasons.json`/`quests.json`/`progress.json`/`progressions.json`), but the web dashboard
(`ui/client/`) was never rewired to it directly. It runs today through a compatibility shim:
`ui/client/src/lib/splitLedgerChallenge.ts`'s `splitLedgerAsChallenge()` projects a legacy
`ChallengeV2`-shaped object from the new split files, and `useRepoData.ts` calls it only when
`snapshot.challenge_v2` is absent — so every dashboard page still reads the old `ChallengeV2`
shape, real or projected, never the split files directly. This already caused one confirmed
regression: the shim drops `coach_since`, silently breaking the day-count badge on migrated repos.

This file is a 6-step PR stack that retires the shim for good. **Read this whole file before
starting any one step** — later steps depend on earlier ones landing first. Each step below is one
PR; land them in order. Whoever picks up any single step should be able to work from this file
alone, without needing the rest of the conversation that produced it.

**Decisions locked for the whole stack:**
- **Snapshot shape: split-only.** Both live athlete repos (`coach-skanda`, `coach-akash`) are
  migrated, so `gen/dashboard_snapshot.json` drops `challenge_v2`/`ledger_schema` entirely — no
  legacy fallback kept in the shape.
- **Scope: web dashboard only.** The iOS day-count-badge mirror bug is a separate stack —
  `ui-dashboard-rewiring-ios.md` — with its own owner (iOS Builder) and its own PRs. Nothing in
  this file blocks or is blocked by that file; they touch disjoint code.
- Two adjacent gaps stay out of this stack entirely, tracked in
  `docs/plans/coach-chat-open-items.md` instead of built here:
  `engine/scripts/generate_quest_history.py` still reading legacy `challenge_v2.json`, and
  `platform/scripts/provision-user.sh`'s legacy-path onboarding overlay.

## Step 1 — snapshot shape: split-only, no legacy field

*First in the stack, no dependency. Unblocks step 2.*

Rewrite `engine/scripts/build-dashboard-snapshot.mjs`'s `loadLedger()`/snapshot assembly to emit
split ledger data only — drop `challenge_v2` and the `ledger_schema` tag from
`gen/dashboard_snapshot.json`. `platform/scripts/carve-skeleton.mjs`'s
`DASHBOARD_SNAPSHOT_PLACEHOLDER` is already schema-clean — verify it still matches, don't re-touch
it unless it's drifted. Regenerate real snapshots for both athlete repos to confirm nothing else in
the build step still assumes `challenge_v2`.

Downstream pages still read through the shim after this PR — that's fine, it's the input shape
changing, not the consumers yet. Steps 2-5 rewire the consumers.

**Verification:** regenerate `gen/dashboard_snapshot.json` for both `coach-skanda` and
`coach-akash`; confirm no `challenge_v2`/`ledger_schema` key present and the split ledger fields
are populated correctly against each repo's real data. `splitLedgerAsChallenge()` (still in place
until step 6) should still produce the same projected output as before, now driven purely by the
split fields — spot check one repo's projected output is unchanged from pre-PR.

## Step 2 — rewire Warm Home surface

*Depends on step 1. Unblocks step 3.*

Files: `ui/client/src/components/home-warm/warmHomeModel.ts`, `warmHomeSnapshots.ts`,
`liveWeekContract.ts`, `WarmInstrumentHome.tsx`. Replace each `ChallengeV2`-shaped read with the
real split field it maps to. Where a field maps to something the split design dropped on purpose,
remove the read (dead code) rather than working around it. Where a read needs a genuine behavioral
replacement rather than a mechanical swap, don't build that here — flag it in the PR body and add a
line to `docs/plans/coach-chat-open-items.md` instead.

Do not fix `warmHomeModel.ts:497`'s unguarded `current_block` crash risk in this PR — pre-existing,
independent bug, already tracked in `coach-chat-open-items.md`.

**Verification:** `grep -n "challenge_v2\|ChallengeV2" ui/client/src/components/home-warm/` returns
nothing. Run the UI dev server against real generated snapshots (post step 1) for both athlete
repos; visually confirm Warm Home renders unchanged from before this PR.

## Step 3 — rewire Sport Analytics surface

*Depends on step 1 (not step 2 — different surface — but land after step 2 for review order).
Unblocks step 4.*

Files: `ui/client/src/components/sport-analytics/calisthenicsLensModel.ts`, `SportSpine.tsx`,
`ui/client/src/pages/SportAnalyticsRunning.tsx`, `SportAnalyticsCalisthenics.tsx`,
`SportAnalyticsBadminton.tsx`. Same approach as step 2.

**Verification:** `grep -n "challenge_v2\|ChallengeV2" ui/client/src/components/sport-analytics/
ui/client/src/pages/SportAnalytics*.tsx` returns nothing. Confirm all three sport analytics pages
render unchanged against real snapshots for both repos.

## Step 4 — rewire Monthly Analytics surface

*Depends on step 1. Unblocks step 5.*

Files: `ui/client/src/components/monthly-analytics/monthlyAnalyticsModel.ts`,
`ui/client/src/pages/MonthlyAnalytics.tsx`. Same mechanical approach as steps 2-3. **Call out
explicitly in the PR body:** `quest_history.json` (consumed here) is still built from legacy
`challenge_v2.json` by `engine/scripts/generate_quest_history.py`, so quest-streak data stays stale
for migrated repos until that separate fix lands (tracked in `coach-chat-open-items.md`, not this
PR).

**Verification:** `grep -n "challenge_v2\|ChallengeV2" ui/client/src/components/monthly-analytics/
ui/client/src/pages/MonthlyAnalytics.tsx` returns nothing. Confirm Monthly Analytics renders
unchanged aside from the known stale quest-streak data noted above (pre-existing, not introduced by
this PR).

## Step 5 — rewire Coach Chat surface + retire fallback wiring + fix day-count badge

*Depends on step 1. Should land after steps 2-4 (this PR removes the `useRepoData.ts` fallback
branch other surfaces may still rely on until they're rewired — landing this last of the "rewire"
steps avoids breaking an unrewired page). Unblocks step 6.*

This is also where the day-count badge bug gets fixed for real, web side. The shim drops
`coach_since` entirely, so `challengeDayNumber()` (`coachChatModel.ts`) silently resets the badge
to `season.start_date` on migrated repos — the same bug ADR 0018 / issue #179 originally fixed,
regressed by the ledger split. (iOS has the same badge bug, fixed independently in
`ui-dashboard-rewiring-ios.md`.)

Files: `ui/client/src/pages/CoachChat.tsx`, `ui/client/src/components/coach-chat/coachChatModel.ts`,
`ui/client/src/components/RepoDataGate.tsx`, `ui/client/src/pages/Home.tsx`,
`ui/client/src/hooks/useRepoData.ts` (remove the `challenge_v2`-presence branch — split data is the
only path from here on), `ui/client/src/lib/challenge.ts`.

**Day-count badge fix:** `challengeDayNumber()` reads `profile.json`'s `coach_since` directly
(mirrors `coachDay.ts`'s server-side `coachDayNumber()`), not through any `challenge_v2` shape.

**Verification:** `grep -n "challenge_v2\|ChallengeV2" ui/client/src/pages/CoachChat.tsx
ui/client/src/components/coach-chat/ ui/client/src/components/RepoDataGate.tsx
ui/client/src/pages/Home.tsx ui/client/src/hooks/useRepoData.ts ui/client/src/lib/challenge.ts`
returns nothing. Confirm the day-count badge shows the correct ADR 0018 `coach_since`-derived value
on both repos, and the rest of Coach Chat/Home render unchanged.

## Step 6 — delete the shim, close the stack

*Finishing PR. Depends on steps 1-5 all landed.*

- Delete `ui/client/src/lib/splitLedgerChallenge.ts` and the `ChallengeV2` type.
- Confirm `grep -rl "challenge_v2\|ChallengeV2\|splitLedgerAsChallenge" ui/client/src` returns
  nothing.
- `ui/api/auth/_lib/generate-widget-snapshots-from-dashboard-snapshot.ts` also calls
  `splitLedgerAsChallenge()` (feeds iOS widget snapshots) — update it to read the split ledger
  directly too, same PR, since the function it depends on is being deleted.
- Doc upkeep, same PR (this is the plan's finishing PR — per `AGENTS.md`'s "Plan delete-on-last-PR"
  rule): delete this file (`ui-dashboard-rewiring-web.md`) once `ui-dashboard-rewiring-ios.md` has
  also shipped its stack — if iOS is still in progress, leave both files in place until both are
  done, then delete together.

**Verification:** full grep check across `ui/client/src` and `ui/api/` for
`challenge_v2`/`ChallengeV2`/`splitLedgerAsChallenge` — empty. `tsc --noEmit` passes (necessary,
not sufficient). Load the dashboard for both `coach-skanda` and `coach-akash` and click through
every rewired page (Warm Home, all 3 Sport Analytics pages, Monthly Analytics, Coach Chat/Home) —
confirm nothing regressed across the whole stack, not just the page each individual step touched.

## Out of scope (tracked elsewhere, not built in this stack)

- iOS's day-count badge bug and any other iOS work — `ui-dashboard-rewiring-ios.md`.
- `generate_quest_history.py`'s legacy read, `provision-user.sh`'s legacy overlay —
  `docs/plans/coach-chat-open-items.md`.
- `warmHomeModel.ts:497`'s unguarded `current_block` crash risk, `activities.ts`'s
  `activity.category` trust bug — already flagged in `coach-chat-open-items.md`, independent of
  this rewire.
