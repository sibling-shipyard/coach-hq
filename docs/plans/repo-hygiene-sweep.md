# Repo hygiene sweep

> Status: Plan · Owner: Tech Lead · Created: 2026-09-19 · LLD: [`repo-hygiene-sweep-lld.md`](repo-hygiene-sweep-lld.md)

## Context

A repo-wide audit ran over prose, code and enforcement. The repo is healthier than this plan's
length suggests - zero unreferenced TypeScript exports, zero skipped tests, two TODOs in the whole
source tree, and no `Verified:` date stale by the repo's own 60/90-day rule. The problems are
narrower and worse than rot: a secret that is not scrubbed, a carve that ships athletes a broken
SOUL, and a lint baseline muting 12 real findings.

Evidence for every claim is in the LLD. Nothing here is deferred.

## Decision

Twenty-one PRs across eight milestones, ordered so the athlete-facing and security items land
first and the cosmetic ones last.

```mermaid
graph LR
  M1["M1 Secrets<br/>PR 1-2"] --> M7["M7 Boundary<br/>PR 17-18"]
  M2["M2 Carve<br/>PR 3-4"]
  M3["M3 Enforcement<br/>PR 5-8"] --> M4["M4 Prose<br/>PR 9-11"]
  M5["M5 UI weight<br/>PR 12-13"] --> M6["M6 Retired names<br/>PR 14-16"]
  M6 --> M7
  M7 --> M8["M8 Splits<br/>PR 19-21"]
```

### The five that matter

1. **The Sentry scrubber protects the wrong key.** `ui/api/_lib/sentry.ts:73-79` scrubs
	`GEMINI_API_KEY`, which ADR 0046 removed from Vercel, and not `OPENROUTER_API_KEY`, which
	production sends as a bearer token.
2. **The carve ships a SOUL pointing at files it never writes.** Three `propagated/docs/` pointers
	and two workout templates are referenced by SOUL and not carved. BYOB is live (ADR 0021
	retracted its retirement), so this breaks real athlete repos.
3. **`validate-soul` already catches #2 and has been muted since 2026-09-11** - 12 known findings,
	exit 0, `continue-on-error: true`, no burn-down.
4. **`docs/eng-docs/env-vars.md` states the opposite of ADR 0046** on which provider production
	runs, and omits five live env vars from a page that calls itself canonical.
5. **`shared/warm-instrument/**` runs four blocking local checks and zero CI checks.** Same shape
	for lint and format across half of `ui/`.

## Done when

1. `node platform/scripts/validate-soul.mjs` prints `0 known / 0 new` and the baseline file is
	empty.
2. A deliberate SOUL, workflow or dead-path drift fails CI on a scratch branch.
3. A test proves an `OPENROUTER_API_KEY` value in a Sentry breadcrumb is redacted.
4. No `Status: Current` doc names a path that does not exist, or says "used to" / "no longer".
5. `grep -rn "function localDateKey" ui` returns one hit.

## Execution stack

