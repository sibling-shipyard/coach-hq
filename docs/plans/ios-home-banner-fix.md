# iOS Home banner + empty widgets — root cause and fix

> Status: Current · Owner: Tech Lead · Verified: 2026-08-30

## Context

Two confirmed Home failures (Rage Report / Sentry), plus one Rage Report UX nit.

1. **Akash banner** — COACH-HQ-IOS-3. Cancelled duplicate Home fetch → sticky
   "Couldn't load Home". Not auth.
2. **Nats empty Home** — COACH-HQ-IOS-4 (`date2022`). Auto-capture:
   `decodingFailed … missing "target" at home.phase.milestones.Index 0`.
   Split-ledger path in `buildPhaseSnapshot` emits `target: item.target` which is
   often undefined on progressions → whole snapshot decode fails → empty Home.
3. **Rage Report keyboard** — TextEditor never dismisses; Submit sits behind the
   keyboard. No Done toolbar / scroll-dismiss.

Loading polish (skeleton → content feel) stays deferred until (1) ships.

## Decision

```mermaid
flowchart LR
  A["PR1: cancel + serialize refresh"] --> D["banner gone"]
  B["PR2: milestone target contract"] --> E["Nats Home paints"]
  C["PR1 nit: Rage Report keyboard"] --> F["Submit reachable"]
```

| PR | outcome | files | owner | done when |
|---|---|---|---|---|
| 1 | Ignore cancel; serialize refresh; keyboard dismiss on Rage Report | `WidgetSnapshotStore.swift`; `RageReportView.swift` (+ tiny Theme/toolbar if needed) | iOS Builder | 5 cold + 5 fg/bg no false banner; revoke still banners; Rage Report Done / scroll-dismiss reaches Submit |
| 2 | Always emit a string `target` on phase milestones (split + legacy); optional iOS default `"—"` | `generate-widget-snapshots-from-dashboard-snapshot.ts` (+ bundle), tests; optionally `WidgetSnapshots.swift` | UI Expert (generator) ± iOS Builder | Nats Home loads; COACH-HQ-IOS-4 stops recurring on same payload shape |
| 3 (later) | Smooth Home loading | `WarmInstrumentHomeView` / `HomeSkeletonView` | iOS Builder | Cache-first; soft crossfade; no full skeleton on warm cache |

## Done when

- Banner gone for valid sessions; revoke still banners.
- Nats Home shows widgets when hist has this week’s workouts.
- Rage Report Submit reachable with keyboard up.
- #308 closed or split.

## Deferred

- Full loading animation redesign (PR3).
- Settings `lastErrorDetail` — Rage Report covers evidence.
- Auto-dismiss policy for all error toasts.

## Progress

- **PR1 (branch `fix/ios-home-cancel-banner`):** `WidgetSnapshotStore` ignores
  `CancellationError` / `NSURLErrorCancelled` for `lastError`; `isRefreshing` serializes
  all refreshes (incl. `showSpinner: false`). Rage Report: scroll-dismiss keyboard + Done
  toolbar + dismiss on Submit. Device verify (5 cold + 5 fg/bg, revoke still banners)
  still athlete-side.
