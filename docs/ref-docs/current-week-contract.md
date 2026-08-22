# Current Week Contract

**Status:** Accepted schema v1

**Owner:** Coach Phelps

**Source of truth:** `user_data/ledger/current_week.json`

**Consumers:** Web dashboard and, later, native iOS

## Decision

The live weekly plan and short-lived coaching commentary live in `user_data/ledger/current_week.json`, not `user_data/coach/profile.json`/`memory.json`. This keeps durable memory separate from a bounded, replaceable product snapshot while giving every product surface one structured contract.

| File | Time horizon | Responsibility |
|---|---:|---|
| `user_data/coach/profile.json` + `memory.json` | Months | Durable athlete state, constraints, priorities, and learned patterns |
| `user_data/ledger/current_week.json` | One week | Active dated plan, completion state, one primary Coach conclusion, and expiring semantic comments |
| `user_data/coach/coach_log.json` | Long-term, append-only | Session-continuity rows — the current schema's replacement for the old free-text coach_notes.md |
| `user_data/activities/workout_plans/templates/*.json` | Stable | Base exercise prescriptions |
| `sessions/*.json` | One workout | Coach-adjusted timer prescriptions with sets, phases, and rest |

The weekly snapshot contains **semantic coaching content**, not component names or layout instructions. Products choose where and how to render a topic.

## Schema v1 decisions

The proposed shape is retained with the following revisions:

| Revision | Decision | Rationale |
|---|---|---|
| Lifecycle | `data_status` is `placeholder`, `draft`, or `live`; only `live` is renderable | Prevents sample or partially confirmed plans from becoming coaching truth |
| Calendar | Add an IANA `timezone`; require seven consecutive dates matching the week bounds | Makes freshness deterministic without UTC/local-date drift |
| Duplicate fields | Remove `week.status` and the display-only weekday name | `data_status` owns lifecycle; weekday labels are derived from dates |
| Training load | Keep per-session `planned_load` as provisional zone-weighted load points; use `null` when no defensible estimate exists | Supports plan-versus-actual UI without treating unknown load as zero or duplicating measured activity data |
| Placeholder copy | `coach_read` is nullable and `coach_comments` may be empty | Placeholder prose must never resemble real advice |
| Session provenance | Add `origin: planned | unplanned` | Supports completed sessions that were not in the original plan |
| Moves | A moved session is relocated to its new day, keeps its stable `id`, and records `original_date`; `moved` is not a terminal status | Avoids duplicate IDs and preserves the current schedule plus provenance |
| Completion IDs | Use source-qualified strings such as `healthkit:<uuid>` or `strava:<id>` | Prevents collisions between data providers |
| Commentary | Add `confidence` to every comment and use array order instead of a second priority field | Keeps `coach_read` and `coach_comments` evidence semantics aligned |

## Root contract

| Field | Type | Rules |
|---|---|---|
| `schema_version` | integer | Must be `1` |
| `data_status` | enum | `placeholder`, `draft`, or `live` |
| `timezone` | string | Valid IANA time-zone identifier, currently `Europe/London` |
| `week` | object | Identity, bounds, phase context, focus, and guardrails |
| `coach_read` | object or `null` | Primary weekly conclusion; required when `data_status` is `live` |
| `days` | array | Exactly seven consecutive dated day objects |
| `coach_comments` | array | Zero to three evidence-backed semantic comments |
| `updated_at` | string | ISO 8601 timestamp with an explicit timezone offset |
| `updated_by` | string | Writer identity; Coach writes `coach` on normal saves |
| `trace_id` | string | Correlation id for the write, same pattern as `coach/memory.json`'s `_meta.trace_id` |

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
| `id` | string | Stable and unique within the weekly snapshot |
| `origin` | enum | `planned` or `unplanned` |
| `discipline` | string | Semantic category such as `badminton` or `calisthenics` |
| `kind` | string | Concise session type such as `competitive`, `strength`, or `recovery` |
| `title` | string | Human-readable title |
| `priority` | enum or `null` | `anchor`, `support`, or `optional`; `null` is allowed only for unplanned sessions |
| `status` | enum | `planned`, `done`, or `skipped` (workout-backend-wiring: `cancelled` dropped, folded into `skipped`) |
| `planned_duration_min` | positive integer or `null` | Confirmed plan value only |
| `planned_load` | positive number or `null` | Estimated zone-weighted load points; `null` means unknown, not zero |
| `template_id` | string or `null` | Existing template identifier only |
| `session_file` | string or `null` | Existing dated session path only |
| `coach_note` | string or `null` | One optional coaching intention or constraint |
| `original_date` | date or `null` | Initial date when a session has been moved within the week |
| `completion_activity_ids` | string array | Reliable, source-qualified identifiers only; an empty array is valid |

When a planned session moves within the week, move the single object to the destination day, preserve its `id`, set `original_date` once, and leave its status as `planned` until its outcome is known. When a completed session was never planned, add it to the correct day with `origin: "unplanned"`, `status: "done"`, `priority: null`, and `planned_load: null`.

