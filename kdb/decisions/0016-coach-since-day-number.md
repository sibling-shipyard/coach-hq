# 0016 — `coach_since`: a durable day-number anchor, independent of season/challenge

- **Status:** Accepted · 2026-08-02 · Tech Lead
- **Area:** cross-cutting
- **Context:** Coach Chat's "D-N" header and the terminal session's `coach: day-[X] — ...` commit
  convention both need a day number meaning "days since this athlete started using Coach at
  all." Today both derive it from `challenge.start_date`/`season.start_date`, which resets every
  time a new challenge or season begins — the confirmed root cause of issue #179's original
  "D-1" bug report. `repo.created_at` was tested as a free alternative and rejected: Skanda's
  repo was recreated during the HQ migration, so `created_at` is 5 days old despite a year of
  real coaching history — not durable enough.
- **Decision:** Add `coach_since` (date, `YYYY-MM-DD`) as a new **top-level** field in
  `challenge_v2.json`, sibling to `season`/`phase`/`main_quest` — never nested inside a block
  that itself resets. Written once, at provisioning, and never overwritten afterward. Every
  reader (web, iOS, Coach Chat backend, terminal session boot) computes day number from
  `coach_since` first, falling back to `season.start_date` then the legacy `challenge.start_date`
  for repos not yet backfilled, so nothing breaks before a repo has the field.
- **Why:** A single durable anchor, set once, is simpler and more reliable than trying to
  reconstruct "when did this athlete start" from data that legitimately resets (season/challenge
  cycles) or that can silently change for unrelated infra reasons (repo recreation/migration).
- **Rejected:** `repo.created_at` (proven unreliable above). Deriving it from the earliest
  activity/session file (fragile — depends on what synced, and errors toward showing time before
  the athlete used Coach specifically rather than time since they started coaching with this
  system). Storing it in `state.md` instead of `challenge_v2.json` (state.md is coach-owned
  prose, not a stable machine-read field both platforms' existing fetch paths already hit).

**Backfill:** No script infers this for existing athletes — the value is supplied deliberately,
per athlete, because getting it wrong is worse than leaving it unset (falls back gracefully).
Skanda's repo (`skanda-2003/coach-skanda`) backfilled directly at `coach_since: 2026-04-28`.
Akash's repo intentionally left untouched — a suggested value was proposed to him via a separate
issue, not assumed on his behalf.
