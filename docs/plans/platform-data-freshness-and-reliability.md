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

No P0 was found. The seven P1 findings drive the PR stack below; three split into two PRs to keep code ownership clear. PR 7 pairs an iOS code change with a Tech Lead-authored ADR. The three P2 findings stay deferred. M0–M2 are delivery milestones, not severity labels.

## Locked decisions

- ADR 0042 owns reconciliation and scheduled rollover; `week_update` stays the sole Coach write action.
- ADR 0035 requires one hist file per real session. A failed read must not make a committed session look absent.
- ADR 0013 makes `match_history.json` canonical. ADR 0049 adds the exact hist basename as the key for new entries; old date-only entries remain readable without a bulk migration.
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
| 1 | M0 | P1 · Run engine script suites and UI build in CI/local gate. | plan PR | `checks.conf`, `platform-tests.yml`, `ui-tests.yml` | Tech Lead | 6 | Existing 38 Node and 33 Python tests plus UI build run. |
| 2 | M1 | P1 · Build snapshot after week updates and trigger on profile/workout writes. | PR 1 | `sync.user.yml`, `engine/scripts/sync-workflow.test.mjs`, `ios-sync.md`, this plan | Bob + Tech Lead docs | 6 | Both workflow paths have week parity; file-only pushes rebuild. |
| 3 | M1 | P1 · Run rollover daily without committing on a no-op day. | PR 2 | scheduled workflow, engine tests, `coach-data-schema.md`, this plan | Bob + Tech Lead docs | 6 | Aged week and snapshot advance together; current week causes no commit. |
| 4 | M1 | P1 · Carve the new scheduled workflow into the skeleton template. | PR 3 | `carve-skeleton.mjs`, platform tests, `skeleton-layout.md`, this plan | Tech Lead | 5, 6 | Skeleton stamp includes `rollover.yml`; carve test asserts it lands in output. |
| 5 | M1 | P1 · Commit plugin analytics and remove obsolete output. | PR 4 | `sync.user.yml`, `regenerate_derived.py`, engine tests, `ios-sync.md`, this plan | Bob + Tech Lead docs | 6 | Enabled, disabled, and empty-session trees are correct. |
| 6 | M2 | P1 · Stop iOS sync when required hist reads fail. | PR 5 | `HealthKitSyncManager.swift`, iOS tests | iOS Builder | 1–5 | Read failure plus Garmin rewrite makes no duplicate. |
| 7 | M2 | P1 · Add a stable match identity to iOS's structured write. | PR 6 | ADR, `ActivityDetailView.swift`, `DescriptionParser.swift`, iOS tests | iOS Builder + Tech Lead ADR | — | New saves carry a stable key alongside the date; two same-day saves stay distinct. |
| 8 | M2 | P1 · Read the stable match identity in `analytics.py`, with cautious date fallback for older entries. | PR 7 | `analytics.py`, platform tests | Tech Lead | — | Two same-day matches survive analytics; older date-only entries still resolve. |
| 9 | M2 | P1 · Make the snapshot builder emit structured badminton matches. | PR 8 | snapshot builder, engine tests | Bob | — | Snapshot carries the stable-keyed match list; two-session fixture round-trips. |
| 10 | M2 | P1 · Make web badminton read structured matches. | PR 9 | `matchParser.ts`, Home/lens models, UI tests | UI Expert | — | Web and Python agree on the two-session fixture. |

Agents may build disjoint work in parallel, but final PR branches follow the one-parent chain above. After a parent squash-merges, forward-merge `main` into its child and retarget the child PR; do not rebase. Create scoped issues before implementation. This plan PR references the platform-hardening epic without closing it. Delete the plan in the last PR after moving durable contracts into engineering docs.

## P2 · Deferred and measurement gates

- P2 · Malformed hist can be skipped by the snapshot builder; decide whether one bad file should block Sync, then test that failure path.
- P2 · Measure Home p50/p95 latency and GitHub requests before combining `repo-file` and widget responses; preserve `no-store`.
- P2 · Measure iOS upload duration, blob count, and rate limits before considering bounded concurrency.

Build handoff: `engine/.github/workflows/sync.user.yml` (triggers, order, staging), `engine/scripts/build-dashboard-snapshot.mjs` (hist, week, workouts), `platform/scripts/carve-skeleton.mjs` (skeleton stamp for the new scheduled workflow), `ios/CoachHQ/CoachHQ/Services/HealthKitSyncManager.swift` (dedup reads), `ios/CoachHQ/CoachHQ/Views/ActivityDetailView.swift` (match saves), `platform/plugins/badminton/analytics.py` (match identity), `ui/client/src/lib/matchParser.ts` (web badminton reader).
