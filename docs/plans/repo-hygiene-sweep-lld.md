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

`platform/soul/B_engine.md:38` and `:364` tell BYOB Coach to read
`propagated/docs/phelps-voice-profile.md`, `propagated/docs/soul-calibration.md` and
`propagated/docs/badminton-plugin.md`. `platform/scripts/carve-skeleton.mjs:574-578` defines
`PROPAGATED_DOCS` as exactly `current-week-contract.md`, `timer-state-machine.md`,
`pipeline-tools.md`.

Running the existing checker proves it, and proves it has been muted:

```
$ node platform/scripts/validate-soul.mjs
  propagated-docs    3 known    0 new
    [known] [rot] L27: `propagated/docs/phelps-voice-profile.md` is referenced but the carve does not write it
    [known] [rot] L27: `propagated/docs/soul-calibration.md` is referenced but the carve does not write it
    [known] [rot] L345: `propagated/docs/badminton-plugin.md` is referenced but the carve does not write it
  templates          2 known    0 new
    [known] [rot] L269: template `strength_b.json` exists in platform/skeleton-templates/ but is not in the carve's WORKOUT_TEMPLATES
    [known] [rot] L269: template `recovery.json` exists in platform/skeleton-templates/ but is not in the carve's WORKOUT_TEMPLATES
Total: 12 known / 0 new / 0 resolved      EXIT=0
```

All 12 are classified `[rot]` or `[unclassified]`, meaning real. `platform/validate-soul-baseline.json`
was last written 2026-09-11. `platform/scripts/checks.conf:8` marks the check `warn` and
`.github/workflows/validate-soul.yml:69` sets `continue-on-error: true`, with no deadline or
tracking issue.

BYOB is live, so this reaches athletes. ADR 0021 is `Superseded by 0022`, and its own text says
"the half that does not: BYO Claude Code was never retired". ADR 0022 says "both live athletes
moved back to BYOB", and `README.md:19` tells athletes to start with `claude`. Badminton is gated on
`plugins.json`, and `engine/scripts/presets/skanda.json:2` shows club badminton is real.

`platform/tests/test_carve_skeleton.py` has two tests
(`test_carves_daily_rollover_workflow_with_schedule_and_lock`,
`test_carve_stamps_same_dsn_into_sync_and_rollover`) and none asserting that every
`propagated/docs/` path SOUL cites is carved. PR 3 adds that test, which is what turns this
Learning into a check.

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
8. **`.github/agents/tech-lead.md:41` states `ui-tests.yml` covers `ui/**`.** It covers four
	subdirectories. That is the line review check #1 tells agents to trust; corrected in PR 9.

Clean: zero skipped tests (`grep -rn "\.skip(\|xit(\|it\.todo\|\.only("` over the source tree finds
no test-framework hits). ADR 0024 holds - the only paid check, `eval-coach-chat.yml:11-12`, is
`workflow_dispatch` only per ADR 0047.

## M4 Prose - PR 9-11

**PR 9 - dead reference docs.**

- `docs/ref-docs/season-close.md:2-3` claims SOUL points at it.
	`grep -n season-close platform/SOUL.*.md platform/soul/*.md` returns nothing, and
	`platform/soul/B_engine.md:55` says the opposite: "there is no separate phase or season-close
	file to write". `:13-14` still instructs writing alongside the retired `challenge_v2.json`.
	It is not carved either (`carve-skeleton.mjs:574-578`). Delete.
- `docs/ref-docs/milestone-schema.md:10` names `challenge_v2.json` as source of truth; ADR 0045
	says no new code reads it.
- `platform/scripts/carve-skeleton.mjs:172-175` cites `splitLedgerAsChallenge()`
	(`grep -rn splitLedgerAsChallenge ui/client/src` → nothing) and
	`docs/plans/ui-dashboard-rewiring.md` (deleted; `git log -1 -- ` that path shows `d7daaf40`).
	`docs/eng-docs/coach-chat-daily.md:290-291` already says the shim is gone.
