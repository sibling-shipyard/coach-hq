# Milestone Record Contract

**Status:** Accepted

**Owner:** Coach Phelps

**Source of truth:** `user_data/ledger/challenge_v2.json` → `milestones[]`

**Consumers:** Build Phase widget on the web dashboard; `scripts/generate_quest_log.py` (milestones table).

## Decision

Each milestone keeps **canonical prose** (`name`, `baseline`, `current`, `target`, `note`) — that prose is what the quest-log table renders and what Coach reasons over. The dashboard reads two **optional, additive** lanes on top of it. Nothing here is required; a milestone with prose only still renders (the widget falls back to prose). The point of maintaining the optional fields is to keep the dashboard's terse rows and progress bars alive.

## Fields

| Field | Type | Purpose |
|---|---|---|
| `name` / `baseline` / `current` / `target` / `note` | string | Canonical prose. Keep updating these as you always have. |
| `short_name` | string | Terse label for the dashboard row (e.g. `"Free Handstand"`). |
| `short_current` | string | Terse current value (e.g. `"5s"`, `"L 8s / R 9s"`). |
| `short_target` | string | Terse target (e.g. `"15s"`, `"3×10"`). |
| `progress` | object | Structured numeric tracking — **only for milestones that reduce to a single scalar.** Omit for bilateral / set×rep goals; they render terse-only. |

### `progress` object

```jsonc
"progress": {
  "unit": "s",              // display unit
  "baseline_value": 5,      // number at the block baseline
  "current_value": 5,       // latest tested number → drives the progress bar
  "target_value": 15,       // goal number
  "history": [              // dated real measurements — no interpolation
    { "date": "2026-06-22", "value": 5 }
  ],
  "projected_date": "..."   // OPTIONAL, computed by the pipeline (do not hand-set)
}
```

Progress % = `(current_value − baseline_value) / (target_value − baseline_value)`, clamped 0–100.

## The one rule that keeps the dashboard live

**When you test a milestone at a block boundary (the deload/milestone-test week), update its record here too:**

1. Refresh `short_current` to the new terse value.
2. For scalar milestones, bump `progress.current_value` and **append** `{ date, value }` to `progress.history` — never overwrite or interpolate history.
3. Leave `projected_date` alone — the pipeline computes it from `history`.

## Honesty rules

- **Only real, logged measurements** go in `history`. Never guess a number to fill a gap.
- **Comparable variations only.** A milestone's series must be the *same movement* across points (e.g. don't mix wall-assisted handstand seconds into a freestanding-hold series).
- **Bilateral goals** (e.g. Front lever L/R): track the **limiting side** as the scalar, or omit `progress` and keep terse strings. Do not average the two sides into a fake single number.
- **Prose is never destroyed for terseness.** `target` stays meaningful (e.g. "Clean hold, timed L and R separately"); `short_target` carries the terse "15s".
