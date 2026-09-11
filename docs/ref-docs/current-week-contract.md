# Current Week Contract

**Status:** Accepted schema v1 (ADR 0042 revision)

**Owner:** Coach Phelps

**Source of truth:** `engine/lib/current-week.mts` — this doc is a readable companion, not the
authority. If the two ever disagree, the code wins; open an issue.

**Consumers:** Web dashboard and, later, native iOS

## Decision

The live weekly plan and short-lived coaching commentary live in `user_data/ledger/current_week.json`, not `user_data/coach/profile.json`/`memory.json`. This keeps durable memory separate from a bounded, replaceable product snapshot while giving every product surface one structured contract.

| File | Time horizon | Responsibility |
|---|---:|---|
| `user_data/coach/profile.json` + `memory.json` | Months | Durable athlete state, constraints, priorities, and learned patterns |
| `user_data/ledger/current_week.json` | One week | Active dated plan, completion state, and one primary Coach conclusion |
| `user_data/coach/coach_log.json` | Long-term, append-only | Session-continuity rows — the current schema's replacement for the old free-text coach_notes.md |
| `user_data/activities/workout_plans/templates/*.json` | Stable | Base exercise prescriptions |
| `sessions/*.json` | One workout | Coach-adjusted timer prescriptions with sets, phases, and rest |

The weekly snapshot contains **semantic coaching content**, not component names or layout instructions. Products choose where and how to render a topic.

## How the week gets written (ADR 0042)

One action writes this file: `week_update`, sent as either a full seven-day kickoff (headline,
body, and all seven days) or a sparse patch naming only the day(s)/session(s) that changed. There
is no separate reconcile or edit action - a status change and a content change can land on the
same session entry in one call.

Two things write the file with no chat turn at all, both running in the sync pipeline:

- **The reconciler** (`engine/scripts/reconcile-current-week.mjs`) matches synced activities to
  planned sessions by date and discipline - a match marks a session `done`, a planned day that's
  passed with nothing logged marks it `skipped`, ambiguity gets flagged on that session's own
  `coach_note` rather than guessed.
- **The rollover** (`engine/scripts/rollover-current-week.mjs`) replaces an aged-out week with a
  fresh placeholder frame for the real current week, so the file never sits pointing at a bygone
  week between chat sessions.

## Schema v1 decisions

| Revision | Decision | Rationale |
|---|---|---|
| Lifecycle | `data_status` is `placeholder` or `live` | `draft` was dropped (ADR 0042) - no writer in this pipeline has a multi-turn confirm flow to put a week in it |
| Calendar | An IANA `timezone`; seven consecutive dates matching the week bounds | Makes freshness deterministic without UTC/local-date drift |
| Discipline | Closed enum, not free text (ADR 0042) | Removes the client-side substring guessing a free string used to need, and unblocks sport-agnostic Home widgets |
| Training load | `planned_load` dropped from the schema (ADR 0042) | No writer ever set it to a real value - see the consumer audit in `docs/plans/current-week-redesign-lld.md` |
| `coach_comments` | Dropped from the schema (ADR 0042) | Written `[]` on every plan, never touched again by any writer |
| Session provenance | `origin: planned \| unplanned` | Supports completed sessions that were not in the original plan |
| Moves | `week_update`'s `move_to_date` relocates a session to its new day, keeps its stable `id`, and records `original_date` | Avoids duplicate IDs and preserves the current schedule plus provenance |
| Completion IDs | Source-qualified strings such as `healthkit:<uuid>`, or `chat:<id>` for an athlete-reported one | Prevents collisions between data providers |

## Root contract

| Field | Type | Rules |
|---|---|---|
| `schema_version` | integer | Must be `1` |
| `data_status` | enum | `placeholder` or `live` |
| `timezone` | string | Valid IANA time-zone identifier |
| `week` | object | Identity, bounds, focus, and guardrails |
| `coach_read` | object or `null` | Primary weekly conclusion; required when `data_status` is `live`, forbidden when `placeholder` |
| `days` | array | Exactly seven consecutive dated day objects |
| `updated_at` | string | ISO 8601 timestamp with an explicit timezone offset |
| `updated_by` | string | Writer identity - `model` (hosted chat), `coach` (BYOB Claude Code), `reconciler`, or `rollover` |
| `trace_id` | string | Correlation id for the write |

### Week

