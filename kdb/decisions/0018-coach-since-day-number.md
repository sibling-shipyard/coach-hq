# 0018 — `coach_since`: a durable day-number anchor, set at First Session Protocol completion

- **Status:** Accepted · 2026-08-02 · Tech Lead · **backfill clause is spent** — `provision-user.sh`
  is deleted, issue #199 completed the one backfill it existed for, and both live repos carry a
  confirmed value. `injectCoachSinceIfNeeded` is now the sole writer.
- **Area:** cross-cutting (coach-chat backend, terminal SOUL, web, iOS)
- **Context:** Every "day-N" display was computed from `season.start_date` or
  `challenge.start_date`. Both reset when a new block begins, so an athlete a year into coaching
  watches the count drop to single digits the moment a season rolls over. Akash flagged exactly
  this on the original PR. An earlier design stamped a new field at repo-provisioning time
  instead. That is the same infra-timestamp anchor already rejected for `repo.created_at`. It
  records when a repo was made, not when a coaching relationship started, and it resets if the
  repo is ever recreated.
- **Decision:** Add `coach_since` to `challenge_v2.json` as a top-level, write-once date. The
  server sets it in `coach-chat.ts` the first time the athlete's `state.md` profile flips from
  incomplete to complete — the turn that genuinely finishes the First Session Protocol. The
  backend detects that transition itself and injects the field into the same turn's write, rather
  than trusting the model to propose it. Every consumer resolves
  `coach_since ?? season.start_date ?? challenge.start_date`.
- **Why:** Completing the First Session is a real event in the athlete's own data, so the anchor
  survives what infra timestamps do not — the same repo, re-provisioned or migrated, keeps its
  start as long as `state.md` does. The fallback chain means repos stamped before the field
  existed degrade to the old behaviour instead of showing a blank.
- **Rejected:** Stamp at provisioning → the infra-timestamp anchor this ADR exists to avoid ·
  Derive from `repo.created_at` → the same problem, one layer removed · Guess a plausible date for
  existing athletes → the field is write-once, so a wrong guess can never be corrected.
- **Enforces:** A "since" date anchors to an event in the athlete's own data, never to
  infrastructure. Never write `coach_since` a second time.
- **How to apply:** Any new day-number display reads `coach_since` first, then
  `season.start_date`, then `challenge.start_date` — never `repo.created_at`, never a fresh guess.
  Four implementations run this same chain: `injectCoachSinceIfNeeded` and `coachDayNumber` in
  `ui/api/coach-chat.ts`, `challengeDayNumber` in
  `ui/client/src/components/coach-chat/coachChatModel.ts`, iOS's `readCoachDayAnchorDate()`, and
  `platform/soul/B_engine.md` §1 step 7.
