# 0037 — A scheduled canary is the second kind of paid check

- **Status:** Accepted · 2026-09-05 · Tech Lead
- **Area:** cross-cutting
- **Context:** ADR 0024 made every paid check name what it could catch in the diff under test.
  That question has no answer for a failure that arrives with no diff. Google changed
  thinking-mode behaviour, coach-message broke in production, and nothing went red (#827). Every
  test in the suite mocks the provider, so none of them could see it.
- **Decision:** A **scheduled canary** is a second category of paid check, beside ADR 0024's
  diff-shaped gates. It runs on a clock, calls the real provider, and names the upstream
  behaviour it watches. The first one is `.github/workflows/smoke-coach-message.yml`: daily, two
  calls per run (one per adapter), about $0.32 a month at the measured $0.0053 a call.
- **Why:** ADR 0024's question is the right one for a gate and the wrong one for drift. What
  bounds a canary is not a diff but a clock and a bill, so it states both.
- **Rejected:** Run it on pull requests → the exact failure ADR 0024 names: paying per PR for a
  check no diff can fail. Widen ADR 0024 to cover both → it would lose the sentence that makes it
  work. Mock the provider and keep it in `npm test` → then it stops testing live behaviour, which
  is the only thing it exists for. Wait for Sentry → that fires after an athlete has already read
  a broken message.
- **Enforces:** A check that watches for provider drift runs on a schedule and names the drift it
  watches. It never gets a `pull_request` trigger.
- **How to apply:** A new canary states three things in its workflow header: the schedule, the
  cost per run and per month, and the upstream behaviour it watches. Every key it needs is
  required — it fails naming a missing secret, and never skips a provider quietly.
