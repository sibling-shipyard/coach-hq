# 0014 — Use HealthKit workout UUID as stable canonical id

- **Status:** Accepted · 2026-08-01 · Tech Lead
- **Area:** cross-cutting
- **Context:** HealthKit workouts arrived with sequential slug names and no stable id. Two things
  broke. A workout whose date shifted was ingested twice, because nothing identified it as the
  same workout. And completion-linking to weekly widget sessions coerced ids to integers, which
  silently dropped any string id.
- **Decision:** Use the native `HKWorkout.uuid` as the canonical id — as `id`/`id_str` in the
  JSON, and in the filename `hk_<date>_<uuid>.json`. Files already written under slug names stay
  as they are.
- **Why:** The uuid is deterministic, so the device can deduplicate on filename alone before it
  pushes anything. Sync only moves forward from the last watermark, so old files are never
  re-read and never need migrating.
- **Rejected:** Back-migrate the slug-named files → risks parsing errors across historical data
  to fix records nothing will read again.
- **Enforces:** An id comes from the source system. Never mint one from a name, a sequence, or a
  date, and never narrow an id's type on the way through a consumer.
