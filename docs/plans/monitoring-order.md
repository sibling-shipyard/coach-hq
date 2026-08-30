# Monitoring — active queue

> Status: Current · Owner: Tech Lead · Verified: 2026-08-30 · ADR: [0032](../../kdb/decisions/0032-sentry-data-rules.md)

## Context

Only active observability work belongs here. Shipped history lives in git. Work proceeds by
priority; rows at the same priority may run in parallel where noted.

## P0

No active work.

## P1

| Work | Size | Status | Done when |
|---|---|---|---|
| [PR #689](https://github.com/sibling-shipyard/coach-hq/pull/689) error-path flush | Low | In progress | One awaited flush sends the captured error and ended span with no double wait; production proves it after deploy. |
| Four missing dashboard widgets (questions 3, 4, 6, 7) | Low | Not started | Each question returns a production row. |
| Three alerts | Low | Deferred — athlete's call | A new production error reaches the operator within 15 minutes. Do not activate without the athlete's decision. |
| [#638](https://github.com/sibling-shipyard/coach-hq/issues/638) Gemini key header | Low | Not started | The key is absent from URLs and outbound spans can be reconsidered. |
| Broad iOS auto-transaction naming | Medium | Not started | After confirming the one eight-minute sighting from an older build against a current build, an iOS `http.client` span names its operation rather than a UIKit gesture. This is separate from Rage Report grouping. |
| TimelineBuffer human-readable evidence | Medium | In progress — parallel iOS diff | The timeline has no raw view or type names, file paths, or implementation-shaped labels. |
| Stable Rage Report grouping | Unknown | In progress — parallel iOS diff | Reports from different UI interactions share a deliberate product-owned group. This is separate from TimelineBuffer labels and broad auto-transaction naming. |
| Final observability docs closure | Low | Not started | Create `docs/eng-docs/ops-observability.md`, fold in durable architecture and dashboard truth, keep `docs/eng-docs/sentry-runbook.md`, delete `ops-observability-rage-reports.md`, `sentry-lld.md`, and this plan, then close #585. |

## P2

| Work | Size | Status | Done when |
|---|---|---|---|
| Web resource/browser span pruning | Low | Not started | `resource.*` spans are off while `pageload` and `ui.interaction` survive. |
| [#343](https://github.com/sibling-shipyard/coach-hq/issues/343) iOS UI tests | High | Tracked in `ROADMAP.md` | Roadmap owns execution; this plan does not schedule it. |

## Parked

- Source maps and dSYMs — Medium, blocked until a TestFlight release workflow exists.
- Alert routing beyond email and mobile remains deferred.
