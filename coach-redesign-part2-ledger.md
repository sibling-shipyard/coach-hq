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
      "status": "active",
      "phase": {
        "name": "Build",
        "start_date": "2026-07-01",
        "end_date": "2026-08-30",
        "status": "active"
      }
    }
  ]
}
```

`status: "active" | "completed" | "retired"` added to both season and phase, per your call.
Date math alone (today vs `end_date`) can't tell "ran its full course" apart from "the athlete
stopped it early" (injury, plan change) — an explicit status covers that case cleanly.
`current_season_id` stays as the fast O(1) pointer to the active season rather than scanning for
`status: "active"`; the two aren't redundant, the pointer is just cheaper to read.

A **list**, not a single object — a new season appends instead of overwriting, which is what lets
`archive/seasons/*/challenge_v2.json` copies stop happening at every season end (the old season is
still right there in the array). Necessity check: every field here maps to something SOUL already
manages (§5b1-b4 in `B_engine.md` — Current Season, Phase Awareness, Closing a phase/season). No
padding to flag.

**`current_block` dropped entirely** (was: `{id, name, start_date, end_date, note}` nested under
`phase`). Per your read — season → phase is the right level of granularity for both the athlete
and Coach; a third tier inside phase is overkill. Checking the current code confirmed it too:
`Phase` (`ui/client/src/lib/challenge.ts`) had no `end_date` of its own — it was silently
borrowing `current_block.end_date` to know when the phase ends, which is a gap in `Phase`'s own
shape, not a real reason for a third level. `phase.end_date` now lives directly on `phase` where
it belongs. `current_block.note` was dead — not read anywhere in the codebase.

Implementation note: four UI files currently read `challenge.phase?.current_block` —
`calisthenicsLensModel.ts`, `warmHomeSnapshots.ts`, `liveWeekContract.ts`, `warmHomeModel.ts`, and
`MonthlyAnalytics.tsx` (five, all in `ui/client/src/`). These need updating to read `phase.name`/
`phase.end_date` directly instead — a UI Expert task when this part actually gets implemented, not
now.

**Real question for you:** the LLD doesn't specify a retention/trim policy for the `seasons[]`
array — it grows forever, same as `sessions.json`. Given a season is months long, this grows slowly
enough that it's probably fine unbounded for years, but worth a one-line decision now (unbounded,
or archive-to-cold-storage after N seasons) rather than an implicit "we'll figure it out."

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
1. Decide a `season.json` retention policy now (even if the answer is "unbounded, revisit at 20+
   seasons") rather than leaving it implicit.
2. Confirm which quest types actually use `main_quest`'s four null-default fields before treating
   them as universal.
3. Ship `quest_event` and `profile_update` as two separate small steps, not one PR — same
   one-field-at-a-time discipline as Part 1, tested independently.

## Your annotations

(space for your changes — go file by file)
