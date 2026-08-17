# Coach redesign review — Part 2: challenge_v2.json → four ledger files

> Working doc for review, not a final eng-doc. Source: `docs/plans/coach-schema-redesign-lld.md`
> (merged, #380). Scope this in detail after Part 1 ships — noted here now so the full shape is
> visible while you're reviewing, per your "check everything" ask.

## `season.json` — proposed shape

```jsonc
{
  "version": 1,
  "_meta": { "...": "" },
  "current_season_id": "s_2026_q3",
  "seasons": [
    {
      "id": "s_2026_q3",
      "name": "My 60-Day Challenge",
      "start_date": "2026-07-01",
      "end_date": "2026-08-30",
      "status": "active"
    }
  ]
}
```

Complete redesign, not a patch on the old shape — this is the settled shape, not what's carried
over from `challenge_v2.json`.

- **`phase` (and `current_block` nested under it) removed entirely.** Season → phase → block was
  three tiers; per your call, even phase is more than needed — a season just has a start and end.
  This drops SOUL's "Phase Awareness" behavior (`B_engine.md` §5b) as it exists today — flagging
  that plainly since it's a real behavior change, but proceeding since the old structure isn't
  what's being preserved here. Rectifying SOUL and the UI files that read `phase`/`current_block`
  is later work, not part of this redesign pass.
- **`status: "active" | "completed" | "retired"`** — a season that ran its full course vs one the
  athlete stopped early (injury, plan change) needs to be distinguishable; date math alone
  (today vs `end_date`) can't do that.
- **No archive folder.** `archive/seasons/*/challenge_v2.json` is removed as a concept — a
  completed or retired season doesn't move anywhere, it just stays in `seasons[]` with its status
  flipped. This resolves the "where do archived seasons go" open question from Part 6 — there's no
  archive, so it doesn't apply. (Part 6 entry needs updating to reflect this.)
- **`seasons[]` ordered newest-first (descending by `start_date`)** — a new season gets prepended,
  not appended. `current_season_id` stays as the O(1) pointer either way, but descending order
  means "what's the athlete doing now" is also just "the first element," which lines up with how
  this file gets read most often.
- `current_season_id` — kept as the fast pointer to the active season rather than scanning for
  `status: "active"`.

**Resolved:** `seasons[]` grows unbounded in this same file, forever — no archive-to-cold-storage
later, per "no archive folder" above. Given a season is months long, this stays small for years,
so unbounded is fine.

## `quests.json` — proposed shape

```jsonc
{
  "version": 1,
  "_meta": { "...": "" },
  "main_quest": {
    "id": "main", "name": "20 Strength Sessions", "type": "count_target", "target": 20,
    "count_pattern": "^WeightTraining\\s*#",
    "weekly_floor": null, "loaded_floor": null, "skill_weight": null, "skill_cap": null
  },
  "quests": [
    {
      "id": "morning_routine", "name": "Morning Routine", "type": "daily_streak",
      "category": "side", "start_date": "2026-07-01", "status": "active",
      "polarity": "default_not_done", "tracking": "manual",
      "target": null, "unit": null, "notes": "string"
    }
  ],
  "weekly_targets": { "strength": 2, "cardio": 1 }
}
```

What a quest **is**, not how it's going — completion data all moves to `progress.json` (below).
`status: "graduated"` replacing the old separate `graduated[]` list is a genuine simplification
worth keeping — a finished quest is still a quest, the LLD's own reasoning holds up.

**Field-by-field check:** `main_quest`'s four null-by-default fields (`weekly_floor`,
`loaded_floor`, `skill_weight`, `skill_cap`) are carried over unchanged from the current
`challenge_v2.json` shape per ADR 0006 — not new complexity introduced by this redesign, just
relocated. Worth confirming during implementation which quest *types* actually populate these
(not all of them do today either) rather than assuming every quest needs all four reserved.

## `progress.json` — proposed shape

```jsonc
{
  "version": 1,
  "rows": [
    {
      "id": "pr_morning_routine_2026-08-16", "quest_id": "morning_routine",
      "season_id": "s_2026_q3", "date": "2026-08-16", "status": "completed",
      "value": null, "meta": null, "source": "model", "ts": "2026-08-16T18:42:03Z",
      "trace_id": "abc123"
    }
  ]
}
```

One row shape for every quest type — this is the redesign's strongest simplification in the whole
ledger split. `quest_event {quest_id, date, status}` writing to *the row for that quest on that
date* means reporting the same tick twice is a no-op by construction (upsert on
`quest_id`+`date`), which is real repeat-safety, not just a stated goal. `season_id` stamped on
every row (LLD's answered question #2) costs ~20 bytes/row and removes an implicit "later season
wins on date overlap" rule from `generate_quest_history.py` — worth keeping, the cost is trivial
next to what it makes explicit.

**No fields to cut here** — this is the tightest-scoped file in the whole redesign; every field
is either a foreign key, the fact being recorded, or provenance (`source`/`ts`/`trace_id`). Nothing
speculative.

## `progressions.json` — proposed shape

```jsonc
{
  "version": 1,
  "_meta": { "...": "" },
  "progressions": [
    {
      "id": "pull_up", "name": "Pull-up", "current": "3x5 negatives", "target": "3x5 strict",
      "unit": null, "history": [ { "date": "2026-08-01", "value": "3x3 negatives", "trace_id": "..." } ]
    }
  ]
}
```

Renamed from `milestones` in the data, **stays "Milestone" everywhere the athlete sees it** (ADR
0016 already separates display name from stored name — this just exercises that separation for
real). No field-level concerns; this is the smallest, least-changed of the four files.

## `quest_event` / `profile_update` — the two new Gemini actions this step adds

| Reports | Shape | Server does | Repeat-safe because |
|---|---|---|---|
| `quest_event` | `{quest_id, date, status}` | upserts the row in `progress.json` for that quest+date | same quest_id + date = same row |
| `profile_update` | `{field, value}` | sets one field in `profile.json` | same field + trace_id |

Same "add one new thing at a time" discipline as Part 1 — don't ship both in the same PR as Part
1's `memory_update`. Order: `memory_update` lands with Part 1 (state.md split), `quest_event` +
`profile_update` land with this part, each tested in isolation via the eval harness before the
next one starts.

## Migration implications

- `generate_quest_history.py`'s day-by-day replay across `archive/seasons/*/challenge_v2.json`
  snapshots (currently walking every past season's file to reconstruct history) goes away —
  `progress.json`'s rows are already in order and already complete, so history generation becomes
  formatting, not reconstruction. Real, measurable simplification of that script.
- `build-aggregate.mjs` currently sends completion data twice (raw `challenge_v2` + computed
  `quest_history`) — this redesign is also the natural point to stop that duplication, since
  `progress.json` is now the one source both paths would read from.
- Per the LLD's answered question #4: do this together with ADR 0006's unfinished v4 migration,
  not before it — migrating the same code twice (once for v4, again for this split) is real wasted
  effort. Confirmed as the right call reading both docs.

## Changes I'm flagging for your review
1. Confirm which quest types actually use `main_quest`'s four null-default fields before treating
   them as universal.
2. Ship `quest_event` and `profile_update` as two separate small steps, not one PR — same
   one-field-at-a-time discipline as Part 1, tested independently.