### Load semantics — provisional v1

`planned_load` uses **load points**, not minutes, hours, session counts, RPE, or a free-text intensity label. The provisional calculation is:

> **LOAD = Σ(minutes in HR zone × zone weight)**

| Zone | Provisional weight |
|---|---:|
| Zone 1 | 1 |
| Zone 2 | 2 |
| Zone 3 | 3 |
| Zone 4 | 4 |
| Zone 5 | 5 |

Coach may populate `planned_load` only when the expected time-in-zone distribution is defensible. Otherwise it remains `null`; products must never coerce missing load to zero. An unplanned session always has `planned_load: null` because it had no pre-session estimate.

Actual session load does **not** live in `current_week.json`. Products derive it from the HR-zone seconds in the source-qualified completion activities, preserving activity history as the measured source of truth. Weekly planned load is the sum of known session estimates, weekly actual load is the sum of measured activity load, and every aggregate must expose incomplete coverage when inputs are missing.

For the initial UI, the optimal weekly band is provisionally the mean actual load of the previous eight completed calendar weeks ±20%. Weeks with incomplete source data must not silently count as zero. The P1 roadmap item must research and finalize the formula, inclusion rules, minimum-history behavior, rounding, and a single cross-platform configuration before this metric is treated as settled.

### Coach-authored commentary

`coach_read` contains one primary weekly judgement. Each `coach_comment` covers a semantic topic such as `weekly_load`, `training_intensity`, `weekly_plan`, `recovery`, or `recent_session`.

`coach_read.tone`/`confidence`/`evidence_refs` were dropped (part3-rollout): `tone`/`confidence`
duplicate a judgement the prose itself already carries (SOUL's voice design), and
`evidence_refs` asked Coach to self-assert what backs its claim when the real evidence should be
computed from live data instead. `coach_comments[]` is a separate, out-of-scope semantic-comment
system and keeps all three.

| Field | `coach_read` | `coach_comments[]` |
|---|---:|---:|
| `id` | No | Yes |
| `topic` | No | Yes |
| `headline` | Required, at most 72 characters | Required, at most 48 characters |
| `body` | Required, at most 280 characters | Required, at most 140 characters |
| `tone` | Dropped | `positive`, `steady`, `caution`, or `recovery` |
| `confidence` | Dropped | `low`, `medium`, or `high` |
| `evidence_refs` | Dropped | One or more real source names |
| `valid_from` | Date | Date |
| `valid_until` | Date on or after `valid_from` | Date on or after `valid_from` |

Array order is comment priority. Products must not render expired commentary. Evidence names are semantic references to real inputs, not invented measurements.

## Availability and freshness

The runtime validator returns a parsed snapshot plus one availability state:

| State | Meaning | Product behavior |
|---|---|---|
| `current` | Valid `live` file and local date is inside the week | Render |
| `grace` | Valid `live` file and local date is the day after `week.end_date` | Render temporarily while rollover completes |
| `placeholder` | Structurally valid seed data | Show safe unavailable state |
| `draft` | Structurally valid but not fully confirmed | Show safe unavailable state |
| `upcoming` | Valid `live` file whose week has not started | Show safe unavailable state |
| `stale` | Valid `live` file beyond the one-day grace period | Show safe unavailable state |
| `invalid` | Malformed JSON shape or failed invariants | Show safe unavailable state and log validation issues |

All date comparisons use `timezone`. The product never promotes `placeholder` or `draft` data to live and never falls back to fabricated plan or commentary copy.

## Build and validation boundary

P0 provides three guards. Before a Coach-authored save, `./engine/scripts/validate-current-week --coach-write` runs the same strict shape and invariant parser used by the dashboard and verifies Coach save metadata. GitHub Actions parses `user_data/ledger/current_week.json` on direct pushes and pull requests, catching malformed JSON before it can break a deploy. The dashboard repeats strict runtime validation before exposing the snapshot to components.

The shared local parser rejects invalid enums, date windows, duplicate IDs, copy-length violations, and provenance errors without duplicating schema rules. Enforcing those semantic checks inside CI remains a separate P1 hardening step.

## Ownership and delivery

Coach owns ordinary writes to `user_data/ledger/current_week.json` and may include it in the existing direct-to-main coaching lane. Code, workflows, contract documentation, and UI integration remain branch-and-review changes.

A change to `user_data/ledger/current_week.json` must trigger the dashboard build, produce `ui/client/src/data/current_week.json`, pass runtime validation, and degrade to an unavailable state if the source is absent, placeholder, draft, stale, or invalid.

## Migration rule

Closed weekly history moves to `user_data/coach/archive/week_plans.md`. Durable cut/block context lives in `coach_log.json`'s narrative rows and `memory.json`'s `coaching_priorities` note. The next Week 30 snapshot is seeded as `placeholder` because its schedule has not yet been confirmed; it must not become `live` until Sky and Coach agree the real week.
