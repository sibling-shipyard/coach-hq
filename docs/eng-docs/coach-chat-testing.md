# Coach chat — testing

> Status: Current · Owner: Tech Lead · Verified: 2026-09-14

## Context

Coach-chat testing splits into three kinds today, answering three different questions:

1. **The layered suite** (`npm test`, free, no network) - "given a specific Gemini/GitHub
   response, does our code do the right thing with it?"
2. **`eval:coach-chat`** (paid, live Gemini, no real repo writes) - "does the real Gemini API
   still produce structured output shaped like our fixtures assume?"
3. **`test:coach-chat-manual`** (paid, live Gemini, real repo writes) - "does the whole real
   pipeline - prompt, SOUL, athlete data, Gemini, GitHub commit - still work end to end?"

None of the three replaces another - see "Two different questions" below for why a green `npm
test` run never means "Gemini is up" or "GitHub commits are working right now."

The layered suite exists because the pipeline itself has three layers: input -> decision, decision
-> file content, file content -> git commit. A test suite shaped the same way tells you which
layer broke. That beats just hearing "something in coach-chat is wrong." No formal
`LlmClient`/`RepoBackend` interface exists yet for a future Supabase/other-LLM swap - `askGemini`'s
`(apiKey, ..., mode, ...) => Promise<GeminiReply>` signature and `commitFilesAtomic`'s
`(FileEntry[], message, ctx) => Promise<{ commitSha }>` signature are the documented seam. Add a
real interface only once a second implementation of either actually exists.

## Whether SOUL is actually sent, per test type

A question worth answering explicitly, since it's easy to assume every test exercises the real
coaching prompt and it doesn't:

| Test type                                        | SOUL value                                      | Why                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Layered suite (`layer1-gemini/`, `integration/`) | `"soul"` / `"soul text"` - a placeholder string | These tests prove pipeline mechanics (schema handling, reprompt logic, commit payloads), not coaching quality. Real SOUL content would be dead weight in every fixture and a maintenance burden every time SOUL's prose changes.                                                                                         |
| `layer2-fields/`, `layer3-commit`                | N/A - no prompt built at all                    | These layers test pure appliers and commit logic; neither touches SOUL or prompt construction.                                                                                                                                                                                                                           |
| `eval:coach-chat`                                | `""` - genuinely empty, not even a placeholder  | Deliberate (`eval-coach-chat.ts`'s own header comment). ADR 0024: a paid check runs only where it can actually catch something in the diff. This eval exercises `askGemini`'s own logic (schema compliance, retries, JSON parsing) against a live model - a SOUL wording change can't fail here, so SOUL isn't paid for. |
| `test:coach-chat-manual`                         | The real, current composed SOUL                 | This tool calls the real production `handle()` (`ui/api/coach-chat.ts`) unmodified, which calls `loadCoachContext()`, which sets `soul: SOUL` straight from `ui/api/_generated/soul.ts` - the same build artifact a real athlete's request gets. Nothing is stubbed.                                                     |

**SOUL's own correctness is checked by neither.** Two separate, non-LLM structural linters do
that instead, both part of the 9-check local gate. `compose-soul --check` catches drift between
the `platform/soul/*.md` source layers and the composed build artifacts. `validate-soul` lints
the composed text against ground truth instead - every path SOUL mentions exists in a real carved
skeleton, every write SOUL claims is actually writable, cross-references resolve. Both use a real
dry-run carve as the check, not a hand-maintained list, and neither makes a model call.

## Type 1: The layered test suite (`npm test`, no network)

**Purpose:** prove the pipeline's own logic is correct against known-real inputs, deterministically,
on every commit. Never asks whether Gemini or GitHub actually behave a certain way - only whether
our code handles a given input correctly.

**Mechanics.** `layer1-gemini/`, `layer2-fields/`, and `integration/` live under
`ui/api/coach-chat/_tests/`, see that directory's own `README.md` for the map. `layer3-commit`'s
real test file is `ui/api/_lib/_tests/githubGitData.test.ts`, outside `coach-chat/` entirely -
`commitFilesAtomic` is shared beyond coach-chat (also used by `coach-message.ts`/`waitlist.ts`), so
its test stays with its source rather than moving under a `coach-chat/_tests/layer3-commit/`
directory.

- **`layer1-gemini/`** - the Gemini call end to end through `geminiClient.ts::askGemini` (prompt
  building) into `_lib/llmAdapters/geminiAdapter.ts` (the actual HTTP call, explicit cache, retry -
  moved there by #713 M2 PR 2). Mocks `fetch` only.
- **`layer2-fields/`** - decision -> file content, the pure appliers (`coachIntents.ts`,
  `coachWeekFiles.ts`, `coachWorkoutFiles.ts`, `turnWrites/*.ts`). No network at all.
- **`layer3-commit`** - file content -> git commit (`githubGitData.ts::commitFilesAtomic`). Mocks
  `fetch` only.
- **`integration/`** - `fullTurnPipeline.test.ts` wires all three together, `fetch` mocked only at
  the Gemini/GitHub boundary; `coachTurn.test.ts` / `coachTurn-reprompt.test.ts` /
  `activitySyncTurn.test.ts` mock `commitFilesAtomic`/`askGemini` directly to check `coachTurn.ts`'s
  own stage logic in isolation.

**Only the network edge is ever faked.** `fetch`/`fetchWithTimeout` is the sole mock in every one
of these files - JSON parsing, schema handling, turnWrites, and commit-payload construction are
real, unmodified code running against canned input. A failing test means our code mishandled that
input, not a guess about what Gemini or GitHub would do. Canned inputs are built from real observed
shapes where practical (eval transcripts, real logged manual runs, issue #609's actual malformed
reply) rather than invented ones.

**Logged runs:** `npm run test:logged` runs the same suite and additionally writes a dated JSON
report to `test-results/raw/<YYYY-MM-DD>/unit/vitest-results-<HH-MM-SS>.json` (`ui/scripts/run-tests-logged.ts`),
matching the `eval/` and `manual/` folders below. Use this - not a bare `npm test` - whenever a run
needs to leave a record someone can point at later.

**Known gaps:** none tracked at this layer specifically - it's the free, always-on gate, and gaps
here surface as ordinary test failures, not silent holes. The gaps worth naming live in the two
paid tools below, where cost gates what actually gets run.

## Type 2: `eval:coach-chat` (paid, live Gemini, no real writes)

**Purpose:** confirm Gemini's structured output still complies with our schema and rubric under
real model behavior - valid schema, no fabricated "saved" language, `coach_note` present when
expected. Explicitly does not judge coaching voice/persona quality (see the SOUL table above) -
that would need a second, more expensive judge-model call per transcript, deferred per
`docs/eng-docs/llm-provider-current.md`'s Eval section.

**Mechanics** (`ui/scripts/eval-coach-chat.ts`) - runs golden transcripts
(`ui/api/coach-chat/_tests/coach-chat-eval/transcripts/`) against a live Gemini call. No real repo
writes happen; it calls `askGemini()` directly, not the full commit pipeline - so it never
exercises `coachTurn.ts`'s own reprompt (missing coach_note / oversized field), only the raw,
single-shot model output. A transcript is either one message (`mode`/`userMessage`/`expect`) or a
real multi-turn conversation (`turns: [...]`). Paid per call (ADR 0024), so it's manual/CI-gated,
never on every PR - `.github/workflows/eval-coach-chat.yml` only runs it on `workflow_dispatch` or
a `push` to `main` matching prompt/schema/model/harness paths.

**Cost discipline, already built in:** every call costs money and Gemini 503s non-deterministically,
so a red run is usually infrastructure rather than the change under test. Transient failures retry
with backoff. A transcript that already PASSED is not paid for twice either - its result is
cached against a key covering the transcript, the model, and the prompt-construction code, so any
change to those re-runs it, nothing else does.

**The set:** 23 transcripts as of the K1 testing pass (2026-09-04). G1 (#670) trimmed the original
29 down to 14. C2 added 2 more (`coach_note` day-keying, `#33`/`#34`). K1 added 8 more, closing
live-coverage gaps found during that pass (`#35`-`#42`). Those cover `memory_update`,
`sports_update`, returning `coaching_style_update`, a dynamic-enum/hallucination guard, and one
each for the kickoff and reconcile cases (`#41`/`#42`, originally targeting the then-live
`week_plan`/`session_reconcile` actions). ADR 0042 later collapsed those, plus `plan_edit`, into one
`week_update` action - `#41`/`#42`'s `expect` blocks were updated to match
(`actionFieldsPresent: ["week_update"]`) in the #999 hardening round, 2026-09-13. Closing-turn
behavior is gone (C1 removed the concept: no `mode: "closing"`, no `session_closed` field). Every
transcript was diagnosed against a live run before being kept, not just rewritten and assumed
correct. A stale expectation got fixed; a real gap got its own issue and stays red on purpose -
grep `KNOWN FAILURE` / `KNOWN FLAKY FAILURE` in the transcripts directory for the current list
(none currently). #807 and #808 (both filed during G1's own pass) are resolved as of K1.

`#27`'s `injury_flag` drop on a dense multi-fact FSP turn has a real fix now too, in two stages.
It was reframed and partly fixed on 2026-09-09: the actual shape was a hallucinated
`template_edit.template_id` crash, not a plain drop - `validateTemplateEdit`/`validateSessionPlan`/
`validateSessionReconcile`/`validatePlanEdit` added to `validateActions.ts`. It then resurfaced
the next day as a genuine 5/8 fail rate on a larger live sample
(`GEMINI-PRO-BASELINE-2026-09-10.md`'s FSP flagship scenario). PR #953 closed that with
`findMissedInjuryLanguage`, a deterministic keyword safety net scoped to first-session turns with
zero existing injury flags, verified 3/3 on a fresh live sample. The dynamic-enum/hallucination
guard once deferred pending D1 is in now too (`#40`), D1 having landed.

**Known gaps:**

- The workouts/`current_week` redesign this section once anticipated (#727) has since shipped -
  `session_plan` and the new `workout_create`/`workout_remove` actions still have no dedicated
  live-transcript coverage here, a real gap rather than a deferred one. `workout_create` has a
  narration-vs-action reprompt guard (`gemini-flow.md`'s coverage table); `workout_remove` has none
  yet - see that doc's own tracked follow-up.
- Because this tool calls `askGemini()` directly, it structurally cannot exercise `coachTurn.ts`'s
  reprompt mechanism - a false PASS here says nothing about whether the reprompt/guard layer
  (see `gemini-flow.md`'s "Narration-vs-action reliability guards" coverage table) is working.
  Only `test:coach-chat-manual` and the layered `coachTurn-reprompt.test.ts` suite can.
- No persona/voice judging, by design (see Purpose above) - a SOUL-wording regression that changes
  _tone_ without breaking structure passes here silently. `docs/ref-docs/soul-calibration.md` is
  the closest thing to a fixture for that, and it isn't wired into any automated run.

## Type 3: `test:coach-chat-manual` (paid, live Gemini, real writes)

**Purpose:** the only tool that proves the _whole_ real pipeline end to end - real SOUL, real
athlete repo data, real Gemini call, real GitHub commit - the way an actual athlete's request
does. Everything upstream of this (layers 1-3, `eval:coach-chat`) tests a slice with something
faked; this is the slice with nothing faked.

**Mechanics** (`ui/scripts/run-manual-coach-chat-test.ts`) - drives a real conversation through the
real `handle()` in `coach-chat.ts` against a real athlete repo (`coach-skanda`/`coach-akash`), using
`gh auth token`. Real Gemini calls, real GitHub commits. `--branch` is optional - omit it and the
script names and creates its own scratch branch off the repo's real default branch; it refuses
outright to run against the real default branch or `main`. Use `--greet` / `--message "..."` for
one turn, or `--turns <file.json>` for a scripted conversation - see `ui/scripts/examples/` for
ready-to-run ones, including `manual-coach-chat-turns-fsp.json` (a full First Session) and
`manual-coach-chat-turns-daily.json`/`-daily-2.json` (ordinary daily check-ins).

Both `eval` and `manual` log to `test-results/raw/<YYYY-MM-DD>/<eval|manual>/`, committed to git (not
gitignored) - a permanent, dated record of every run: what was sent, the raw reply, PASS/FAIL/ERROR,
and which files changed. That last field carries a `confidence` tag:

- `"derived"` (eval only) - a guess, based on which action field fired. No real write happened.
- `"observed"` (manual only) - a real `git diff` across the turn's before/after commit sha. Ground
  truth, not a guess.

Never treat a `derived` entry as evidence of a real bug - only `observed` entries are.

**Known gaps:** none tracked here - `ui/scripts/cleanup-scratch-branches.ts` now sweeps scratch
branches (see the Cleanup section below), closing the gap this used to name.

**The fourth test type - the simulation suite** (`ui/scripts/run-simulation-suite.ts`, paid, live
model, real writes) closes what used to be this section's gap: the FSP/daily example turn-scripts
above are no longer just run by hand. `run-simulation-suite.ts` drives a small tracked library of
those scenarios (`fsp-basic`, `daily-basic`, `daily-sleep-skip`) one at a time through
`test:coach-chat-manual`'s real pipeline - a child-process invocation, same real
SOUL/repo/Gemini/commit path above. It then scores each against its own `expect` block: which
`turnIndex`es must land, which changed files each one must or must not include. That's matched
against the real `filesChanged.files` (`confidence: "observed"`) the manual run's own log entry
already wrote. `npm run test:simulation-suite -- --list` prints the library. `--only <substring>`
runs a subset. `--dry-run` prints the plan without spending anything. `--branch <name>` overrides
which scratch branch every selected scenario runs against - needed for `fsp-basic`, which needs a
freshly reset branch (see the reset procedure below). Each run writes one `manual:<scenario-id>`
entry to `test-results/coverage-index.json` (`last_pass_sha`, `last_run_date`, `watched_paths`,
`status`, `last_cost_usd`), the same selective-re-run index the layered/eval kinds use.

Before actually running a case, the driver checks that index. A case with `status: "pass"` and an
empty `git diff --quiet <last_pass_sha> HEAD -- <watched_paths...>` is skipped - logged, not
silent - rather than re-run for free. A case with no entry, or `status: "fail"`, always runs.
`--force` bypasses this check entirely, for a full pre-release run.

## Testing against a local athlete repo - the practical workflow

This is the discipline the OpenRouter K1 retest (2026-09-09) used across 6 real athlete repos and
~150 live turns - the workflow below is what actually worked, not a guess. Use it whenever a
change needs to be checked against a real conversation and real commits, not just the layered
suite or a fixture transcript.

**API keys and where they live.** `ui/.env.local` holds `GEMINI_API_KEY` and (if testing
OpenRouter) `OPENROUTER_API_KEY`, loaded automatically via `process.loadEnvFile` in
`run-manual-coach-chat-test.ts` - no manual `export` needed. Before spending a real call, sanity
check the key actually has credit. A depleted key fails identically whether direct or via
`soulCache`'s caching path: `429 RESOURCE_EXHAUSTED - "Your prepayment credits are depleted"`.

```bash
source ui/.env.local
curl -s -o /dev/null -w "%{http_code}" \
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent?key=$GEMINI_API_KEY" \
  -H "Content-Type: application/json" -d '{"contents":[{"parts":[{"text":"ping"}]}]}'
```

`200` means it's live. Anything else, check billing at ai.studio before running anything real
against it.

**Testing a change that lives on an unmerged PR branch - use a worktree of that branch, not HQ's
own `main` checkout.** HQ's `main` lags every open PR stack. Concretely: `coachTurn.ts` on `main`
may still call `askGemini`/direct-Gemini unconditionally, bypassing `selectLlmAdapter` entirely.
Setting `LLM_PROVIDER=openrouter` against `main` can then silently no-op, or silently ignore the
setting and hit direct Gemini anyway, instead of erroring. That's worse than a crash - it looks
like a clean pass. Always confirm which checkout you're actually running against before trusting a
result. Use a fresh worktree off the PR branch under test, never the primary checkout:

```bash
git fetch origin <pr-branch> -q
git worktree add /tmp/wt-<brief> origin/<pr-branch> -q
cp ui/.env.local /tmp/wt-<brief>/ui/.env.local
cd /tmp/wt-<brief> && node platform/scripts/compose-soul.mjs && node ui/scripts/build-soul.mjs
ln -s <primary-checkout>/ui/node_modules /tmp/wt-<brief>/ui/node_modules
```

The `node_modules` symlink is fine for _running_ the harness read-only against a real repo. If
this worktree will also `git push`, the pre-push gate needs real installed deps first - see
AGENTS.md's stale-`node_modules` note; `rm -rf node_modules && npm ci` fixes it. Remove the
worktree when done (`git worktree remove /tmp/wt-<brief> --force`).

**Picking a repo.** Any athlete repo already cloned locally works - check
`/home/skanda_suresh/Projects/coach-<name>` for what exists. `--athlete skanda`/`--athlete akash`
are pre-registered shortcuts in `run-manual-coach-chat-test.ts`'s `ATHLETE_REPOS` map; anything
else needs `--repo <owner>/<name> --local-path <clone path>` spelled out. `coach-skanda-testing`
(`skanda-testing/coach-skanda-testing`) is the **one** repo explicitly authorized to reset/wipe
freely - every other real athlete repo has real personal data and should only ever get new scratch
branches, never a reset or a touch to `main`.

**Recreating a normal conversation.** Pick real content from the athlete's actual files first, so
the message you send references something real, not an invented id. Check
`user_data/ledger/quests.json` for a real `quest_id`, `user_data/coach/injuries.json` for a real
`flag_id`, `user_data/activities/workout_plans/templates/_manifest.json` for a real `template_id`,
`user_data/ledger/current_week.json` for a real `session_id`.
Multi-turn conversations (an incremental disclosure, a season change, anything needing real
thread continuity) need `--turns turns.json`, not repeated `--message` calls - see the `--message`
warning above, it's easy to lose an afternoon to this exact mistake.

**Choosing a provider.** Unset/`gemini` is production's real default (`gemini-pro-latest`, set in
`ui/api/_lib/geminiModel.ts`). Prefix the command with `LLM_PROVIDER=openrouter` to test through
OpenRouter instead - useful when direct Gemini credits are tight. **As of 2026-09-14,
`GEMINI_API_KEY` has no credit in this dev environment - `LLM_PROVIDER=openrouter` is required for
any live run here, not just an option; see `docs/eng-docs/llm-provider-current.md`'s status line.**
OpenRouter and direct Gemini have
measured, different reliability characteristics (see `OPENROUTER-K1-RETEST-FINDINGS.md` if it's
still in the repo, or whatever findings doc it got folded into) - a clean OpenRouter run doesn't
prove the same thing a clean direct-Gemini run does.

**Seeing what actually got sent.** Add `--debug` (or set `DEBUG=1`) to dump the full assembled
prompt - `cachePrefix` + `system` + `messages`, the exact object `askGemini` sends - not just the
parsed JSON reply, which already prints unconditionally. Use this before guessing at a prompt-text
fix; reading the real prompt is faster than re-deriving it from the source.

**Verifying a result - never trust PASS/FAIL alone.** The harness's own PASS/FAIL is a heuristic
based on which files changed, not a check against what should have changed. After a turn:

1. Read the run log at `test-results/raw/<date>/manual/manual-coach-chat-<repo-slug>-log-<time>.json` for the
   raw reply JSON and which fields actually fired.
2. Independently confirm against the real repo: `git -C <local-clone> fetch origin <branch>` then
   `git -C <local-clone> diff <before-sha>..<after-sha>` (the harness prints both shas), or read
   the committed content directly via `gh api repos/<owner>/<repo>/contents/<path>?ref=<branch>`.
   A field firing in the reply JSON is not the same as the file actually changing - cross-check
   both before calling a scenario a pass.

**Resetting an athlete repo to a genuinely fresh/blank state** (for First Session Protocol /
onboarding testing) - only ever do this on `coach-skanda-testing`. `platform/scripts/carve-skeleton.mjs`
has the exact blank shape for each FSP-owned file (`PROFILE_TEMPLATE`, `MEMORY_TEMPLATE`,
`INJURIES_TEMPLATE`, `SEASONS_TEMPLATE`, `QUESTS_TEMPLATE`). Two ways to get a fresh scratch branch
onto that state:

- Local git: create the branch, overwrite the 5 files with the blank templates, commit, push.
- **Or, if a local `git push` to the athlete repo gets denied by a permission gate:** use the
  GitHub API directly instead. This is not a workaround. The harness's own branch creation already
  works this same way under the hood - this is just the reset step done by hand:
  ```bash
  REPO="skanda-testing/coach-skanda-testing"
  MAIN_SHA=$(gh api repos/$REPO/git/ref/heads/main -q .object.sha)
  gh api repos/$REPO/git/refs -f ref="refs/heads/<branch>" -f sha="$MAIN_SHA"
  # for each of the 5 FSP-owned files:
  SHA=$(gh api "repos/$REPO/contents/<path>?ref=<branch>" -q .sha)
  gh api -X PUT "repos/$REPO/contents/<path>" -f message="reset: blank <path>" \
    -f content="$(echo -n '<blank JSON>' | base64 -w0)" -f sha="$SHA" -f branch="<branch>"
  ```
  Every write needs the file's current `sha` on that branch (fetch it first) - omitting it 422s.

**Cleanup.** Scratch branches on athlete repos are local-only (never a PR, never touching `main`)
but they do accumulate - dozens of `test/`/`retest/` branches across the repos used in a single
investigation is normal. Not urgent to delete mid-investigation (evidence for a finding may live
only on one), but worth a periodic sweep once a testing pass is fully wrapped up.

`ui/scripts/cleanup-scratch-branches.ts` sweeps them - lists every remote branch matching
`^(test|retest)/` on a given repo, with its real age (a real `gh api` commit-date lookup, not a
guess). List-only by default; `--delete` actually removes what's listed. `--older-than <days>`
narrows to branches past that age. It refuses to touch the repo's default branch or anything
literally named `main`, same hard-coded discipline `run-manual-coach-chat-test.ts` already has for
creating one, with no override flag for that specific check.

```bash
npm run cleanup-scratch-branches -- --athlete skanda            # list only
npm run cleanup-scratch-branches -- --athlete akash --older-than 14
npm run cleanup-scratch-branches -- --athlete akash --older-than 14 --delete
```

## Two different questions, answered by different tools

1. "Given a specific Gemini/GitHub response, does our code do the right thing with it?" - the
   layered suite answers this, deterministically, no network, on every commit.
2. "Does the real Gemini API actually still produce responses shaped like our fixtures? Does the
   real GitHub auth/branch flow actually still work end to end?" - only `eval:coach-chat` and
   `test:coach-chat-manual` can answer this; a mock never can.

A green `npm test` means "our logic is sound against known-real inputs." It does not mean "Gemini
is up" or "GitHub commits are working right now" - that's what the live tools verify. Neither is
sufficient alone; both stay in the loop.

## The day-doc: primary artifact, raw JSON as backing evidence

`test-results/<YYYY-MM-DD>.md` is the primary, readable record of what ran on a given day - one
file per day, every run that day appending a new section to it. The dated JSON under
`test-results/raw/<date>/<eval|manual|unit>/` still gets written exactly as before; it's now backing
evidence for the day-doc's claims (the real prompt/reply/diff behind a PASS/FAIL line) rather than
the thing a person reads directly. Format: `kdb/test-doc-style.md`.

## What still needs a human

Vitest and the manual harness never render a screen. Anything about actual UX - does the chat feel
right, does the iOS app render correctly, real latency as experienced live - needs a person on
web/iOS. If that ever produces something worth keeping (a recording, a written note), it goes in
`test-results/raw/<date>/manual-ui/`, same dated convention as the rest of this tree.

## Done when

A `npm test` / `npm run test:logged` run ends with every file green. An eval/manual run's console
output ends with `N/M passed`; check today's `test-results/<today>.md` for the readable summary, or
open the newest file under `test-results/raw/<today>/` to see the real input/output/diff behind that
number.
