# Repo hygiene sweep - evidence

> Status: Plan · Owner: Tech Lead · Created: 2026-09-19 · HLD: [`repo-hygiene-sweep.md`](repo-hygiene-sweep.md)

Evidence for every PR in the HLD stack. Each claim carries `file:line` and the command that proved
it. Findings I could not prove are marked SUSPECTED and named as such.

## M1 Secrets - PR 1, 2

**PR 1.** `ui/api/_lib/sentry.ts:73-79`:

```ts
return [process.env.GEMINI_API_KEY, process.env.SESSION_SECRET, process.env.GITHUB_APP_CLIENT_SECRET]
```

ADR 0046 moved production to OpenRouter and removed `GEMINI_API_KEY` from Vercel, so the only LLM
key scrubbed is the one that is not set. `ui/api/_lib/llmAdapters/openRouterAdapter.ts:142` sends
`Authorization: Bearer ${apiKey}`, and the `Bearer` pattern at
`ui/observability/sentryScrubber.ts:16` matches `Bearer eyJ…` (JWT) only. `sentryScrubber.ts:3-19`
carries `"gemini_api_key"` and `/AIza[0-9A-Za-z_-]{35}/` with no OpenRouter key shape.

Also `ui/api/_lib/sentry.ts:83` says `coachLlmClient.ts` "puts the API key in the query string".
Both adapters use header auth (`geminiAdapter.ts:153`, `openRouterAdapter.ts:142`) and
`coachLlmClient.ts` holds no key. That comment is the stated justification for a blanket
`ignoreOutgoingRequests`, so it is load-bearing and wrong.

**PR 2.** `docs/eng-docs/env-vars.md:36` says `LLM_PROVIDER` falls back to `"gemini"` - "the
default, and what production runs"; `:24` lists `GEMINI_API_KEY` under Required.
`kdb/decisions/0046-*.md` says production runs OpenRouter and the key was deleted from Vercel.
`ui/api/_lib/llmClient.ts:6-9,122-124` repeats the wrong default.

Five live vars are absent from a page that claims at `:10` to be the canonical list:
`COACH_CHAT_DEBUG_PROMPT` (`coachLlmClient.ts:91`), `COACH_CHAT_EXPOSE_USAGE`
(`requestCoachReply.ts:110`), `SPAN_HEALTH_WINDOW` (`check-span-health.mjs:30`),
`ATHLETE_REPO_PATH`, `AGENT_KIT_ROOT`.

## M2 Carve - PR 3, 4

**What I checked, and what I first got wrong.** `platform/scripts/carve-skeleton.mjs` carves three
docs into `propagated/docs/` (`:574-578`: `current-week-contract.md`, `timer-state-machine.md`,
`pipeline-tools.md`) and two starter templates (`:56`). `SOUL.claude.md` names more than that.
I first read every extra name as a defect. Checking the script, the repo's own docs and a real
athlete repo (`skanda-2003/coach-skanda-2003`) shows only one is.

| SOUL pointer | Carved? | Verdict |
|---|---|---|
| `propagated/docs/badminton-plugin.md` (`SOUL.claude.md:345`) | No | **Real gap.** The doc's own header says "NOT WIRED UP YET ... Coach follows the pointer and finds nothing". `soul-path-to-v6.md` phase 2 names it urgent. `coach-skanda-2003/propagated/docs/` holds six files and not this one. |
| `phelps-voice-profile.md`, `soul-calibration.md` (`SOUL.claude.md:27`) | No | **Intentional.** `soul-path-to-v6.md:86` says not to restore them, and that SOUL line tells Coach not to read them at boot. Both exist in `coach-skanda-2003`, left from an earlier carve. |
| `strength_b.json`, `recovery.json` (`SOUL.claude.md:269`, `SOUL.chat.md:171`) | No, by design | **Not a carve gap.** #727 replaced picking a frozen template with catalog-based `workout_create` (`platform-workouts-compiler.md:5-8`), so a new repo gets two starters. SOUL step 7 is stale wording, which is a SOUL edit and out of this plan. |

The gap only bites when `plugins.json` enables badminton. `coach-skanda-2003` has
`"enabled": []`, so I have no evidence any live athlete hits it today. I earlier called it a live
dead-end. That was wrong.

**PR 3.** Add `badminton-plugin.md` to `PROPAGATED_DOCS`, drop the "NOT WIRED UP YET" banner from
the doc, and fix its row in `docs/ref-docs/README.md`. `platform/tests/test_carve_skeleton.py`
has two tests and none checks `propagated/docs/`, so PR 3 adds one that asserts every
`PROPAGATED_DOCS` entry is written. Then run `--update-baseline` so that one finding leaves the
baseline.