| PR | milestone | outcome | final base | files | owner | parallel with | result |
|---|---|---|---|---|---|---|---|
| 1 | M1 Secrets | OpenRouter key scrubbed; stale comment gone | main | `ui/api/_lib/sentry.ts`, `ui/observability/sentryScrubber.ts`, `ui/api/_lib/_tests/sentry.test.ts` | Bob | 3 | leaked key filtered, with a test |
| 2 | M1 Secrets | env truth matches ADR 0046 | 1 | `docs/eng-docs/env-vars.md`, `ui/api/_lib/llmClient.ts` | Bob | 3 | `env-vars.md` is true |
| 3 | M2 Carve | 3 docs + 2 templates carved; test asserts it | main | `platform/scripts/carve-skeleton.mjs`, `platform/tests/test_carve_skeleton.py`, `platform/validate-soul-baseline.json` | Tech Lead | 1, 2 | `validate-soul` prints `0 known` |
| 4 | M2 Carve | `validate-soul` blocks | 3 | `platform/scripts/checks.conf`, `.github/workflows/validate-soul.yml` | Tech Lead | - | new drift fails CI |
| 5 | M3 Enforcement | `shared/**` and all of `ui/` gain CI coverage | main | `.github/workflows/{ui-tests,ui-tooling-tests}.yml` | subagent | 6 | no blocking local check is CI-invisible |
| 6 | M3 Enforcement | `validate-kdb` fires on what it scans | 5 | `.github/workflows/validate-kdb.yml` | subagent | - | a dead path in a workflow fails CI |
| 7 | M3 Enforcement | cron jobs report their own failure | 6 | `.github/workflows/{sentry-digest,span-health}.yml`, `docs/eng-docs/sentry-runbook.md` | subagent | - | a dead digest is visible |
| 8 | M3 Enforcement | duplicate CI work dropped; orphan checkers resolved | 7 | `ui-tooling-tests.yml`, `ui/docs/reference_interactions_check.py`, `ui/package.json`, `platform/scripts/checks.conf` | subagent | - | one `vitest scripts/lib` run |
| 9 | M4 Prose | dead ref-docs and false path claims removed | main | delete `docs/ref-docs/season-close.md`; `docs/ref-docs/milestone-schema.md`, `platform/scripts/carve-skeleton.mjs`, `kdb/decisions/0022-*.md`, `.github/agents/{bob-the-builder,tech-lead}.md` | Tech Lead | 5-8, 12 | no doc names a missing path |
| 10 | M4 Prose | 5 dead plans deleted; boot claims corrected | 9 | delete `docs/plans/{ops-agent-setup,coach-chat-live-test-round-2,openrouter-m2-chat-lld,agent-restructure,backend-decision}.md`; `AGENTS.md` | Tech Lead | 12 | `docs/plans/` holds only live work |
| 11 | M4 Prose | chronology purged; `gemini-flow.md` in budget | 10 | 12 files under `docs/eng-docs/` | Tech Lead | 12 | no "used to" in a Current doc |
| 12 | M5 UI weight | 18 unused primitives and 7 deps deleted | main | `ui/client/src/components/ui/*`, `ui/package.json`, `ui/package-lock.json` | UI Expert | 9-11 | build green, bundle smaller |
| 13 | M5 UI weight | one date module; 9 duplicates collapse | 12 | new `ui/client/src/lib/dates.ts`; lens models, `home-warm/*`, `lib/activities.ts`, `lib/challenge.ts` | UI Expert | 14 | one Monday formula |
| 14 | M6 Retired names | iOS dead code deleted | main | delete `EnginePageView.swift` (keep `EnginePageMath`), `BundledTemplates.swift`; `InstrumentHeaderView.swift` | iOS Builder | 12, 13 | iOS build + tests green |
| 15 | M6 Retired names | dead params gone; one name for coach-day | 13 | `liveWeekContract.ts`, `coachDay.ts` + test, `coachChatModel.ts`, `CoachChat.tsx`, `CoachChatView.swift` | Bob | - | no user-facing "Gemini" |
| 16 | M6 Retired names | back-compat states its exit; dead write removed | 15 | `repo-resolution.ts`, `fileEdits.ts`, `engine/core/query_history.py` | Bob | - | every back-compat path names its exit |
| 17 | M7 Boundary | the ledger boundary is typed | 15 | `hooks/useRepoData.ts` and `tsc` fallout | UI Expert | 18 | `SplitLedger` not bypassed at entry |
| 18 | M7 Boundary | 2 silent failures report | 17 | `commit/activitySyncTurn.ts`, `auth/[...action].ts` | Bob | - | a GitHub outage is visible |
| 19 | M8 Splits | `HealthKitSyncManager` split by job | 14 | `ios/.../HealthKitSyncManager.swift` | iOS Builder | 20, 21 | each file under ~600 lines |
| 20 | M8 Splits | auth router split from PKCE and refresh | 18 | `ui/api/auth/[...action].ts` | Bob | 19, 21 | router is routing only |
| 21 | M8 Splits | reprompt test split by scenario | 18 | `coachTurn-reprompt.test.ts` | Bob | 19, 20 | same assertions, readable files |

**Parallelism:** 1-2 and 3-4 share no files and run concurrently. 5-8 are a serial chain over the
workflow files. 12 → 13 → 17 is one serial chain over `ui/client/src`; 15 follows 13 to avoid
conflicting in `coachChatModel.ts`. 14 and 19 are the only `ios/` PRs and are serial.

## Deferred

Nothing. Every finding has a PR above.
