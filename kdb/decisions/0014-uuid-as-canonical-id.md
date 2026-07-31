# 0014 — Use HealthKit workout UUID as stable canonical id

- **Status:** Accepted · 2026-08-01 · Tech Lead
- **Area:** cross-cutting
- **Context:** HealthKit workouts previously lacked a stable identifier (ingested with sequential slug-based names), causing duplicate ingestions if date-shifted and preventing successful completion-linking to weekly widget sessions (which coerced IDs to integers, dropping UUID strings).
- **Decision:** Use the native `HKWorkout.uuid` as the stable canonical identifier (`id`/`id_str` in JSON, and encoded in the filename `hk_<date>_<uuid>.json`). Pre-existing slug-named files will co-exist without back-migration.
- **Why:** The deterministic UUID allows cheap filename-based deduplication on device prior to push. Since sync only moves forward from the last synced watermark, legacy files do not need migration.
- **Rejected:** Back-migrating legacy activities → rejected due to risk of parsing errors for historical data, plus legacy files are never re-synced anyway.