**PR 4.** `validate-soul.mjs:676-682` exits 1 only on a new finding, and exits 0 on known ones.
That rule is right. But `platform/scripts/checks.conf:8` marks the check `warn` and
`.github/workflows/validate-soul.yml:69` sets `continue-on-error: true`, so nothing it finds can
fail anything. `platform/validate-soul-baseline.json` was last written 2026-09-11. Running it
today prints `12 known / 0 new`. After PR 3 that is 11, and they stay baselined: the two
intentional docs, four template findings, two `paths-exist` and three `writable` entries. PR 4
makes the check blocking and gives the two `[unclassified]` entries a written reason.

## M3 Enforcement - PR 5-8

1. **`shared/warm-instrument/**` has four blocking local checks and zero CI checks.**
	`platform/scripts/checks.conf:2-5` lists it under `ui typecheck`, `ui lint`, `ui format`,
	`ui tests`. `.github/workflows/ui-tests.yml:23-35` has no `shared/**` entry.
	`.github/workflows/validate-tokens.yml:32-35` fires on the path but only runs
	`generate.mjs && git diff --exit-code` - a drift check, not typecheck or tests.
	`ui/vitest.config.ts:14` aliases `@warm-instrument` into the test tree, so it is live code.
2. **Lint and format never run in CI for about half of `ui/`.** `ui-tooling-tests.yml:47-51` runs
	only `npm run check` and `npx vitest run scripts/lib`. Files under no workflow `paths:` at all
	include `ui/eslint.config.js`, `ui/.prettierrc.json`, `ui/docs/**` - so the
	config that defines the gate triggers nothing, while a prettier violation in `ui/docs/*.md`
	blocks every local push and can never fail CI.
3. **`validate-kdb.yml:18-24` does not fire on what `validate_kdb.py:177-182` scans** -
	`.github/workflows/*.yml`, `.githooks/*`, `.claude/hooks/*`, `.cursor/**`,
	`platform/scripts/checks.conf`. `check.sh:66-72` runs it locally with `PATHS+=("*")`.
	`validate_kdb.py:153-155` names this exact past failure.
4. **No workflow has any failure notification.** `grep -rn "failure()\|notify" .github/workflows/`
	returns nothing. `sentry-digest.yml:6-8` (cron) exits 1 on a missing token (`:54-57`) and its
	design is "stays silent unless something is new" (`:3-4`) - so a dead job is indistinguishable
	from a quiet day. `span-health.yml:6-7,30-34` is the same shape, and the runbook at
	`sentry-runbook.md:80-88` calls span-health the absence detector while nothing detects its own
	absence. `sentry-runbook.md:244,311-336` does not mention GitHub Actions.
5. **Duplicate work.** `ui/vitest.config.ts:22` already includes `scripts/**/*.test.ts`, so
	`ui-tests.yml:69` runs the `scripts/lib` suite; `ui-tooling-tests.yml:51` runs it again, paying
	a second `npm ci` + `tsc`.
6. **Orphan checkers.** `grep -rn reference_interactions_check .` returns only
	`ui/docs/reference_interactions_check.py` itself. `check:coverage-reconciliation`
	(`ui/scripts/checks/check-coverage-reconciliation.ts`) appears in no workflow, no `checks.conf`.
7. **`checks.conf:11` claims a glob it does not test** - it globs `engine/lib/**` but runs
	`engine/scripts/*.test.mjs`, while `engine/lib/` holds `.mts` tests. `platform-tests.yml:56`
	inherits the same mismatch verbatim.

Clean: zero skipped tests (`grep -rn "\.skip(\|xit(\|it\.todo\|\.only("` over the source tree finds
no test-framework hits). ADR 0024 holds - the only paid check, `eval-coach-chat.yml:11-12`, is
`workflow_dispatch` only per ADR 0047.

## M4 UI weight - PR 9, 10

**PR 9 - 18 of 27 shadcn primitives are unimported.** Only nine appear in any import:

```
$ grep -rhn "components/ui/" ui/client/src | grep -o '"@/components/ui/[a-z-]*"' | sort | uniq -c
   3 separator   3 button   2 tooltip   2 input   2 dialog
   1 textarea    1 sonner   1 skeleton  1 sheet
```

