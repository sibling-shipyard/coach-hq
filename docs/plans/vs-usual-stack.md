# Vs-usual activity baseline stack

> Status: Current · Owner: Tech Lead · Verified: 2026-08-23

## Context

Issue #292 needs a durable same-sport baseline because the iOS cache is too short and can be empty
after install. Twenty prior sessions is a product tuning default—twice the former 10-session device
window—not a statistical threshold.

## Decision

Store median baselines on newly synced activity JSON, then let iOS prefer that stored block while
keeping its cache calculation as a fallback. Merge bottom-up; the iOS PR deletes this plan.

| id | files | deps | owner |
|---|---|---|---|
| B1 — complete | `engine/**`, `platform/tests/**`, `docs/eng-docs/ios-sync.md`, this plan | none | Bob the Builder |
| I1 — pending | `ios/**`, delete this plan | B1 | iOS Builder |

## Done when

- Only changed activities gain `vs_usual`; each median has at least two valid observations, and
  the block is omitted when no median qualifies.
- iOS decodes the optional block, prefers it in Activity Detail, and preserves the cache fallback.
- The iOS sync path fetches the post-workflow enriched activity before showing the stored baseline.
- Both PRs pass their focused tests; the finishing iOS PR uses `Fixes: #292` and deletes this plan.

## Deferred

- Revisit the 20-session default only with real athlete history or product evidence.
