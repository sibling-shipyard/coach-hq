# iOS (HealthKit) Sync — how it works

## Context

Akash's data comes from Apple Health via the native iOS app under `ios/` — this is the only
ingestion path this repo supports (Strava ingestion was removed, issue #113). This doc traces
exactly what happens when he presses Sync in the app: it talks straight to GitHub's API from
the phone, no GitHub Actions involved in the sync action itself.

## Overview

```mermaid
flowchart LR
    btn["Sync Now button /  pull-to-refresh"] --> mgr["HealthKitSyncManager.syncNewWorkouts()"]
    mgr --> hk["HealthKit query on-device"]
    mgr --> api["GitHubAPIClient (Git Data API)"]
    api -->|"atomic multi-file commit"| repo["push to main"]
    repo -->|"push trigger, fork only"| wf["sync.user.yml runs downstream pipeline"]
```

## Trigger — pressing Sync

Entry points, all calling the same manager:

- `SyncStatusView.swift` — the "Sync Now" button.
- Pull-to-refresh on the same screen.
- `ActivityListView.swift` — sync from the activity list.
- Background HealthKit delivery — iOS can wake the app on new workouts.

All of them call `HealthKitSyncManager.syncNewWorkouts()` directly, on-device. **No workflow is
dispatched** — this is the structural difference from Strava sync, which always goes through
GitHub Actions.

## What `syncNewWorkouts()` does, in order

```mermaid
sequenceDiagram
    participant U as User
    participant M as HealthKitSyncManager
    participant HK as HealthKit
    participant GH as GitHub API
    U->>M: tap Sync Now
    M->>GH: read user_data/activities/sync_state.json
    M->>HK: query workouts since hk_last_synced
    M->>GH: list files in user_data/activities/hist/ (dedup)
    loop each new workout
        M->>M: ActivityMapper.map (schema + HR zones)
        M->>M: ActivityNamer assigns name + filename
    end
    M->>GH: commitFiles() - atomic multi-file commit
    GH-->>M: push to main
    M->>M: refresh local cache + widget snapshot cache (read-only)
```

1. **Read sync state** — `apiClient.readSyncState()` fetches
   `user_data/activities/sync_state.json` from GitHub to get `hk_last_synced` (defaults to 7 days
   back if missing).
2. **Query HealthKit** — pulls `HKWorkout` samples since that date. Local device data, not a repo
   file. If nothing new, stops here.
3. **List existing history** — fetches the file list in `user_data/activities/hist/` from GitHub,
   for dedup.
4. **Per new workout:**
   - `ActivityMapper.map()` converts the `HKWorkout` to the shared Activity schema (sport type,
     times, calories, distance, device).
   - Dedup-checks the filename against Strava-style naming, so a workout that also later syncs
     from Strava (e.g. via an Apple Watch → Strava → this repo's Strava sync) doesn't get counted
     twice.
   - Fetches heart-rate samples for the workout window, computes avg/max HR and zone 1-5 time
     distribution.
   - `ActivityNamer` assigns the sequential name (e.g. "WeightTraining #30") and the filename —
     `hk_YYYY-MM-DD_<uuid>.json`, where `<uuid>` is the `HKWorkout.uuid`. The `hk_` prefix
     distinguishes it from Strava-sourced files.
   - It derives a 3-letter `category` code (e.g., "FDN", "RNK") based on the `categories.json` config file in the athlete repo, using `sport_type` and ordered first-match rules for workout metadata (duration, weekday). This handles machine classification without regex parsing names, writing it to the activity file.

### Canonical id — HKWorkout uuid

Each HealthKit activity carries a **stable canonical id** = its `HKWorkout.uuid`, written in two
places:

- **In the JSON** — `id` and `id_str` fields (`ActivityMapper` sets both from `workout.uuid`).
  `Activity` decodes `id` flexibly (String *or* Int) so legacy Strava history files, which store
  `id` as a JSON number, still decode when the app reads them (cache warming).
- **In the filename** — `hk_<date>_<uuid>.json`. Because the uuid is deterministic, re-syncing the
  same workout produces the exact same filename, so dedup is a pure filename check (two guards:
  exact-name match, plus a `_<uuid>.json` substring guard right before commit). No file contents
  are read for dedup, keeping sync cheap.

**Accepted gap — no migration.** Pre-existing slug-named files (`hk_<date>_<category>_<n>.json`)
are **not** migrated: they keep their slug filenames and have no `id`/`id_str`. This is fine
because sync only moves forward from the `hk_last_synced` watermark and nothing looks activities up
by uuid — the old files are never re-examined.
5. **Commit** — `GitHubAPIClient.commitFiles()` batches the new activity file(s) plus the updated
   `sync_state.json` into **one atomic commit** using GitHub's Git Data API (create blobs → read
   HEAD → build tree → create commit → move the branch ref), retried against a fresh HEAD on a
   non-fast-forward conflict. Pushed straight to `main`.
6. **Locally only** — updates an on-device cache for instant list rendering, and refreshes the
   local widget snapshot cache from whatever `gen/widget_snapshots.json` **already** contains on
   GitHub. It does not regenerate that file — it just re-reads it.

## What does NOT happen in this action

No quest log, no challenge ledger update, no UI/widget snapshot regeneration happens as part of
an iOS sync. The code says so directly (comment in `HealthKitSyncManager.swift`): the widget
snapshot pipeline "runs on the next sync/build" — this action just picks up whatever's already
there.

Those downstream artifacts only get regenerated when the sync workflow runs. On a user fork,
`engine/.github/workflows/sync.user.yml` has a `push` trigger on `user_data/activities/hist/**`
and `user_data/activities/sync_state.json` — exactly the files this iOS commit touches. So an
iOS sync **does indirectly trigger a second, automatic GitHub Actions run**, which calls
`engine/scripts/regenerate_derived.py` and `engine/scripts/build-aggregate.mjs` to rebuild
`gen/aggregate.json`, `gen/quest_log.md`, etc.

## Auth

OAuth 2.0 Authorization Code flow via `ASWebAuthenticationSession`
(`GitHubAuthManager.swift`) on first login: opens `github.com/login/oauth/authorize` with
`scope=repo`, exchanges the code for a token, stores it in the iOS **Keychain** (not a baked-in
PAT — per-user OAuth). `discoverRepo()` auto-detects the user's repo by naming convention. Every
API call attaches `Authorization: Bearer <token>`. No server, no shared secret — GitHub is the
only backend.

## A correction worth noting

`apply-coach-patch.yml` lives only in athlete repos — carved from
`engine/.github/workflows/apply-coach-patch.yml` into each fork's `.github/workflows/`. It is
unrelated to HealthKit sync: a generic `workflow_dispatch` that commits a pasted Coach chat patch.
Not referenced in the iOS codebase. `AGENTS.md` no longer documents it as a phone fallback.

## Files changed — summary

| File | Written by | Notes |
|---|---|---|
| `user_data/activities/hist/hk_<date>_<uuid>.json` | `HealthKitSyncManager` | one per new HealthKit workout; filename + JSON `id`/`id_str` = HKWorkout uuid |
| `user_data/activities/sync_state.json` | `HealthKitSyncManager` | `hk_last_synced` + naming counters |

That's the entire write set for the sync action itself — much shorter than Strava's, because
everything else (quest log, ledger, snapshots) is deferred to the downstream pipeline run
described above.

**Read-only** in this flow: `gen/widget_snapshots.json` (refreshes local cache from it, doesn't
write it), `user_data/ebadders_history.json` (badminton match history), individual activity
files.

## Appendix — file/class reference

| File | Role |
|---|---|
| `ios/CoachHQ/CoachHQ/Views/SyncStatusView.swift` | Sync Now button, pull-to-refresh |
| `ios/CoachHQ/CoachHQ/Views/ActivityListView.swift` | secondary sync trigger |
| `ios/CoachHQ/CoachHQ/Services/HealthKitSyncManager.swift` | orchestrates the whole flow |
| `ios/CoachHQ/CoachHQ/Services/ActivityMapper.swift` | HKWorkout → Activity schema, HR zones |
| `ios/CoachHQ/CoachHQ/Services/ActivityNamer.swift` | sequential naming, filenames |
| `ios/CoachHQ/CoachHQ/Services/GitHubAPIClient.swift` | Git Data API commits, reads |
| `ios/CoachHQ/CoachHQ/Services/GitHubAuthManager.swift` | OAuth + Keychain token storage |