The other 18 total 2294 lines. By size: `sidebar` (699), `chart` (324), `item` (172),
`select` (170), `input-group` (156), `pagination` (106), `breadcrumb` (102), `empty` (94),
`table` (90), `button-group` (78), `card` (75), `alert` (60), `popover` (40), `badge` (39),
`kbd` (28), `progress` (26), `collapsible` (19), `spinner` (16). There is no `components.json`
registry to justify keeping them.

Seven dependencies fall out with them. `recharts` is imported only by the unused `chart.tsx`;
`@radix-ui/react-collapsible`, `-popover`, `-progress` and `-select` only by their unused
primitives. `framer-motion` and `tailwindcss-animate` are already imported nowhere -
`grep -rn framer-motion ui --include=*.tsx` matches `ui/package.json:51` alone. Keep
`@radix-ui/react-{dialog,separator,slot,tooltip}` - `slot` is used by `button.tsx`.

**PR 10 - nine `localDateKey` copies and six Monday formulas.**

```
$ grep -rn "function localDateKey\|function toLocalDateStr\|function dateKey" --include='*.ts' ui
ui/client/src/components/sport-analytics/calisthenicsLensModel.ts:72
ui/client/src/components/sport-analytics/badmintonLensModel.ts:644
ui/client/src/components/sport-analytics/runningLensModel.ts:43
ui/client/src/components/home-warm/warmHomeSnapshots.ts:42        (exported)
ui/client/src/components/home-warm/warmHomeModel.ts:113
ui/client/src/components/home-warm/liveWeekContract.ts:20
ui/client/src/components/monthly-analytics/monthlyAnalyticsModel.ts:207
ui/client/src/lib/challenge.ts:133                                (exported)
ui/api/auth/_lib/generate-widget-snapshots-from-dashboard-snapshot.ts:121
```

`weekStartKey` + `shiftWeekKey` + `calculateWeeklyStreaks` are byte-identical in the three lens
models (`runningLensModel.ts:50-62`, `badmintonLensModel.ts:664-676`,
`calisthenicsLensModel.ts:79-91`). Separate Monday formulas live at `lib/activities.ts:371-377`
(re-inlined at `:444-449` and `:453-462`), `liveWeekContract.ts:12-18`, `warmHomeModel.ts:105-111`
and again inline at `:282-284` using `(getDay()+6)%7`, `warmHomeSnapshots.ts:300`, and server-side
`firstWeekCompile.ts:35`. iOS repeats it: `EnginePageMath.swift:103` and `TrainWeekStrip.swift:330`
both map a date to `"MON"` by different mechanisms.

## M5 Retired names - PR 11-13

**PR 11 - iOS dead code.**

- `ios/CoachHQ/CoachHQ/Views/EnginePageView.swift` is 541 lines defining `EngineDetailView`.
	`grep -rn "EngineDetailView" ios --include=*.swift` outside the file returns nothing; only
	`EnginePageMath` is referenced, and only by `CoachHQTests/EnginePageMathTests.swift`. Keep the
	math, delete the view.
- `ios/CoachHQ/CoachHQ/Services/BundledTemplates.swift` (40 lines) - `grep -rn "BundledTemplates\."`
	returns nothing. Its ids (`workout_a`-`workout_d`, `foundation`) do not even match
	`platform/skeleton-templates/` (`calisthenics_a`, `strength_a`, `recovery`, `foundation`).
- `InstrumentHeaderView.swift:29` is referenced only by its own `#Preview` at `:99`.

**PR 12.** `liveWeekContract.ts:77` declares `_legacyChallenge?: any` as positional param 2;
`grep -rn _legacyChallenge ui` returns the definition only. `coachDay.ts:80-82` documents itself as
dead - "Not currently called from the turn-building pipeline" - and `coachDayNumber` has zero
production callers, only `coach-since.test.ts`. One concept carries three names:
`coachChatModel.ts:236` `challengeDayNumber` (called from `CoachChat.tsx:96`),
`coachDay.ts:83` `coachDayNumber`, `CoachChatView.swift:68` `challengeDayNumber`; ADR 0018 names it
coach-day. `coachChatModel.ts:431` shows the athlete "Gemini free-tier quota exceeded" on a path
that is no longer Gemini; same naming at `coach-chat-context.ts:2`,
`prefetchCoachContext.ts:8`, `coachChatModel.ts:441,533`, `currentWeekAdapter.ts:189`.

