# Data freshness and reliability follow-ups

> Status: Plan · Owner: Tech Lead · Created: 2026-09-16

## Context

The 2026-09-16 audit found stale-data and data-loss paths across athlete-repo Sync, iOS, and the hosted dashboard. Close those paths in small PRs before changing performance architecture. No pipeline rewrite or new cache is proposed.

## Goal

```mermaid
flowchart LR
  writes["iOS and Coach writes"] --> trigger["Sync trigger or daily rollover"]
  trigger --> update["Reconcile, roll over, then generate"]
  update --> commit["Commit canonical data and derived files together"]
  commit --> readers["Web, widgets, Coach"]
```

Done when the snapshot matches its committed sources, a failed iOS history read cannot insert a duplicate, and two same-day badminton sessions retain separate records.

## Priority

No P0 was found. The seven P1 findings drive PRs 1–7 below; the three P2 findings stay deferred pending an athlete decision or measurement. M0–M2 are delivery milestones, not severity labels.

## Locked decisions

- ADR 0042 owns reconciliation and scheduled rollover; `week_update` stays the sole Coach write action.
- ADR 0035 requires one hist file per real session. A failed read must not make a committed session look absent.
- ADR 0013 makes `match_history.json` canonical. Supersede its date-only identity with a stable key and migration before changing the contract.
- `ui/api/repo-file.ts` uses `no-store` after a confirmed cross-account cache leak. Performance work must preserve that privacy property.

## Milestones

| Item | Outcome | Size | Result |
|---|---|---|---|
| M0 · Enforced gates | Existing engine suites and UI build run automatically. | S | Named checks run on their own changes. |
| M1 · Fresh derived data | Sync rebuilds all snapshot inputs in source-update order and commits plugin output. | M | Fixtures prove trigger coverage, week parity, daily rollover, and plugin persistence. |
| M2 · Session integrity | iOS dedup fails closed; badminton records have session identity. | M | Garmin read failure makes no duplicate; same-day matches survive save, analytics, and web. |

```mermaid
flowchart LR
  M0["M0 · Enforced gates"] --> M1["M1 · Fresh derived data"]
  M1 --> M2["M2 · Session integrity"]
```

M1's plugin output must persist before M2's badminton analytics contract is judged. The iOS read-failure PR can run alongside M0 and M1.

## PR stack

| PR | milestone | outcome | final base | files | owner | parallel with | result |
|---|---|---|---|---|---|---|---|
| 1 | M0 | P1 · Run engine script suites and UI build in CI/local gate. | main | `checks.conf`, `platform-tests.yml`, `ui-tests.yml` | Tech Lead | 5 | Existing 38 Node and 33 Python tests plus UI build run. |
| 2 | M1 | P1 · Build snapshot after week updates and trigger on profile/workout writes. | PR 1 | `sync.user.yml`, `test_sync_workflow.py` | Bob | 5 | Both workflow paths have week parity; file-only pushes rebuild. |
| 3 | M1 | P1 · Run rollover daily without committing on a no-op day. | PR 2 | scheduled workflow, `carve-skeleton.mjs`, tests | Bob | 4, 5 | Aged week advances; current week causes no commit. |
| 4 | M1 | P1 · Commit plugin analytics and remove obsolete output. | PR 3 | `sync.user.yml`, plugin fixture tests | Bob | 5 | Enabled, disabled, and empty-session trees are correct. |
| 5 | M2 | P1 · Stop iOS sync when required hist reads fail. | main | `HealthKitSyncManager.swift`, iOS tests | iOS Builder | 1–4 | Read failure plus Garmin rewrite makes no duplicate. |
| 6 | M2 | P1 · Supersede date-only match identity and migrate iOS/Python. | PR 4 | ADR, `ActivityDetailView.swift`, `DescriptionParser.swift`, `analytics.py`, tests | iOS Builder | 5 | Two same-day matches survive save and analytics. |
| 7 | M2 | P1 · Make web badminton read structured matches. | PR 6 | `sync.user.yml`, snapshot builder, `matchParser.ts`, Home/lens models, tests | Bob | — | Web and Python agree on the two-session fixture. |

Overlap determines merge order; independent branches may build in parallel, then rebase into the listed stack. Create scoped issues before implementation. This plan PR references the platform-hardening epic without closing it. Delete the plan in the last PR after moving durable contracts into engineering docs.

## P2 · Deferred and measurement gates

- P2 · Malformed hist can be skipped by the snapshot builder; decide whether one bad file should block Sync, then test that failure path.
- P2 · Measure Home p50/p95 latency and GitHub requests before combining `repo-file` and widget responses; preserve `no-store`.
- P2 · Measure iOS upload duration, blob count, and rate limits before considering bounded concurrency.

Build handoff: `engine/.github/workflows/sync.user.yml` (triggers, order, staging), `engine/scripts/build-dashboard-snapshot.mjs` (hist, week, workouts), `ios/CoachHQ/CoachHQ/Services/HealthKitSyncManager.swift` (dedup reads), `ios/CoachHQ/CoachHQ/Views/ActivityDetailView.swift` (match saves), `platform/plugins/badminton/analytics.py` (match identity).
