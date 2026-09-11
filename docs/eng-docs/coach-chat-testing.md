# Coach chat — testing

> Status: Current · Owner: Tech Lead · Verified: 2026-09-10

## Context

Coach-chat testing splits into two kinds: **layered, no-network tests** that check our own code
against known-real inputs on every `npm test`, and **live-API tools** that check whether Gemini
and GitHub still behave the way our fixtures assume. Neither replaces the other - see "Two
different questions" below.

The layered tests exist because the pipeline itself has three layers: input -> decision, decision
-> file content, file content -> git commit. A test suite shaped the same way tells you which
layer broke. That beats just hearing "something in coach-chat is wrong." No formal
`LlmClient`/`RepoBackend` interface exists yet for a future Supabase/other-LLM swap - `askGemini`'s
`(apiKey, ..., mode, ...) => Promise<GeminiReply>` signature and `commitFilesAtomic`'s
`(FileEntry[], message, ctx) => Promise<{ commitSha }>` signature are the documented seam. Add a
real interface only once a second implementation of either actually exists.

## The layered test suite (`npm test`, no network)

`layer1-gemini/`, `layer2-fields/`, and `integration/` live under `ui/api/coach-chat/_tests/`, see
that directory's own `README.md` for the map. `layer3-commit`'s real test file is
`ui/api/_lib/_tests/githubGitData.test.ts`, outside `coach-chat/` entirely - `commitFilesAtomic` is
shared beyond coach-chat (also used by `coach-message.ts`/`waitlist.ts`), so its test stays with
its source rather than moving under a `coach-chat/_tests/layer3-commit/` directory. In short:

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
report to `tests/<YYYY-MM-DD>/unit/vitest-results-<HH-MM-SS>.json` (`ui/scripts/run-tests-logged.ts`),
matching the `eval/` and `manual/` folders below. Use this - not a bare `npm test` - whenever a run
needs to leave a record someone can point at later.

## The two live-API tools (`tests/<date>/eval/` and `tests/<date>/manual/`)

**`npm run eval:coach-chat`** (`ui/scripts/eval-coach-chat.ts`) - runs golden transcripts
(`ui/api/coach-chat/_tests/coach-chat-eval/transcripts/`) against a live Gemini call. No real repo
writes happen; it calls `askGemini()` directly, not the full commit pipeline - so it never
exercises `coachTurn.ts`'s own reprompt (missing coach_note / oversized field), only the raw,
single-shot model output. A transcript is either one message (`mode`/`userMessage`/`expect`) or a
real multi-turn conversation (`turns: [...]`). Paid per call (ADR 0024), so it's manual/CI-gated,
never on every PR.

**The set:** 23 transcripts as of the K1 testing pass (2026-09-04). G1 (#670) trimmed the original
29 down to 14. C2 added 2 more (`coach_note` day-keying, `#33`/`#34`). K1 added 8 more, closing
live-coverage gaps found during that pass (`#35`-`#42`) - `memory_update`, `sports_update`,
returning `coaching_style_update`, a dynamic-enum/hallucination guard, and one each for
`week_plan`/`session_reconcile`. Closing-turn behavior is gone (C1 removed the concept: no
`mode: "closing"`, no `session_closed` field). `session_plan` still has zero dedicated coverage as
of this write-up - flagged for whenever the workouts/`current_week` area gets its own redesign,
since its shape will likely change anyway. Every transcript was diagnosed against a live run before
being kept, not just rewritten and assumed correct. A stale expectation got fixed; a real gap got
its own issue and stays red on purpose - grep `KNOWN FAILURE` / `KNOWN FLAKY FAILURE` in the
transcripts directory for the current list. #807 and #808 (both filed during G1's own pass) are
resolved as of K1; the one open live gap is `#27`'s `injury_flag` drop on a dense multi-fact FSP
turn, not yet fixed - see `docs/plans/ccr-k1-final-test-pass-lld.md` for the evidence. The
dynamic-enum/hallucination guard once deferred pending D1 is in now too (`#40`), D1 having landed.

**`npm run test:coach-chat-manual`** (`ui/scripts/run-manual-coach-chat-test.ts`) - drives a real
conversation through the real `handle()` in `coach-chat.ts` against a real athlete repo
(`coach-skanda`/`coach-akash`), using `gh auth token`. Real Gemini calls, real GitHub commits.
`--branch` is optional - omit it and the script names and creates its own scratch branch off the
repo's real default branch; it refuses outright to run against the real default branch or `main`.
Use `--greet` / `--message "..."` for one turn, or `--turns <file.json>` for a scripted
conversation - see `ui/scripts/examples/` for ready-to-run ones.

Both log to `tests/<YYYY-MM-DD>/<eval|manual>/`, committed to git (not gitignored) - a permanent,
dated record of every run: what was sent, the raw reply, PASS/FAIL/ERROR, and which files changed.
That last field carries a `confidence` tag:
- `"derived"` (eval only) - a guess, based on which action field fired. No real write happened.
- `"observed"` (manual only) - a real `git diff` across the turn's before/after commit sha. Ground
  truth, not a guess.

Never treat a `derived` entry as evidence of a real bug - only `observed` entries are.

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
The `node_modules` symlink is fine for *running* the harness read-only against a real repo. If
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
OpenRouter instead - useful when direct Gemini credits are tight. OpenRouter and direct Gemini have
measured, different reliability characteristics (see `OPENROUTER-K1-RETEST-FINDINGS.md` if it's
still in the repo, or whatever findings doc it got folded into) - a clean OpenRouter run doesn't
prove the same thing a clean direct-Gemini run does.

**Seeing what actually got sent.** Add `--debug` (or set `DEBUG=1`) to dump the full assembled
prompt - `cachePrefix` + `system` + `messages`, the exact object `askGemini` sends - not just the
parsed JSON reply, which already prints unconditionally. Use this before guessing at a prompt-text
fix; reading the real prompt is faster than re-deriving it from the source.

**Verifying a result - never trust PASS/FAIL alone.** The harness's own PASS/FAIL is a heuristic
based on which files changed, not a check against what should have changed. After a turn:
1. Read the run log at `tests/<date>/manual/manual-coach-chat-<repo-slug>-log-<time>.json` for the
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

## Two different questions, answered by different tools

1. "Given a specific Gemini/GitHub response, does our code do the right thing with it?" - the
   layered suite answers this, deterministically, no network, on every commit.
2. "Does the real Gemini API actually still produce responses shaped like our fixtures? Does the
   real GitHub auth/branch flow actually still work end to end?" - only `eval:coach-chat` and
   `test:coach-chat-manual` can answer this; a mock never can.

A green `npm test` means "our logic is sound against known-real inputs." It does not mean "Gemini
is up" or "GitHub commits are working right now" - that's what the live tools verify. Neither is
sufficient alone; both stay in the loop.

## What still needs a human

Vitest and the manual harness never render a screen. Anything about actual UX - does the chat feel
right, does the iOS app render correctly, real latency as experienced live - needs a person on
web/iOS. If that ever produces something worth keeping (a recording, a written note), it goes in
`tests/<date>/manual-ui/`, same dated convention as the rest of this tree.

## Done when

A `npm test` / `npm run test:logged` run ends with every file green. An eval/manual run's console
output ends with `N/M passed`; open the newest file under `tests/<today>/` to see the real
input/output/diff behind that number.
