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

## Open question for this LLD's implementer

Should `quest_create.main_quest` on a returning athlete **replace** the existing main quest
(matching FSP's "there's only ever one" behavior, per `applyQuestCreate`'s existing comment), or
should replacing an in-progress main quest need an explicit "are you sure" confirmation from Coach
in the prompt text, since a returning athlete abandoning a goal mid-stream is a bigger decision than
a first-session athlete setting one for the first time? Recommend keeping `applyQuestCreate`'s
existing replace-in-place behavior (simplest, most consistent) but flagging this in the PR
description for review — not blocking, just worth a second pair of eyes.

## Tests

- `coachIntents.test.ts`: `applySeasonStart` — new test asserting a prior active season transitions
  to `"archived"` when started early, and to `"completed"` when started after its end date; existing
  FSP case (no prior season) stays unchanged.
- `coachReplySchema.test.ts`: confirm a returning, non-first-session turn's schema includes
  `quest_create`/`season_start`.
- New eval fixture: a returning athlete starting a new season mid-stream, asserting the old one's
  status resolves correctly against `today` vs. its `end_date`.

## Done when

A returning athlete on a scratch branch can say "let's start a new season" or "I want a new goal"
and have it land — `quests.json`/`seasons.json` show the change, and the previous season's status
is `archived` or `completed` correctly depending on timing.
