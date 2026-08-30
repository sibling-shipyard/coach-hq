# Monitoring — active queue

> Status: Current · Owner: Tech Lead · Verified: 2026-08-30 · ADR: [0032](../../kdb/decisions/0032-sentry-data-rules.md)

## Context

Only active observability work belongs here. Shipped history lives in git. Work proceeds by
priority; rows at the same priority may run in parallel where noted.

## Recommended order

After this correction lands: `1 → (2 + 3 in parallel) → 4 → 5 → 6 → 8`.
Item 7 needs the athlete's decision. Items 9–12 are not on the active path.

## P0

No active work.

## P1

| Item | Work | Size | Status | Result |
|---|---|---|---|---|
| 1 | [PR #689](https://github.com/sibling-shipyard/coach-hq/pull/689) error-path flush | Low | In progress — conflicts with `main` | Errors send once, with both the error and ended span visible in production. |
| 2 | TimelineBuffer human-readable evidence | Medium | In progress — parallel iOS diff | The timeline reads like an operator log, with no raw view or type names, file paths, or implementation labels. |
| 3 | Stable Rage Report grouping | Unknown | In progress — parallel iOS diff | Equivalent rage reports land in the same product-owned Sentry group, regardless of UIKit frame. This is separate from items 2 and 6. |
| 4 | Four missing dashboard widgets (questions 3, 4, 6, 7) | Low | Not started | All four questions return production data. |
| 5 | [#638](https://github.com/sibling-shipyard/coach-hq/issues/638) Gemini key header | Low | Not started | The Gemini key never appears in URLs, so outbound spans can be reconsidered safely. |
| 6 | Broad iOS auto-transaction naming | Medium | Not started | After confirming the old sighting still occurs, iOS network activity groups by product operation instead of UIKit gesture. This is separate from item 3. |
| 7 | Three alerts | Low | Deferred — athlete's call | A new production error reaches the operator within 15 minutes. Do not activate without the athlete's decision. |
| 8 | Final observability docs closure | Low | Not started | One permanent observability guide remains alongside the runbook; the three temporary plans are deleted and #585 closes. |

## P2

| Item | Work | Size | Status | Result |
|---|---|---|---|---|
| 9 | Web resource/browser span pruning | Low | Not started | `resource.*` noise is gone while `pageload` and `ui.interaction` remain. |
| 10 | [#343](https://github.com/sibling-shipyard/coach-hq/issues/343) iOS UI tests | High | Tracked in `ROADMAP.md` | The roadmap owns its scope and completion; this queue does not schedule it. |

## Parked

| Item | Work | Size | Status |
|---|---|---|---|
| 11 | Source maps and dSYMs | Medium | Blocked until a TestFlight release workflow exists. |
| 12 | Alert routing beyond email and mobile | Unknown | Deferred. |
