# Coach schema redesign — field shapes

> Status: Current · Owner: Tech Lead · Verified: 2026-08-16 · Main doc: [`coach-schema-redesign.md`](coach-schema-redesign.md)
>
> Drill-down only — the decision, phasing, and rationale live in the main doc. Shapes below are the
> target state after P2. Extends ADR [0006](../../kdb/decisions/0006-unified-challenge-v2-schema.md)'s
> v4 field semantics; only file boundaries and provenance are new.

## Conventions

Every file carries `version` (integer, bumped per file, no shared manifest) and mutable config files
carry `_meta`. Event rows carry provenance inline instead — a row is immutable once written, so its
provenance is part of the row.

```jsonc
"_meta": { "updated_at": "2026-08-16T18:42:03Z", "updated_by": "model", "trace_id": "abc123" }
```

`updated_by` ∈ `model` | `server` | `pipeline` | `athlete`. `trace_id` is the existing
`coach-chat.ts` `traceId`, so a `close-trace` log line joins to the row it produced.

Dates are `YYYY-MM-DD` in the athlete's timezone; timestamps are UTC ISO 8601. Ids are stable and
never reused.

---

## `user_data/coach/profile.json` — config

```jsonc
{
  "version": 1,
  "_meta": { "...": "" },
  "coach_since": "2026-03-14",     // ADR 0018, write-once — moved out of challenge_v2.json
  "name": "Akash",
  "timezone": "Asia/Kolkata",      // inferred from stated city, never asked (FSP §10)
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

**Replaces** `state.md` § Athlete Profile + Equipment, and `challenge_v2.json`'s `coach_since`.

`isAthleteProfileComplete()` (`coachChatFiles.ts`) currently regex-scans `state.md` for
`- **Label:**` lines with non-blank content — the First Session Protocol gate (B2 / ADR 0018). In
P1 it becomes a required-field check against this object. The regex and its two comment paragraphs
about `/m` flag behaviour delete outright.

---

## `user_data/coach/memory.json` — narrative

Prose leaves in a **flat** map, not a nested tree. Flat because `memory_update{key, text}` addresses
exactly one leaf, and a flat map makes the intent's key space a closed enum the server validates —
the model cannot invent a key or write anywhere it wasn't given.

```jsonc
{
  "version": 1,
  "_meta": { "...": "" },
  "leaves": {
    "fitness_baseline":           { "text": "prose", "updated_at": "...", "trace_id": "..." },
    "coaching_priorities":        { "text": "prose", "updated_at": "...", "trace_id": "..." },
    "learned_patterns.training":  { "text": "prose", "updated_at": "...", "trace_id": "..." },
    "learned_patterns.nutrition": { "text": "prose", "updated_at": "...", "trace_id": "..." },
    "learned_patterns.mental":    { "text": "prose", "updated_at": "...", "trace_id": "..." },
    "injury_flags":               { "text": "prose", "updated_at": "...", "trace_id": "..." }
  },
  "rpe_calibration": [
    { "rpe": 7, "anchor": "prose" }
  ]
}
```

**Replaces** `state.md` § Fitness Baseline, RPE Calibration, Coaching Priorities, Learned Patterns,
Active Injury Flags.

`rpe_calibration` stays a list because it is genuinely a table (`rpe` is a key, `anchor` is prose),
not one blob of text. It is not addressable by `memory_update`; it gets its own intent if it ever
needs one — today Coach sets it rarely and by hand.

---

## `user_data/coach/sessions.json` — events, append-only

```jsonc
{
  "version": 1,
  "rows": [
    {
      "id": "sess_2026-08-16_a1b2",
      "date": "2026-08-16",
      "ts": "2026-08-16T18:42:03Z",
      "type": "chat",              // chat | phase_close | week_close | manual
      "text": "the coach_note prose, verbatim",
      "actor": "model",
      "trace_id": "abc123",
      "thread_id": "th_..."        // null for non-chat types
    }
  ]
}
```

**Replaces** `coach_notes.md`, `rolling_state.json`, `state.md` § Recent Session Notes, and
`archive/phases.md` + `archive/week_plans.md` (as `type: "phase_close"` / `"week_close"` rows).

This is the consolidation that matters. Those four were the same journal at four retentions, which
is why memory fragmented. Storage is unbounded and append-only; **"last 3 sessions" is a view, not a
file.** A retrospective is just a long row with a different `type`.

Growth is bounded later by the compaction pass in `coach-memory.md` (Coach reads its own journal and
promotes durable patterns into `memory.json` leaves) — that design's open question, *what triggers
compaction*, is still open and is not answered here.

---

## `user_data/ledger/season.json` — config

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

An **array**, so a season transition appends a row instead of overwriting. That is what retires
`user_data/coach/archive/seasons/*/challenge_v2.json` whole-file snapshots — history lives in the
row, not in a copy of the entire ledger.

---

## `user_data/ledger/quests.json` — config

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

**Config only — no progress data.** `completed_dates[]`, `excused_dates[]`, `missed_dates[]`,
`current`, and `main_quest.sessions[]` all move to `progress.json`. `graduated[]` folds in as
`status: "graduated"` — a graduated quest is still a quest, and a separate file was a lifecycle flag
pretending to be a boundary.

---

## `user_data/ledger/progress.json` — events, append-only

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
      "value": null,                   // progress-type quests only (chapters read, etc.)
      "meta": null,                    // weekly_sessions only: { label, kind, weight }
      "source": "model",               // model | pipeline | athlete
      "ts": "2026-08-16T18:42:03Z",
      "trace_id": "abc123"
    }
  ]
}
```

One row shape for every quest type. `quest_event{quest_id, date, status}` upserts on
`(quest_id, date)`, so replaying the same event twice is a no-op — the idempotency guarantee the
main doc requires, and the natural primary key at P4.

**What collapses:** `generate_quest_history.py`'s day-by-day replay across archived season snapshots
becomes a formatter over rows that are already sorted and already complete;
`build-aggregate.mjs` stops shipping completion data twice (raw `challenge_v2` passthrough *plus*
`quest_history`).

---

## `user_data/ledger/progressions.json` — config

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

**Replaces** `challenge_v2.json` § `milestones[]`. Machine field renamed to `progressions` (the
concept is calisthenics progressions); the **user-facing label stays "Milestone"** wherever it
renders today — Build Phase widget, `docs/ref-docs/milestone-schema.md`. Per ADR 0016, the display
name and the machine field are separate concerns and only the machine field changes here.

---

## Unchanged this pass

| File | Why it's fine | Change |
|---|---|---|
| `coach/chat_history.json` | ADR 0012, bounded at 7 threads, re-merge race already fixed | `_meta` only |
| `ledger/current_week.json` | already `schema_version` + stable session ids + `updated_by` | `trace_id` added to `_meta` |
| `ledger/plugins.json` | two fields, no growth | none |
| `activities/workout_plans/templates/*.json` | id-shaped config, read-only to Coach | `_meta` only |
| `activities/workout_plans/sessions/*.json` | per-date override, id-shaped | `_meta` only |

**Verify during P1:** whether `sessions/*.json` stores a full copy of its template or only the
delta. If it copies, that is a duplication to fix — but it is a separate change, not part of this
migration.

---

## Render layer

`renderCoachContext(storage, tier) → string`, new in `ui/api/coach-chat/_lib/`. P0 builds it against
today's files and must emit **byte-identical output to the current prompt** — that equality is the
whole safety argument for the phasing, because it proves the seam is transparent before any data
moves. From P1 on it reads the new files and emits the same markdown Coach already knows.

SOUL keeps describing sections by their rendered names ("Learned Patterns"), never by file path, so
storage changes stop being prompt changes. Tiers and budgets land in P3.

---

## `ledger-split-plan.md`'s five open questions — answered

1. **Does `main_quest` split across files?** Yes — config in `quests.json`, progress as rows in
   `progress.json` with `quest_id: "main"`. Its `sessions[]` is the same event shape as
   `completed_dates[]`; keeping them different is exactly why three consumers re-derive completion
   three ways today.
2. **Does `progress.json` need `season_id`?** Yes. A row's date plus `season.json`'s range would
   usually suffice, but stamping the id removes an implicit date-range join, expresses
   `generate_quest_history.py`'s "later season wins on overlapping dates" rule directly, and is the
   obvious partition key at P4. It costs ~20 bytes a row.
3. **Rename `milestones` → `progressions`?** Yes for the machine field, no for product copy — see
   above, per ADR 0016.
4. **Cutover sequencing vs ADR 0006's unfinished v4 migration?** Fold into one. C2–C4 aren't landed;
   doing v4 first and splitting after migrates the same seven consumers twice. P2 converts whatever
   is on disk straight to the four files.
5. **JSON or JSONL for the event streams?** Pretty-printed JSON arrays. Every consumer already
   parses JSON across Python, Node, TS, and Swift; JSONL needs a new parser in each. The
   cleaner-git-diff argument expires at P4 when git is no longer the store, and a season is a few
   hundred rows — small enough that full-file writes stay cheap. Don't optimize the file format for
   a storage layer we're leaving.
