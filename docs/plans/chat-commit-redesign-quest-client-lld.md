# B2 — Client null-safety for absent main quest — LLD

> Status: Current · Owner: Tech Lead · Verified: 2026-09-01

Execution detail for B2 in [`chat-commit-redesign.md`](chat-commit-redesign.md). Stacked on B1 —
its type change is a hard compile-time dependency for `ui/client/`; don't ship B1 without this
landing at the same point in the stack, or every fresh-athlete dashboard crashes.

## Problem

`buildWarmHomeModel` (`ui/client/src/components/home-warm/warmHomeModel.ts:483-486`):

```ts
quest:
  (ledger.quests?.main_quest ?? ledger.main_quest).type === "count_target"
    ? buildCountTargetQuest(ledger.quests?.main_quest ?? ledger.main_quest, activities, ledger)
    : buildQuest((ledger.quests?.main_quest ?? ledger.main_quest) as MainQuest),
```

Throws the instant a fresh athlete (pre-quest_create) opens the dashboard — a real, reachable state
after B1 instead of an impossible one masked by placeholder data.

## Fix

1. Add `hasQuest: boolean` to `QuestModel`. Add `buildEmptyQuest()` returning zeroed fields +
   `hasQuest: false`. `buildQuest`/`buildCountTargetQuest` both set `hasQuest: true`.
2. `buildWarmHomeModel`: resolve `mainQuest = ledger.quests?.main_quest ?? ledger.main_quest ??
   null` once; if null, `buildEmptyQuest()`; otherwise dispatch on `.type` as today.
3. Thread `hasQuest` through `buildQuestSnapshot` (`warmHomeSnapshots.ts:288`) and the iOS-facing
   `questSnapshotS` variant (~line 847) onto `QuestSnapshot`.
4. `QuestCard.tsx`: render an explicit empty state ("No quest set yet — tell Coach your goal.")
   when `!quest.hasQuest`, instead of a misleading 0/0 progress bar. Exact copy/styling is a UI call
   — keep consistent with any existing empty-state language elsewhere on the dashboard.
5. `ui/client/src/lib/challenge.ts`: `SplitLedger["quests"]["main_quest"]` (~line 152) → `| null`,
   matching the backend type it mirrors.

Confirmed already safe, no change needed: `calisthenicsLensModel.ts:266-267` (already
optional-chained).

## Tests

- `warmHomeModel.test.ts`: new case, `ledger.quests.main_quest = null`, asserts the empty sentinel
  instead of a throw.
- `QuestCard` component test: render with `hasQuest: false`, assert empty-state copy (check whether
  a test file already exists for this component before adding one).

## Done when

`tsc` clean across `ui/client/`. Live check: a fresh scratch athlete's dashboard (before any
`quest_create` has fired) renders the empty-quest state instead of crashing.
