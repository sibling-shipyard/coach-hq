# UI dashboard rewiring — split-ledger schema

> Status: Current · Owner: UI Expert · Verified: 2026-08-21

## Context

The coach-chat backend redesign shipped a full schema split
(`profile.json`/`memory.json`/`injuries.json`/`coach_log.json` +
`seasons.json`/`quests.json`/`progress.json`/`progressions.json`), but the dashboard UI
(`ui/client/`) was never rewired to it directly. It runs today through a compatibility shim:
`ui/client/src/lib/splitLedgerChallenge.ts`'s `splitLedgerAsChallenge()` projects a legacy
`ChallengeV2`-shaped object from the new split files, and `useRepoData.ts` calls it only when
`snapshot.challenge_v2` is absent — so every dashboard page still reads the old `ChallengeV2`
shape, real or projected, never the split files directly. The shim's own comment calls this out:
"Temporary projection for existing dashboard models; the persisted snapshot stays split-only."

This has already caused one confirmed regression: the shim drops `coach_since` entirely, silently
breaking the day-count badge on any migrated repo (tracked in `coach-chat-open-items.md`). That's
the shape of bug this whole file exists to prevent more of — a lossy projection is a permanent
source of "the shim doesn't carry field X" bugs, one at a time, discovered by accident.

## Goal

Retire the projection. Dashboard pages read the split-ledger files (or a snapshot shape that
carries all of their real fields) directly, the same way the backend does. `ChallengeV2` as a type
either goes away or becomes purely a legacy-repo compatibility path for the (shrinking) set of
unmigrated athlete repos, not the shape every page is written against.

## Plan

**Branch:** stacks after `coach-repo-migration-and-skeleton.md` (both live athlete repos need to
actually be migrated before this can retire the legacy path for real) and
`docs/plans/coach-chat-redesign-testing.md`'s frontend section (need to know both schema shapes
render correctly *today*, via the shim, before rewiring — a regression during rewiring is easier
to catch against a known-good baseline).

### Step 1 — inventory every consumer of the shimmed shape

`grep -rl "challenge_v2\|ChallengeV2\|splitLedgerAsChallenge" ui/client/src` and
`ui/api/*/repo-file*` for the build-time snapshot side. Known so far (from
`coach-chat-open-items.md`'s bug list, not yet a complete inventory): `warmHomeModel.ts`,
`calisthenicsLensModel.ts`, `warmHomeSnapshots.ts`, `liveWeekContract.ts`, `MonthlyAnalytics.tsx`,
plus whatever else the grep turns up that wasn't already flagged. For each: does it read a field
the split files actually have (rewire it to read directly), a field the split design dropped on
purpose (dead code, remove), or a field genuinely computed differently now (needs a real
replacement, not a mechanical rewire)?

### Step 2 — decide the snapshot shape

`gen/dashboard_snapshot.json` (built by `engine/scripts/build-dashboard-snapshot.mjs`) is the
actual artifact pages read. Two real options, pick one and say why in the PR:
- **A.** Snapshot carries both `challenge_v2` (legacy, for unmigrated repos only) and the raw
  split-ledger files (`seasons`/`quests`/`progress`/`progressions`) side by side; pages read
  whichever is present, migrated repos always prefer the split shape.
- **B.** Snapshot always carries the split shape; a build-time (not runtime) adapter handles any
  still-unmigrated repo, so `ChallengeV2` never reaches the client at all.

Option B is cleaner but depends on part 3 actually finishing for every live repo first — if any
athlete repo can still be unmigrated when this ships, option A is the safer sequencing. Note
which is true when this plan is picked up, not now.

### Step 3 — rewire page-by-page

One page/model file at a time, per Step 1's inventory. For each: replace the `ChallengeV2`-shaped
read with a direct read of the real split field, verify against a real generated snapshot (not a
fixture) that the rendered output is unchanged for a migrated repo, and unchanged for an
unmigrated repo if option A was chosen.

### Step 4 — retire the shim

Once every consumer from Step 1 is rewired, delete `splitLedgerChallenge.ts` (option B) or shrink
it to cover only the fields a genuinely-unmigrated repo needs (option A, and only if any such repo
still exists). Delete `ChallengeV2` the type if nothing reads it anymore.

### Step 5 — fix the day-count badge as part of this pass

`coach-chat-open-items.md`'s badge bug is a direct instance of the shim problem this plan retires
— fix it here rather than separately, since Step 3's rewire of the relevant model file is the
same work either way. Read `profile.json.coach_since` directly (mirrors what `coachDay.ts`'s
`coachDayNumber()` already does server-side), not through `challenge_v2`'s shape.

## Out of scope

- iOS's equivalent bug (`GitHubAPIClient.swift`'s `readCoachDayAnchorDate()`) — iOS Builder's
  territory, tracked separately in `coach-chat-open-items.md`, not part of this web-only plan.
- Any new dashboard feature. This is a rewire, not a redesign — pages should look and behave the
  same after this lands, just reading real data instead of a lossy projection.
- `warmHomeModel.ts:497`'s unguarded `current_block` crash risk and `activities.ts`'s
  `activity.category` trust bug (`coach-chat-open-items.md` items 1-2) — real bugs, but
  independent of the schema shape this plan rewires; fix them in their own small PR, don't bundle.

## Done when

- `grep -rl "challenge_v2\|ChallengeV2"` in `ui/client/src` returns nothing (option B) or only the
  intentionally-kept legacy path (option A), confirmed against the inventory from Step 1 —
  nothing missed.
- Dashboard renders correctly against both a migrated and (if still relevant) an unmigrated real
  repo, confirmed by actually opening it, not just `tsc --noEmit` passing.
- Day-count badge shows the real ADR 0018 `coach_since` value on web.
- `coach-chat-open-items.md`'s badge entry and any of the "five UI files" items resolved by this
  pass get deleted from that doc.