**PR 13.** `ui/api/auth/_lib/repo-resolution.ts:58` keeps
`LEGACY_MARKER_PATH = "user_data/ledger/challenge_v2.json"` with no stated removal condition -
legitimate back-compat, undocumented. `ui/api/_lib/fileEdits.ts:5` describes a contract for
`state.md` and `coach_notes.md`, both retired (`coach-data-schema.md:7`), while
`coachContext.ts:5` says "state.md is gone". `engine/core/query_history.py:350-354` writes
`data["coach_notes"]` and nothing in `ui/api` or the schema doc reads it - SUSPECTED dead, confirm
against an athlete repo before deleting.

## M6 Boundary - PR 14, 15

`ui/client/src/lib/challenge.ts:2` defines `SplitLedger` as the canonical type, imported by ~10
files - and `hooks/useRepoData.ts:24,29` types the same value `ledger?: any; profile?: any`, with
`CoachChat.tsx:88` casting back (`data.ledger as any`) and `Home.tsx:40` asserting
`as unknown as SplitLedger` on network data. The canonical type exists and is bypassed at the entry
point. Downstream `any` at `warmHomeSnapshots.ts:251,656,767,826`, `warmHomeModel.ts:443,470`,
`coachChatModel.ts:236`, `lib/challenge.ts:182`, `workoutSchema.ts:83,128`.

Clean: zero `@ts-ignore`/`@ts-nocheck` in production code - the only five hits are deliberate
`@ts-expect-error` inside tests that are themselves the assertion
(`ui/api/_lib/_tests/llmClient.test.ts:52-57`).

**PR 15 - two swallowed errors worth capturing.** Of ~40 bare `catch {}` outside tests, most are
documented fail-open inside the runbook boundary (`sentry-runbook.md:333` exempts
`parseJsonOrNull`; `coachDay.ts`'s six catches are `Intl` fallbacks). These two are not:

1. `ui/api/coach-chat/_lib/commit/activitySyncTurn.ts:92-97` swallows a network read
	(`getFileRaw`), not a parse. An outage and an absent file are indistinguishable, and the turn
	silently drops the athlete's previous proactive message from context.
2. `ui/api/auth/[...action].ts:185-193` swallows a state-param decode failure and returns `"web"`,
	silently redirecting an iOS user to the web flow. `sentry-runbook.md:267` calls an undecryptable
	state "a fault"; this one is not captured.

Non-null `!` on LLM-returned JSON at `turnReplyValidation.ts:37,47` and `memoryWrite.ts:43-44`,
which `coachTurn-reprompt.test.ts:376` notes "is not runtime-checked here".

## M7 Splits - PR 16-18

`wc -l`, excluding `node_modules` and `_generated`: `HealthKitSyncManager.swift` 1861 (HK queries +
dedupe + commit + stale-sync reporting), `ui/api/auth/[...action].ts` 788 (every auth action +
PKCE + the refresh retry loop at `:507-543`), `coachTurn-reprompt.test.ts` 2567. The iOS view files
(`ActivityDetailView` 1161, `ActivityLedgerView` 1089, `SettingsView` 1086, `CoachChatView` 988)
each carry their own model math - `CoachChatView.swift:68` holding a duplicate of web's day-number
formula inside a SwiftUI view is the tell. Those follow PR 16's pattern once it lands.

## Checked and found clean

- **No unreferenced exports or modules** in `ui/api`, `ui/client/src`, `ui/scripts`,
	`ui/observability`, `shared`, `platform`, `engine` - a full-token-index pass returned zero
	symbols with no non-defining reference and zero referenced only from their own test. The 18
	shadcn primitives above are the exception, found by import-path grep.
- **Every script is wired** - `check-span-health.mjs` → `span-health.yml:34`, `sentry-digest.mjs` →
	`sentry-digest.yml:58`, `boot-cost.mjs` → `.claude/settings.json:15`, `query-sentry.mjs` →
	`cyclops.md:25`, `gen-codeowners.py` → `CODEOWNERS:1`, `carve-kit.mjs` →
	`test_agent_kit_init.py:10`. The one exception documents itself:
	`ui/eval/prefix-cache-probe.ts:3` "throwaway by design".
- **No dead env vars** - every project-owned `process.env.X` has a reader and a setter.
- **Two TODOs in the source tree.** `ui/client/src/pages/AuthError.tsx:17` cites #164, CLOSED -
	tracked in #1249. `ui/api/_lib/geminiModel.ts:8` is a live revert reminder.
- **Boot-file paths all resolve** - every path cited by `AGENTS.md` and `tech-lead.md` exists.
- **`.claude/worktrees/` (23M) and 16 prunable `/tmp` worktrees** are gitignored local litter, not
	repo state. Prune locally, no PR.
