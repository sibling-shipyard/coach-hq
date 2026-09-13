# Sync pipeline drift

> Status: Proposal · Owner: Tech Lead · Created: 2026-09-13 · Issue: #1022

## Context

Today's #973 overlay copied `regenerate_derived.py` into four repos that never had `vs_usual.py`. HQ `sync.user.yml` pins Node 20 while the new wrappers need `--experimental-strip-types` (Node 22+). The workflow Sentry send (#849/#879) was closed unmerged; iOS's poll (#883) only fires if the app is still alive.

## Goal

Unblock all five athlete Syncs, then restore operator paging from the workflow. No new cron. No #327.

```mermaid
flowchart LR
  A["PR A: Node 22 + vs_usual"] --> B["PR B: failure to Sentry"]
```

## Stack

| PR | milestone | outcome | final base | files | owner | parallel with | result |
|---|---|---|---|---|---|---|---|
| A | unblock Sync | pin Node 22; copy carve `vs_usual.py` + `sync.yml` into the five athlete repos; Shreyas `workflow_dispatch` commits the snapshot | `origin/main` | `engine/.github/workflows/sync.user.yml` · `platform/tests/test_sync_workflow.py` · `docs/plans/sync-pipeline-drift-1022.md` | Bob | — | shipped on `fix/1022-sync-node` |
| B | page the operator | restore `if: failure()` Sentry send from `feat/876-sync-failure-sentry` onto current `sync.user.yml` | PR A | `engine/.github/workflows/sync.user.yml` · `engine/scripts/record_sync_failure.py` · `engine/scripts/notify_sync_failure.py` · `platform/scripts/carve-skeleton.mjs` · `platform/tests/test_record_sync_failure.py` · `platform/tests/test_notify_sync_failure.py` · `docs/eng-docs/ios-sync.md` · `docs/eng-docs/ops-observability.md` · `docs/eng-docs/sentry-runbook.md` · `docs/eng-docs/skeleton-layout.md` · keep this plan until athlete repos get the carved `sync.yml` + scripts | Bob | — | HQ code restored; athlete copies still operator follow-up |

Athlete-repo copies are operator PRs after A, not HQ files: `vs_usual.py` into the four that lack it, carved `sync.yml` into all five. Route through `carve-skeleton.mjs --dry-run`, not hand-edits of `user_data/`.

## Deferred

- Overlay audit of other `engine/core\|lib` files — P2 on #1022.
- Auto-propagate — #327 / #729.
- Athlete-facing stale banner — #877.
