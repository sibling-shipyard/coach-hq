# Coach chat — testing

> Status: Current · Owner: Tech Lead · Verified: 2026-08-27

## Context

Coach-chat testing splits into two kinds: **layered, no-network tests** that check our own code
against known-real inputs on every `npm test`, and **live-API tools** that check whether Gemini
and GitHub still behave the way our fixtures assume. Neither replaces the other - see "Two
different questions" below.

The layered tests exist because the pipeline itself has three layers (input -> decision, decision
-> file content, file content -> git commit), and a test suite shaped the same way tells you which
layer broke instead of just "something in coach-chat is wrong." No formal `LlmClient`/`RepoBackend`
interface exists yet for a future Supabase/other-LLM swap - `askGemini`'s
`(apiKey, ..., mode, ...) => Promise<GeminiReply>` signature and `commitFilesAtomic`'s
`(FileEntry[], message, ctx) => Promise<{ commitSha }>` signature are the documented seam. Add a
real interface only once a second implementation of either actually exists.

## The layered test suite (`npm test`, no network)

Lives under `ui/api/coach-chat/_tests/`, see that directory's own `README.md` for the map. In
short:

- **`layer1-gemini/`** - the Gemini HTTP call (`geminiClient.ts::askGemini`). Mocks `fetch` only.
- **`layer2-fields/`** - decision -> file content, the pure appliers (`coachIntents.ts`,
  `coachWeekFiles.ts`, `coachWorkoutFiles.ts`, `turnWrites/*.ts`). No network at all.
- **`layer3-commit/`** - file content -> git commit (`githubGitData.ts::commitFilesAtomic`). Mocks
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
report to `tests/<YYYY-MM-DD>/unit/vitest-results-<HH-MM-SS>.json` (`ui/scripts/run-tests-logged.mjs`),
matching the `eval/` and `manual/` folders below. Use this - not a bare `npm test` - whenever a run
needs to leave a record someone can point at later.

## The two live-API tools (`tests/<date>/eval/` and `tests/<date>/manual/`)

**`npm run eval:coach-chat`** (`ui/scripts/eval-coach-chat.ts`) - runs golden transcripts
(`ui/api/coach-chat/_tests/coach-chat-eval/transcripts/`) against a live Gemini call. No real repo
writes happen; it calls `askGemini()` directly, not the full commit pipeline. A transcript is
either one message (`mode`/`userMessage`/`expect`) or a real multi-turn conversation
(`turns: [...]`). Paid per call (ADR 0024), so it's manual/CI-gated, never on every PR.

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
