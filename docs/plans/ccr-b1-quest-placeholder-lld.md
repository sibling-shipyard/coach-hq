# B1 — Remove placeholder data, backend — LLD

> Status: Current · Owner: Tech Lead · Verified: 2026-09-01

Execution detail for B1 in [`chat-commit-redesign.md`](chat-commit-redesign.md).

## Problem

`platform/scripts/carve-skeleton.mjs` seeds two non-empty fields into every new athlete repo:
`QUESTS_TEMPLATE.main_quest` (a real "20 Strength Sessions" placeholder) and
`PROFILE_TEMPLATE.timezone: "UTC"`. The `main_quest` placeholder is the root cause of `quest_create`
never firing during FSP. `isFirstSessionRitualDone()` (`coachChatFiles.ts:336-343`) checks
`Boolean(quests?.main_quest)`, which the placeholder satisfies from carve time. So the gate flips
"done" the instant profile basics land — regardless of whether a real quest was ever created.
Confirmed live: after a full FSP conversation stating goal + 3 habits, `quests.json` was still the
untouched skeleton default.

Audited every other `_TEMPLATE` constant in `carve-skeleton.mjs` — nothing else seeds real example
content (excluding `platform/skeleton-templates/*.json`, generic reusable workout content, out of
scope). Only these two fields need changing.

## Fix

```js
// carve-skeleton.mjs
const PROFILE_TEMPLATE = {
  ...
  timezone: null, // was "UTC" — every reader already falls back to "UTC" at the call site
  ...
};

const QUESTS_TEMPLATE = {
  ...
  main_quest: null, // was a real placeholder — genuinely absent until quest_create fires
  ...
};
```

`timezone: null` is safe — confirmed every real reader already has its own `?? "UTC"` fallback:
`ui/api/coach-chat.ts:66`, `activitySyncTurn.ts:69`, `coachContext.ts:65`,
`turnWrites/profileWrite.ts:69`, `coachTurn.ts:141,210`.

`coachQuestFiles.ts`: `QuestsJson.main_quest: MainQuest;` → `MainQuest | null;` (explicit null,
matching this codebase's convention over optional `?:`).

`coachIntents.ts`, `applyQuestCreate`: remove the `if (!mainQuest) throw ...` block — a genuinely
absent `main_quest` is now legal, matching the type. This throw was previously unreachable (carve
always seeded a real value); once the seed is gone, a real scenario — habit quests stated before
any goal — would otherwise turn into a hard 502.

## Already safe, confirmed by direct read — no change needed

`coachContext.ts:286` already has a real `if (mainQuest) {...} else "*(None set)*"` branch and is
already tested. `coachTurn.ts:440` is already optional-chained.
`coachChatFiles.ts:342`'s `Boolean(quests?.main_quest)` is the line whose behavior becomes
*correct* once the placeholder is gone — no code change there, just real data.
`engine/scripts/build-dashboard-snapshot.mjs` has zero references to `main_quest`; it passes
`quests.json` through structurally.

## Tests

- `coachIntents.test.ts`: replace the "throws when no main_quest..." test with one asserting
  `main_quest: null` round-trips; add a case for quests-only `quest_create` (no `main_quest` given,
  none on file) succeeding instead of throwing.
- `coachChatFiles.test.ts`: add an `isFirstSessionRitualDone` case with `main_quest: null`
  explicitly (not just a fully-null quests file).
- Two new eval fixtures (`ui/api/coach-chat/_tests/coach-chat-eval/transcripts/`, following the
  `NN-description.json` convention — see `27-fsp-quest-create.json`, `28-fsp-new-injuries.json`).
  A1's own PR already claimed `29` (`29-returning-ordinary-profile-update.json`), so these are `30`
  and `31`:
  - `30-fsp-quest-create-after-profile-complete.json` — profile lands early, goal + habits stated
    later in the same conversation. Asserts `quest_create` fires. Only meaningful once A1 has
    landed (writes have to actually persist).
  - `31-equipment-after-profile-complete.json` — equipment `memory_update` after profile
    completion, ordinary turn, asserts immediate commit.
- Check for a carve-skeleton snapshot/golden-file test; update expected `quests.json`/`profile.json`
  fixtures if one exists.

## Done when

`tsc` clean (surfaces every remaining unguarded `.main_quest` consumer — see B2 for the one real
one). Live re-test on a fresh scratch repo: full FSP conversation stating goal + habits in the same
turn that completes profile fields, `quests.json` gets a real commit, `coach_log.json`/Coach's reply
match what's on disk.
