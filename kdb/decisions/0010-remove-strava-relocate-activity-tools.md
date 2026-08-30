# 0010 — Remove Strava ingestion, relocate shared activity tools out of `strava/`

- **Status:** Accepted · 2026-07-29 · Tech Lead
- **Area:** cross-cutting
- **Context:** Nothing provisioned Strava credentials any more — the self-serve auth flow only
  sets athletes up for iOS/HealthKit sync. Strava also needs a paid subscription and an embedded
  OAuth flow that is a liability for App Store review. But two files under `engine/strava/` were
  not Strava code at all. `query_history.py` searches local activity history and runs on Coach's
  mandatory boot sequence for every athlete; `rename_core.py` is the naming spec that
  `ios/CoachHQ/CoachHQ/Services/ActivityNamer.swift` mirrors.
- **Decision:** Delete the Strava fetch, OAuth and rename scripts, and every `STRAVA_*` secret
  across workflows, provisioning and the carved skeleton. Move `query_history.py` and
  `rename_core.py` to `engine/core/`, beside the `taxonomy.py` they already relate to, and delete
  the empty `engine/strava/`. iOS/HealthKit becomes the only ingestion path.
- **Why:** The folder name was the whole risk. Deleting `engine/strava/` wholesale would have
  taken Coach's boot step with it and broken every coaching session, including for athletes who
  never had Strava.
- **Rejected:** Delete both files with the rest of the folder → breaks Coach's boot for every
  athlete · Leave them in a single-purpose `engine/strava/` → a directory name that lies about
  what the code does.
- **Enforces:** Never infer what a file does from the folder it sits in. Check who calls it first.