| Field | Type | Rules |
|---|---|---|
| `id` | string | ISO week identifier such as `2026-W30` |
| `start_date` | date | Monday in `YYYY-MM-DD` format |
| `end_date` | date | Sunday exactly six days after `start_date` |
| `focus` | string or `null` | One concise outcome for the week |
| `guardrails` | string array | Confirmed injury, load, recovery, or scheduling constraints only |

### Day

| Field | Type | Rules |
|---|---|---|
| `date` | date | Must match its position in the seven-day range |
| `intent` | string or `null` | Semantic intent such as `train`, `recover`, `rest`, `review`, or `open` |
| `coach_note` | string or `null` | Optional day-level intention or constraint |
| `sessions` | array | Zero or more planned or unplanned sessions |

### Session

| Field | Type | Rules |
|---|---|---|
| `id` | string | Stable and unique across the whole weekly snapshot, not just within its day |
| `origin` | enum | `planned` or `unplanned` |
| `discipline` | enum | Closed set: `badminton`, `calisthenics`, `cycling`, `foundation`, `recovery`, `run`, `strength`, `weight_training`, `hike`, `walk`, `cricket`, `football`, `workout`, `swim`, `other` |
| `kind` | string | Concise session type such as `competitive`, `strength`, or `recovery` |
| `title` | string | Human-readable title |
| `priority` | enum or `null` | `anchor`, `support`, or `optional`; `null` is allowed only for unplanned sessions |
| `status` | enum | `planned`, `done`, or `skipped` |
| `planned_duration_min` | positive integer or `null` | Confirmed plan value only |
| `template_id` | string or `null` | Existing template identifier only |
| `session_file` | string or `null` | Existing dated session path only |
| `coach_note` | string or `null` | One optional coaching intention or constraint, or a reconciler ambiguity flag |
| `original_date` | date or `null` | Initial date when a session has been moved within the week |
| `completion_activity_ids` | string array | Reliable, source-qualified identifiers only; an empty array is valid |

When a planned session moves within the week, the single object relocates to the destination day, preserves its `id`, and sets `original_date` once; its status stays `planned` until the outcome is known. When a completed session was never planned, it's added to the correct day with `origin: "unplanned"`, `status: "done"`, `priority: null`.

### Coach-authored commentary

`coach_read` contains one primary weekly judgement, at most 72 characters headline and 280 characters body. It can start partway through the week - `valid_from` is the day it was written, not necessarily the week's `start_date`, so a mid-week kickoff never back-dates its own commentary.

## Availability and freshness

The runtime validator returns a parsed snapshot plus one availability state:

| State | Meaning | Product behavior |
|---|---|---|
| `current` | Valid `live` file and local date is inside the week | Render |
| `grace` | Valid `live` file and local date is the day after `week.end_date` | Render temporarily while rollover completes |
| `placeholder` | Structurally valid seed data | Show safe unavailable state |
| `upcoming` | Valid `live` file whose week has not started | Show safe unavailable state |
| `stale` | Valid `live` file beyond the one-day grace period | Show safe unavailable state - the rollover job clears this automatically on the next sync |
| `invalid` | Malformed JSON shape or failed invariants | Show safe unavailable state and log validation issues |

All date comparisons use `timezone`. The product never promotes `placeholder` data to live and never falls back to fabricated plan or commentary copy.

## Build and validation boundary

Before a Coach-authored save, `./engine/scripts/validate-current-week --coach-write` runs the same strict shape and invariant parser used everywhere else, and verifies Coach save metadata. The hosted chat pipeline runs the equivalent check (`assertCurrentWeekCommitReady`, `coachWeekFiles.ts`) server-side before every commit. The dashboard repeats strict runtime validation before exposing the snapshot to components.

The shared parser rejects invalid enums, date windows, duplicate IDs, copy-length violations, and provenance errors without duplicating schema rules.

## Ownership and delivery

Coach owns ordinary writes to `user_data/ledger/current_week.json` and may include it in the existing direct-to-main coaching lane. Code, workflows, contract documentation, and UI integration remain branch-and-review changes.

A change to `user_data/ledger/current_week.json` must trigger the dashboard build, produce `ui/client/src/data/current_week.json`, pass runtime validation, and degrade to an unavailable state if the source is absent, placeholder, stale, or invalid.

## Migration rule

Closed weekly history moves to `user_data/coach/archive/week_plans.md`. Durable cut/block context lives in `coach_log.json`'s narrative rows and `memory.json`'s `coaching_priorities` note. A freshly carved repo seeds a `placeholder` week; it must not become `live` until the athlete and Coach agree the real week.
