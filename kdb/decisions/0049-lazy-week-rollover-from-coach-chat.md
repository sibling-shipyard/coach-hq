# 0049 — Lazy week rollover from coach-chat, alongside the CI job

- **Status:** Accepted · 2026-09-16 · Tech Lead
- **Area:** core
- **Context:** `current_week.json`'s rollover only runs as a step inside
  `engine/.github/workflows/sync.user.yml`, itself triggered only by the iOS app's own
  activity-sync push. An athlete who hasn't synced recently gets no rollover at all - 2 of the 5
  real athlete repos are currently a full ISO week behind on their week *frame*, not just its
  content.
- **Decision:** `coachTurn.ts` checks `needsRollover` on every turn (from the shared
  `currentWeekRollover.mts` module, #1105 track C) and folds a fresh placeholder into that
  turn's own commit when the week has aged out, the same pattern `coach_since` (ADR 0018) uses.
  The CI job's own rollover step stays as-is, unchanged.
- **Why:** `needsRollover` is already a pure, cheap date comparison, and its one dependency
  (`parseCurrentWeek`) is already bundled for the Vercel function. The first athlete message
  after a stale boundary is a far tighter bound than waiting on the next iOS activity sync.
- **Rejected:** Move rollover onto a cron trigger in `sync.user.yml` → still leaves a window
  between the cron firing and the athlete's next turn, and adds a scheduled job where this repo
  has none today. Port `reconcile-current-week.mjs`'s matching logic too → needs a full
  `user_data/activities/hist/` read with no equivalent path in coach-chat today; out of scope
  here.
- **Enforces:** `current_week.json`'s rollover must not depend solely on the athlete's device
  having synced activity data - any future write path here has to keep the week frame at most
  one turn stale.
- **How to apply:** `needsRollover`/`buildRolloverPlaceholder` live in one place
  (`engine/lib/currentWeekRollover.mts`) - a future change to rollover's date logic must edit
  that module, not re-derive it separately in `coachTurn.ts` or the CI script.
  `current_week.json` now has three writers: chat commits, the CI reconciler, CI rollover, and
  this lazy check. A race between them is a correctness non-issue, since `needsRollover` is
  idempotent and `commitFilesAtomic` already reads HEAD fresh right before committing. Don't add
  locking to fix this.
