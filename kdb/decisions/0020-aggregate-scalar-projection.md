# 0020 — Aggregate scalar projection boundary

- **Status:** Accepted · 2026-08-03 · Tech Lead
- **Area:** cross-cutting
- **Context:** The `gen/aggregate.json` file produced by `build-aggregate.mjs` and used by the UI loads the full history on boot. Currently, it includes all 85+ fields emitted by the iOS app. Fields like `hr_stream` (9,413 bytes per activity on average) and other time-series arrays like `segment_efforts`, `map`, `laps`, `splits_metric`, `splits_standard` make the JSON payload balloon to >7MB.
- **Decision:** Project activities entering the aggregate down to a strict 20-field scalar allowlist (e.g., `id`, `name`, `distance`, `moving_time`, `average_heartrate`).
- **Why:** The TS-readable aggregate should only contain scalars for fast loading. High-fidelity time-series data or heavy arrays (like `hr_stream`) remain in `user_data/activities/hist/*.json` (the Swift contract) and should be fetched individually on demand when a detail view needs them. This reduces aggregate payload size from ~7.16MB to under 1MB.
- **Rejected:** Removing time-series from the source `hist/` files. That would break the iOS Swift `Activity` decoder and permanently lose the data. Projecting at the aggregate boundary solves size without data loss.
