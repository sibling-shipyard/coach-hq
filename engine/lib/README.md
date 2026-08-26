# engine/lib/

Shared helpers used by the sync pipeline and the dashboard/coach-chat build. This folder is
carved verbatim into athlete repos (see `engine/README.md`), so nothing here should assume it's
running at HQ.

## Why both Python and JS

Two runtimes touch this data for different reasons, not because one language is being migrated
to the other:

- `engine/scripts/*.py` is the sync pipeline (regenerate derived data, quest history, query
  history). It runs in Python.
- `engine/scripts/*.mjs` (dashboard snapshot, athlete insights) and the `ui/` build run in
  Node/TypeScript.

Both sides need the same repo paths, HR zone math, and plugin lookups, so `repo_layout`,
`hr_zones`, and `plugins` each exist as a `.py` file and a `.mjs` file with the same logic. I
checked the import graph for each pair below rather than guessing - see the notes per file.

`text-caps.mts` is the one place where the duplication is explicit and documented in the code:
the TS module is the source of truth (issue #462), and `validate-text-caps.py` is a CI-only
backstop that mirrors the three constants by hand because it can't import a TS module.

## Files

| File | Language | Used by | Notes |
|---|---|---|---|
| `repo_layout.py` | Python | `engine/scripts/regenerate_derived.py`, `migrate_activity_naming.py`, `generate_quest_history.py`, `engine/core/query_history.py`, `engine/lib/plugins.py`, `engine/lib/timezone_util.py`, `engine/lib/hr_zones.py`, `platform/plugins/badminton/analytics.py` | Path helpers (repo root, gen dir, hist dir, etc.) for the Python sync pipeline. |
| `repo-layout.mjs` | JS | `engine/scripts/build-dashboard-snapshot.mjs`, `generate-athlete-insights.mjs`, `engine/lib/plugins.mjs`, `engine/lib/hrZones.mjs`, `platform/scripts/compose-soul.mjs`, `boot-cost.mjs`, `validate-soul.mjs`, `ui/scripts/build-data.mjs` | Same path helpers, JS side. Used well beyond `engine/lib` - `platform/` build scripts and the `ui/` dashboard build both depend on it directly. |
| `hr_zones.py` | Python | `engine/core/query_history.py` | Loads HR zone boundaries from the athlete repo, with defaults for HQ. |
| `hrZones.mjs` | JS | No importer found in `engine/`, `platform/`, or `ui/` as of this writing. | Same logic as `hr_zones.py`. Looks like a JS port that has no live caller right now - confirm before relying on it, and worth flagging as dead code if that's still true when you read this. |
| `plugins.py` | Python | `engine/scripts/regenerate_derived.py` | Plugin enable/lookup for the Python sync pipeline (e.g. badminton analytics). |
| `plugins.mjs` | JS | `engine/scripts/build-dashboard-snapshot.mjs` | Same plugin lookup, JS side, for the dashboard snapshot build. |
| `challenge_schema.py` | Python | `engine/scripts/generate_quest_history.py` | Normalizes `challenge_v2.json` across v2 ("challenge" block, legacy) and v3/v4 ("season" block, ADR 0006) shapes. No JS counterpart found. |
| `timezone_util.py` | Python | `engine/scripts/generate_quest_history.py`, `engine/core/query_history.py` | Timezone handling for the Python sync pipeline. No JS counterpart found. |
| `text-caps.mts` | TS | Bundled into `ui/api/coach-chat/_lib` via `ui/scripts/bundle-text-caps-api.mjs`, consumed by the coach-chat schema/prompt and write-time checks | Source of truth for the three Coach free-text length caps (issue #462). `engine/scripts/validate-text-caps.py` mirrors the numbers by hand as a CI-only backstop since it can't import a TS module. |
| `current-week.mts` | TS | `engine/scripts/validate-current-week.mts`, `ui/scripts/validate-current-week.mts`, bundled into `ui/api/coach-chat/_lib` via `ui/scripts/bundle-current-week-api.mjs` | `current_week.json` schema/validation, shared between the engine-side validator and the coach-chat bundle. No Python counterpart. |
| `projectActivity.mjs` | JS | `engine/scripts/build-dashboard-snapshot.mjs` | Projects an activity record down to what the dashboard snapshot needs. No Python counterpart - JS-only. |

## What I couldn't determine

I didn't find a live caller of `hrZones.mjs` anywhere in `engine/`, `platform/`, or `ui/`. It
mirrors `hr_zones.py` exactly, so it may have been written for a JS caller that hasn't landed yet,
or one that got removed. Don't assume it's load-bearing without checking again first.