- `kdb/decisions/0022-*.md:16` cites `ui/scripts/build-soul.mjs`; the real path is
	`ui/scripts/build/build-soul.mjs`. ADRs are not path-checked - `validate_kdb.py:147` scopes
	`doc_files` to `AGENTS.md` and `.github/agents/`.
- `.github/agents/bob-the-builder.md:44` cites `ui/api/_generated/soul.js`;
	`ui/scripts/build/build-soul.mjs:3` writes `soul.ts`.
- `.github/agents/tech-lead.md:41` (see M3 item 8) and `:121`, which is pure audit trail
	("Previously only `platform/soul/*` … were named") - the rule is the first sentence.

Other dead paths, each verified NOT FOUND: `docs/eng-docs/gemini-flow.md:358` cites
`coachIntents.test.ts` as live coverage; `skeleton-layout.md:14,67-68,171` cite `SETUP.md`,
`sync.yml`, `rollover.yml`, `provision-user.sh`; `activity-naming-migration.md:58-59` cite
`categories.json`, `backfill_category.py`.

**PR 10 - finished plans.** `docs/eng-docs/README.md:11` says `docs/plans/` is deleted when
shipped, with no archive folder.

| Plan | Proof it is done |
|---|---|
| `ops-agent-setup.md` | its own `:45` "All eight PRs (#398-#405) reviewed and merged", `:85` "Nothing in the stack is outstanding"; #395, #328, #414-#417, #424, #737 all CLOSED |
| `coach-chat-live-test-round-2.md` | `:13` says its finishing PR closes #1105; `gh issue view 1105` → CLOSED. Also cites two files that do not exist (`:7`, `:8`) and `run-simulation-suite.ts` (`:32`) |
| `openrouter-m2-chat-lld.md` | `:3` is `Status: Historical`; #824, #917, #920, #921, #956 MERGED |
| `agent-restructure.md` | ADR 0034 is Accepted and records the same split; #585 CLOSED. SUSPECTED - I can prove the ADR landed, not that every task did |
| `backend-decision.md` | 501 lines, `Status: Current`, no issue refs, and its own line 1 says no decision was ever filed from it. Neither plan nor reference; `:493` proposes ADR `0016-*`, a number taken since 2026-07 |

`AGENTS.md:24-25` cites ADR 0021 for "athletes reach Coach through the hosted coach-chat app",
but ADR 0021's own `:3` retracts exactly that half, and `AGENTS.md:11` then routes Coach Phelps at
`platform/SOUL.claude.md`, the BYO build.

