# Coach data redesign — what's actually in each file

> Status: Current · Owner: Tech Lead · Verified: 2026-08-16 · Main doc: [`coach-schema-redesign.md`](coach-schema-redesign.md)
>
> Detail only — the reasoning and the order of work are in the main doc. What's below is how things
> look once step 3 is done. The meaning of each field is unchanged from ADR
> [0006](../../kdb/decisions/0006-unified-challenge-v2-schema.md); what's new is which file it lives
> in, and the who/when stamp.

## Things that are true of every file

Each file has a `version` number of its own. Files that get edited also carry a `_meta` block saying
who last changed it and when:

```jsonc
"_meta": { "updated_at": "2026-08-16T18:42:03Z", "updated_by": "model", "trace_id": "abc123" }
```

`updated_by` is one of `model`, `server`, `pipeline`, `athlete`. `trace_id` is the same `traceId`
`coach-chat.ts` already puts in the logs — so when something looks wrong, you can go from the row
back to the log line that wrote it.

History files don't have a `_meta`, because nothing edits them — each row carries its own who/when.

Dates are `YYYY-MM-DD` in the athlete's local time. Timestamps are UTC. Ids never change and never
get reused.

---

## `user_data/coach/profile.json` — settings

```jsonc
{
  "version": 1,
  "_meta": { "...": "" },
  "coach_since": "2026-03-14",     // ADR 0018, set once — moved out of challenge_v2.json
  "name": "Akash",
  "timezone": "Asia/Kolkata",      // worked out from the city they mention, never asked (FSP §10)
  "sports": ["badminton", "strength"],
  "goal": "string",
  "timeline": "string",
  "coaching_style": "string",
  "age": 33,
  "height_cm": 178,
  "weight_kg": 74,
  "equipment": ["skipping rope", "pilates band"]
}
```

**Takes over from** the Athlete Profile and Equipment sections of `state.md`, plus `coach_since`
from `challenge_v2.json`.

`isAthleteProfileComplete()` in `coachChatFiles.ts` decides whether the first-session questions are
done. Today it does that by pattern-matching `- **Label:**` lines inside `state.md` (the gate from
B2 / ADR 0018). In step 2 it just checks whether these fields are filled in, and the pattern-match —
along with the two comment paragraphs explaining a regex flag — gets deleted.

---

## `user_data/coach/memory.json` — notes

Coach's own writing, kept as plain paragraphs, each under a label. One flat list of labels, not a
tree — because `memory_update` names exactly one label, and a flat list means the server can check
the name against a fixed set. Coach can't invent a label or write somewhere it wasn't offered.

```jsonc
{
  "version": 1,
  "_meta": { "...": "" },
  "notes": {
    "fitness_baseline":           { "text": "...", "updated_at": "...", "trace_id": "..." },
    "coaching_priorities":        { "text": "...", "updated_at": "...", "trace_id": "..." },
    "learned_patterns.training":  { "text": "...", "updated_at": "...", "trace_id": "..." },
    "learned_patterns.nutrition": { "text": "...", "updated_at": "...", "trace_id": "..." },
    "learned_patterns.mental":    { "text": "...", "updated_at": "...", "trace_id": "..." },
    "injury_flags":               { "text": "...", "updated_at": "...", "trace_id": "..." }
  },
  "rpe_calibration": [
    { "rpe": 7, "anchor": "what a 7 feels like, in Coach's words" }
  ]
}
```

**Takes over from** `state.md`'s Fitness Baseline, RPE Calibration, Coaching Priorities, Learned
Patterns and Active Injury Flags.

`rpe_calibration` stays a list because it really is a small table — a number and a description —
rather than one block of text. Coach can't update it via `memory_update`; it changes rarely and by
hand today, and it gets its own action if that ever stops being true.

---

## `user_data/coach/sessions.json` — history, only ever added to

