# 0010 — Remove Strava ingestion, relocate shared activity tools out of `strava/`

- **Status:** Accepted · 2026-07-29 · Tech Lead
- **Area:** cross-cutting
- **Context:** The self-serve GitHub auth flow (ADR 0009 and around it) only ever provisions
  new users for iOS/HealthKit sync — no Strava credentials are prompted or set. Strava requires
  a paid Premium subscription and an embedded classic-OAuth-style credential flow that's a real
  liability for App Store distribution. Issue #113 tracked removing it once every athlete this
  repo dogfoods for is off it — confirmed: the owner's own account still uses Strava, but on a
  separate legacy repo this monorepo doesn't touch, and they're moving to the iOS app shortly
  regardless. `engine/strava/query_history.py` and `rename_core.py` are not Strava-specific
  despite the folder name — `query_history.py` just searches local
  `user_data/activities/hist/*.json` and is called from Coach's mandatory boot sequence
  (`platform/soul/B_engine.md` §1 step 7); `rename_core.py` is the naming-convention source of
  truth `ios/CoachHQ/CoachHQ/Services/ActivityNamer.swift` mirrors. Both needed to survive the
  removal.
- **Decision:** Delete `fetch_strava.py`, `strava_api.py`, `oauth_reauth.py`, `rename_single.py`,
  `rename_activities.py`, `run_sync_pipeline.py`, and all `STRAVA_*` secret/env plumbing across
  workflows, provisioning, and the carved skeleton template. Move `query_history.py` and
  `rename_core.py` into `engine/core/` (alongside `taxonomy.py`, which they already relate to)
  and delete the now-empty `engine/strava/`. Update `platform/soul/B_engine.md`'s boot sequence,
  workout-logging, and weekly-review steps to the new path and recompose `propagated/SOUL.md`.
  iOS/HealthKit becomes the only ingestion path; sync workflows call
  `engine/scripts/regenerate_derived.py` directly instead of branching on secret presence.
- **Why:** Removing dead ingestion code and secrets is straightforward; the split matters because
  `query_history.py` is on Coach's critical boot path for every athlete, including ones who never
  had Strava — silently deleting it (rather than relocating) would have broken every coaching
  session. Splitting this into its own PR/ADR (separate from the mechanical Strava-script
  deletion) kept the higher-blast-radius soul-layer edit isolated and reviewable on its own.
- **Rejected:** Delete `query_history.py`/`rename_core.py` along with the rest of `strava/` →
  breaks Coach's mandatory boot step for every athlete, and removes the only spec
  `ActivityNamer.swift` has to stay in sync against. Leave them in a now-single-purpose
  `engine/strava/` folder → keeps a misleading directory name (implies Strava-specific code)
  for logic that's actually sport/source-agnostic; `engine/core/` is where the related
  `taxonomy.py` already lives.
