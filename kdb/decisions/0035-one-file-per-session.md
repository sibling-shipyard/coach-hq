# 0035 — One committed file per real session

- **Status:** Accepted · 2026-08-31 · Tech Lead
- **Area:** cross-cutting (iOS sync)
- **Narrows:** ADR 0014. The uuid remains the file key. Filename-only dedup is no longer enough.
- **Context:** Garmin Connect deletes a HealthKit workout and writes it again. Apple assigns a
  new UUID. We treated that as a new session, so one gym became three files and three `#N`
  names. Heart-rate that arrived on a later write never reached the first file.
- **Decision:** One `hist/` file per real session. The first uuid stays the filename and `id`.
  Later recordings that match that session upsert the same file and record the new uuid as an
  alias. Coach is called only for an insert.
- **Why:** The uuid is assigned at save. A rewrite is a new save, so it cannot be the session
  key. Time overlap against committed hist is what still names the same gym.
- **Rejected:** Upsert by uuid only → misses Garmin. Delete the old file and insert under the
  new uuid → breaks streams and Coach ids. Ping Coach when HR first appears → not a new
  activity.
- **Enforces:** Never insert a second hist file for a session already in `hist/`. Never POST
  coach-message for an upsert.
- **How to apply:** Match in order: exact uuid, then aliases, then same-group overlap of ≥50%
  of the shorter window. If sport differs, also match when start is within 2 minutes and overlap
  is ≥50% of the shorter window. `ActivityNamer.assignName` runs on insert only. Re-fetch HR for
  incomplete sessions in the 14-day window. Manual import uses the same match. Cleanup of files
  already duplicated is a separate hist script, not the iOS round.

Plan: `docs/plans/ios-session-upsert.md`.
