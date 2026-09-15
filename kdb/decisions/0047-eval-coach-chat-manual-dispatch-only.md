# 0047 — `eval-coach-chat.yml` runs on manual dispatch only

- **Status:** Accepted · 2026-09-15 · Tech Lead
- **Area:** core
- **Context:** ADR 0024 named a push-to-main gate for `eval-coach-chat.yml`, on paths touching
  prompt construction, the response schema, model config, or the eval harness/fixtures. That
  trigger ran unattended for weeks and stayed red the whole time - nobody noticed until the
  athlete asked, for reasons unrelated to any real regression (a depleted API key, then a
  malformed fixture).
- **Decision:** `eval-coach-chat.yml` runs on `workflow_dispatch` only. No `push` trigger.
- **Why:** a paid check nobody is watching provides no real safety net, only real cost. Every
  other paid check in this repo (the simulation suite, manual live-chat testing) already runs
  only when someone deliberately decides to spend money testing this area - this brings the one
  outlier in line with that discipline.
- **Rejected:** keep the push trigger, just monitor it better → nothing in this repo currently
  reviews CI runs proactively, so "monitor it better" has no owner and would just recreate the
  same silent-failure pattern. Drop the check entirely → it does catch real, live-reproducible
  bugs (a compound-turn `memory_update` drop, 4/4 on rerun, found the same day this ADR was
  written) - the check has real value, the automatic trigger did not. Mark ADR 0024 fully
  Superseded → its general principle (paid checks run at named gates, not every PR) still holds.
  It's cited elsewhere (`bob-the-builder.md`, the PR template). 0024 stays Accepted; this ADR
  only narrows its gate list for `eval-coach-chat.yml`.
- **Enforces:** no workflow in this repo may fire a paid live-model check on `push` without a
  named person or process that actually reads every run's result.
- **How to apply:** run `gh workflow run eval-coach-chat.yml` deliberately, as part of a real
  testing pass, the same way vade-the-tester estimates cost before a live simulation-suite run.
