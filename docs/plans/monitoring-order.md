# Monitoring — active queue

> Status: Current · Owner: Tech Lead · Verified: 2026-08-30 · ADR: [0032](../../kdb/decisions/0032-sentry-data-rules.md)

## Context

This is the remaining work for observability. Shipped history lives in git, not in this plan.
Complete the queue in order.

## Queue

1. Repair [PR #689](https://github.com/sibling-shipyard/coach-hq/pull/689). One awaited
   error-path flush must send both the captured error and the ended span without making the
   request wait twice.
2. Finish questions 3, 4, 6, and 7 in
   `docs/eng-docs/ops-monitoring-dashboard.md`, then build the three alerts in
   `docs/eng-docs/sentry-runbook.md`.
3. Fix [#638](https://github.com/sibling-shipyard/coach-hq/issues/638) by moving the Gemini key
   from the URL to the `x-goog-api-key` header.
4. Make TimelineBuffer evidence human-readable. Audit every `TimelineBuffer.record(...)` call
   site and replace implementation-shaped labels with labels an operator can scan.
5. Give Rage Reports stable grouping in `RageReportSubmission.swift` with a custom fingerprint
   or transaction name. This is separate from TimelineBuffer label quality.
6. Close the observability work. Create `docs/eng-docs/ops-observability.md`, fold the durable
   architecture and dashboard truth into it, and keep `docs/eng-docs/sentry-runbook.md` as the
   operator reference. Delete `docs/plans/ops-observability-rage-reports.md`,
   `docs/plans/sentry-lld.md`, and this plan, then close #585.

## Parked

- Upload web source maps and iOS dSYMs to Sentry when the TestFlight release workflow exists.