```jsonc
{
  "version": 1,
  "rows": [
    {
      "id": "sess_2026-08-16_a1b2",
      "date": "2026-08-16",
      "ts": "2026-08-16T18:42:03Z",
      "type": "chat",              // chat | phase_close | week_close | manual
      "text": "what Coach wrote, word for word",
      "actor": "model",
      "trace_id": "abc123",
      "thread_id": "th_..."        // null for anything that isn't a chat
    }
  ]
}
```

**Takes over from** `coach_notes.md`, `rolling_state.json`, `state.md`'s Recent Session Notes, and
both `archive/phases.md` and `archive/week_plans.md` (those become rows with
`type: "phase_close"` / `"week_close"`).

This is the merge that matters most. Those four files were one running log kept four different ways,
which is how the memory ended up split in the first place. Nothing is deleted and nothing is
overwritten; **"last 3 sessions" becomes something we work out when we need it, not a file we
maintain.** An end-of-phase writeup is just a longer row with a different `type`.

It grows forever, and that's fine for now. Trimming it is the job of the tidy-up pass described in
`coach-memory.md` — Coach reads its own log and moves the lasting stuff into `memory.json`. That
design still hasn't settled *when* the tidy-up runs, and this doc doesn't answer it either.

---

## `user_data/ledger/season.json` — settings

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
      "phase": {
        "name": "Build",
        "start_date": "2026-07-01",
        "current_block": { "id": "block_1", "name": "Capacity", "start_date": "...", "end_date": "...", "note": "..." }
      }
    }
  ]
}
```

It's a **list**, so starting a new season adds an entry instead of writing over the old one. That's
what lets us stop copying the whole ledger into
`user_data/coach/archive/seasons/*/challenge_v2.json` at every season end — the old season is still
right there.

---

## `user_data/ledger/quests.json` — settings

```jsonc
{
  "version": 1,
  "_meta": { "...": "" },
  "main_quest": {
    "id": "main",
    "name": "20 Strength Sessions",
    "type": "count_target",          // count_target | weekly_sessions
    "target": 20,
    "count_pattern": "^WeightTraining\\s*#",
    "weekly_floor": null, "loaded_floor": null, "skill_weight": null, "skill_cap": null
  },
  "quests": [
    {
      "id": "morning_routine",
      "name": "Morning Routine",
      "type": "daily_streak",        // daily_streak | progress | ...
      "category": "side",
      "start_date": "2026-07-01",
      "status": "active",            // active | graduated | retired
      "polarity": "default_not_done",
      "tracking": "manual",
      "target": null, "unit": null,
      "notes": "string"
    }
  ],
  "weekly_targets": { "strength": 2, "cardio": 1 }
}
```

**What a quest is, not how it's going.** `completed_dates[]`, `excused_dates[]`, `missed_dates[]`,
`current`, and `main_quest.sessions[]` all move to `progress.json`. The separate `graduated[]` list
becomes `status: "graduated"` — a finished quest is still a quest, and giving it its own file made a
status look like a boundary.

---

## `user_data/ledger/progress.json` — history, only ever added to

```jsonc
{
  "version": 1,
  "rows": [
    {
      "id": "pr_morning_routine_2026-08-16",
      "quest_id": "morning_routine",   // "main" for the main quest
      "season_id": "s_2026_q3",
      "date": "2026-08-16",
      "status": "completed",           // completed | missed | excused
      "value": null,                   // only for quests that count something (chapters read, etc.)
      "meta": null,                    // weekly_sessions only: { label, kind, weight }
      "source": "model",               // model | pipeline | athlete
      "ts": "2026-08-16T18:42:03Z",
      "trace_id": "abc123"
    }
  ]
}
```

One row shape covers every kind of quest. `quest_event{quest_id, date, status}` writes to the row
for that quest on that date — so reporting the same tick twice just rewrites the same row and
nothing changes. That's the repeat-safety the main doc asks for, and it's the obvious way to key the
table when we get to step 5.

**What this removes:** `generate_quest_history.py` currently walks day by day through old season
snapshots to work out what happened; now it just formats rows that are already in order and already
complete. And `build-dashboard-snapshot.mjs` stops sending completion data twice (once as raw
`challenge_v2`, once as `quest_history`).

---

## `user_data/ledger/progressions.json` — settings

```jsonc
{
  "version": 1,
  "_meta": { "...": "" },
  "progressions": [
    {
      "id": "pull_up",
      "name": "Pull-up",
      "current": "3x5 negatives",
      "target": "3x5 strict",
      "unit": null,
      "history": [ { "date": "2026-08-01", "value": "3x3 negatives", "trace_id": "..." } ]
    }
  ]
}
```

**Takes over from** `milestones[]` in `challenge_v2.json`. The field is renamed to `progressions`,
because that's what they are. **The word the athlete sees stays "Milestone"** everywhere it shows up
today — the Build Phase widget, `docs/ref-docs/milestone-schema.md`. ADR 0016 already says the
display name and the stored name are separate things; only the stored one changes here.

---

## Files we're not touching

| File | Why it's fine | Change |
|---|---|---|
| `coach/chat_history.json` | ADR 0012, capped at 7 threads, the merge race is already fixed | `_meta` only |
| `ledger/current_week.json` | already has a version, stable session ids, and `updated_by` | `trace_id` added to `_meta` |
| `ledger/plugins.json` | two fields, doesn't grow | none |
| `activities/workout_plans/templates/*.json` | already id-shaped, Coach only reads it | `_meta` only |
| `activities/workout_plans/sessions/*.json` | per-day override, already id-shaped | `_meta` only |

**Check during step 2:** does `sessions/*.json` copy its whole template, or only the bits that
differ? If it copies, that's duplication worth fixing — but as its own change, not part of this one.

---

## The translation layer

A new function in `ui/api/coach-chat/_lib/`: `renderCoachContext(storage, tier) → string`.

Step 1 builds it on top of today's files, and it has to produce **character-for-character the same
prompt we send now**. That equality is the whole safety argument for doing this in steps — it proves
the layer changes nothing before any data moves. From step 2 onwards it reads the new files and
produces the same text Coach is already used to.

SOUL keeps referring to sections by the names Coach sees ("Learned Patterns"), never by file path.
That's what stops a storage change from being a prompt change. Size limits and the three tiers land
in step 4.

---

## The five open questions in `ledger-split-plan.md` — answered

1. **Does the main quest get split across two files?** Yes — what it is goes in `quests.json`, how
   it's going goes in `progress.json` as rows with `quest_id: "main"`. Its `sessions[]` is the same
   kind of thing as `completed_dates[]`, and keeping the two shapes different is exactly why three
   different bits of code work out completions three different ways today.
2. **Do progress rows need a `season_id`?** Yes. You could usually work the season out from the date
   plus `season.json`, but stamping it saves that lookup, spells out
   `generate_quest_history.py`'s "later season wins when dates overlap" rule instead of leaving it
   implied, and is the obvious way to split the table later. It costs about 20 bytes a row.
3. **Rename `milestones` to `progressions`?** Yes in the data, no in anything the athlete reads —
   see above, per ADR 0016.
4. **Do this before or after ADR 0006's unfinished v4 migration?** Together, as one change. The v4
   work (C2–C4) hasn't landed, and doing it first means migrating the same seven bits of code twice.
   Step 3 converts whatever is on disk straight into the four new files.
5. **JSON or one-line-per-row JSONL for the two history files?** Plain JSON. Everything that reads
   these files — Python, Node, TypeScript, Swift — already parses JSON, and JSONL means writing a
   new parser in each. The "nicer git diffs" argument stops mattering at step 5 when git isn't the
   store any more, and a season is a few hundred rows, so rewriting the whole file stays cheap.
   Don't tune the file format for a storage layer we're on our way out of.
