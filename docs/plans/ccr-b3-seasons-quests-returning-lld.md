# B3 — Seasons and quests for returning athletes — LLD

> Status: Current · Owner: Tech Lead · Verified: 2026-09-01

Execution detail for B3 in [`chat-commit-redesign.md`](chat-commit-redesign.md). Stacked on B2.

## Problem

`quest_create` and `season_start` are only ever in `FSP_ACTIONS` (`coachReplySchema.ts:332-340`),
never in `RETURNING_CLOSE_ACTIONS`. A returning (post-FSP) athlete cannot set a new goal, add a
habit quest, or start a new season through chat — on any turn, ordinary or closing. Nothing found
in code comments or `kdb/decisions/` suggests this was deliberate; it looks like FSP-only fields
that were never carried forward once an athlete graduates FSP. The athlete wants parity: an
established athlete should be able to say "I want to start a new season" or "add a new quest" and
have it work, same as during FSP.

A second, related gap: `applySeasonStart` (`coachIntents.ts:386-410`) always prepends a new season
and sets it current — it never touches the *previous* current season's status. Today that's masked
because season_start is FSP-only (fires once, no prior season exists). Once returning athletes can
start a new season, the old one is left dangling with `status: "active"` forever unless this is
fixed at the same time.

## Fix

**Schema**: add `quest_create` and `season_start` to the always-available data-fact field set
established in A1 (not closing-gated, not first-session-gated) — same treatment as
`memory_update`/`profile_update` etc.

**Season transition logic** in `applySeasonStart`: before writing the new season, look up the
current season (`seasons.seasons.find(s => s.id === seasons.current_season_id)`). If one exists,
resolve its status before prepending the new one:

```ts
const prevSeason = seasons.find((s) => s.id === parsed.current_season_id);
if (prevSeason && prevSeason.status === "active") {
  prevSeason.status = today < prevSeason.end_date ? "archived" : "completed";
}
```

- **Started early** (`today < prevSeason.end_date`) → previous season becomes `"archived"` (ended
  before its planned date).
- **Started after the end date** (`today >= prevSeason.end_date`) → previous season becomes
  `"completed"` (reached its natural end).

`Season.status` (`coachQuestFiles.ts`) needs the two new enum values added:
`"active" | "completed" | "archived"`.

## Resolved — `main_quest` is season-scoped, not independently settable

Settled direction, not left open: **`main_quest` can only ever change together with a season
change.** There is no "update my goal, same season" path at all — a season without a fixed goal
for its duration isn't really a season, so the two move as one unit, always. Concretely:

1. **`main_quest` gains a `season_id` field**, making the link explicit and queryable in the data,
   not just something that happens to coincide procedurally.
2. **`main_quest` can no longer be set via a standalone `quest_create` call.** Fold it into
   `season_start`'s own payload instead — `season_start` becomes `{name, start_date, end_date,
   main_quest: {name, type, target, count_pattern}}`, one atomic action. Starting a season without a
   goal, or setting a goal without starting a season, both become structurally impossible, not just
   discouraged in the prompt. `quest_create` keeps handling habit quests (`quests[]`) on their own —
   those aren't season-scoped, this change doesn't touch them.
3. **The season-transition logic above now carries the quest with it, in the same step.** When the
   outgoing season resolves to `archived` or `completed`, its `main_quest` (matched by `season_id`)
   moves into `quests[]` too, marked `status: "superseded"` — same "move it, don't destroy it"
   discipline as habit quests already get, never silently lost. The new season's `main_quest` is set
   from `season_start`'s own payload in the same call — never null-and-wait, since the action that
   creates the season is the same action that sets its goal.
4. **FSP's existing shape already does this naturally** (Step 4 pairs the goal with `season_start`
   in one statement per `B_engine.md`) — confirm FSP's actual schema/applier call already matches
   this bundled shape once this PR lands; if FSP still calls `quest_create.main_quest` separately
   today, unify it onto the same `season_start`-bundled path rather than keeping two shapes for the
   same concept.

This also resolves the earlier open question about accidental overwrites from an ambiguous
mid-conversation comment — that risk doesn't apply the same way anymore, since a `main_quest` change
can now only happen alongside an actual season transition, which has its own clear trigger (a real
season start), not a passing remark Gemini might misread.

## Tests

- `coachIntents.test.ts`: `applySeasonStart` — new test asserting a prior active season transitions
  to `"archived"` when started early, and to `"completed"` when started after its end date; existing
  FSP case (no prior season) stays unchanged.
- `coachIntents.test.ts`: same test extended to assert the outgoing season's `main_quest` (matched
  by `season_id`) moves into `quests[]` with `status: "superseded"` in the same call, and the new
  season's `main_quest` (from `season_start`'s own payload) carries the new `season_id`.
- `coachReplySchema.test.ts`: confirm a returning, non-first-session turn's schema includes
  `season_start` (with `main_quest` as part of its payload) and `quest_create` (habit quests only —
  confirm `main_quest` is no longer a valid standalone field on `quest_create`).
- Regression test: `quest_create` called with `main_quest` but no accompanying `season_start` is
  rejected — confirm this can't happen even if attempted, not just discouraged in the prompt.
- New eval fixture: a returning athlete starting a new season with its goal in the same statement,
  asserting the old season+quest pair both resolve correctly (archived/completed, superseded) and
  the new pair lands together.

## Done when

A returning athlete on a scratch branch can say "let's start a new season, with X as my goal" and
have it land as one action — `quests.json`/`seasons.json` show the new season and its `main_quest`
sharing a `season_id`, and the previous season's status and its old `main_quest`'s `"superseded"`
status both resolve correctly depending on timing. Attempting to change `main_quest` without a
season change is not possible, not just unprompted.