**PR 11 - chronology.** `AGENTS.md:112-118` names the tells. The ones where the past no longer
binds the present: `coach-chat-daily.md:290-292` (cites #179, CLOSED 2026-08-02),
`coach-chat-testing.md:104,147,193-194`, `coach-chat-test-scenarios.md:74,79,149`,
`coach-chat-flow.md:6`, `coach-chat-fsp.md:170`, `gemini-flow.md:20,26,37,64,323,474`,
`llm-provider-current.md:98-99,121,139`, `ios-xcode-setup.md:31`, `chat-llm-seam.md:45`.
`coach-commit-mvp.md:118` cites #574 as tracking open work; it is CLOSED.

Budget: `gemini-flow.md` is 543 lines against the `kdb/doc-style.md:3` one-page budget, is
`Status: Current`, and has no `-lld.md` split. `validate_kdb.py` flags only `AGENTS.md` at 221.
The 8 `Status: Historical` docs are all cited from live code or ADRs and stay - chronology is their
job per `docs/eng-docs/README.md:41-44`.

## M5 UI weight - PR 12, 13

**PR 12 - 18 of 27 shadcn primitives are unimported.** Only nine appear in any import:

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

**PR 13 - nine `localDateKey` copies and six Monday formulas.**

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

## M6 Retired names - PR 14-16

**PR 14 - iOS dead code.**

- `ios/CoachHQ/CoachHQ/Views/EnginePageView.swift` is 541 lines defining `EngineDetailView`.
	`grep -rn "EngineDetailView" ios --include=*.swift` outside the file returns nothing; only
	`EnginePageMath` is referenced, and only by `CoachHQTests/EnginePageMathTests.swift`. Keep the
	math, delete the view.
- `ios/CoachHQ/CoachHQ/Services/BundledTemplates.swift` (40 lines) - `grep -rn "BundledTemplates\."`
	returns nothing. Its ids (`workout_a`-`workout_d`, `foundation`) do not even match
	`platform/skeleton-templates/` (`calisthenics_a`, `strength_a`, `recovery`, `foundation`).
- `InstrumentHeaderView.swift:29` is referenced only by its own `#Preview` at `:99`.

**PR 15.** `liveWeekContract.ts:77` declares `_legacyChallenge?: any` as positional param 2;
`grep -rn _legacyChallenge ui` returns the definition only. `coachDay.ts:80-82` documents itself as
dead - "Not currently called from the turn-building pipeline" - and `coachDayNumber` has zero
production callers, only `coach-since.test.ts`. One concept carries three names:
`coachChatModel.ts:236` `challengeDayNumber` (called from `CoachChat.tsx:96`),
`coachDay.ts:83` `coachDayNumber`, `CoachChatView.swift:68` `challengeDayNumber`; ADR 0018 names it
coach-day. `coachChatModel.ts:431` shows the athlete "Gemini free-tier quota exceeded" on a path
that is no longer Gemini; same naming at `coach-chat-context.ts:2`,
`prefetchCoachContext.ts:8`, `coachChatModel.ts:441,533`, `currentWeekAdapter.ts:189`.

**PR 16.** `ui/api/auth/_lib/repo-resolution.ts:58` keeps
`LEGACY_MARKER_PATH = "user_data/ledger/challenge_v2.json"` with no stated removal condition -
legitimate back-compat, undocumented. `ui/api/_lib/fileEdits.ts:5` describes a contract for
`state.md` and `coach_notes.md`, both retired (`coach-data-schema.md:7`), while
`coachContext.ts:5` says "state.md is gone". `engine/core/query_history.py:350-354` writes
`data["coach_notes"]` and nothing in `ui/api` or the schema doc reads it - SUSPECTED dead, confirm
against an athlete repo before deleting.

## M7 Boundary - PR 17, 18

`ui/client/src/lib/challenge.ts:2` defines `SplitLedger` as the canonical type, imported by ~10
files - and `hooks/useRepoData.ts:24,29` types the same value `ledger?: any; profile?: any`, with
`CoachChat.tsx:88` casting back (`data.ledger as any`) and `Home.tsx:40` asserting
`as unknown as SplitLedger` on network data. The canonical type exists and is bypassed at the entry
point. Downstream `any` at `warmHomeSnapshots.ts:251,656,767,826`, `warmHomeModel.ts:443,470`,
`coachChatModel.ts:236`, `lib/challenge.ts:182`, `workoutSchema.ts:83,128`.

Clean: zero `@ts-ignore`/`@ts-nocheck` in production code - the only five hits are deliberate
`@ts-expect-error` inside tests that are themselves the assertion
(`ui/api/_lib/_tests/llmClient.test.ts:52-57`).

**PR 18 - two swallowed errors worth capturing.** Of ~40 bare `catch {}` outside tests, most are
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

## M8 Splits - PR 19-21

`wc -l`, excluding `node_modules` and `_generated`: `HealthKitSyncManager.swift` 1861 (HK queries +
dedupe + commit + stale-sync reporting), `ui/api/auth/[...action].ts` 788 (every auth action +
PKCE + the refresh retry loop at `:507-543`), `coachTurn-reprompt.test.ts` 2567. The iOS view files
(`ActivityDetailView` 1161, `ActivityLedgerView` 1089, `SettingsView` 1086, `CoachChatView` 988)
each carry their own model math - `CoachChatView.swift:68` holding a duplicate of web's day-number
formula inside a SwiftUI view is the tell. Those follow PR 19's pattern once it lands.

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
	fold into PR 11. `ui/api/_lib/geminiModel.ts:8` is a live revert reminder.
- **Boot-file paths all resolve** - every path cited by `AGENTS.md` and `tech-lead.md` exists.
- **`.claude/worktrees/` (23M) and 16 prunable `/tmp` worktrees** are gitignored local litter, not
	repo state. Prune locally, no PR.
