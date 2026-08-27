# coach-chat tests — map

Coach-chat's pipeline is: input -> Coach decides what fields to fill -> backend writes fields to
files -> git commit to the athlete's repo. Tests here are split to match that shape, so a failure
points at the layer that broke instead of "something in coach-chat is wrong."

Full design rationale: `docs/plans/coach-chat-testing-layers.md`.

## Layers

- **`layer1-gemini/`** — the Gemini HTTP call (`_lib/geminiClient.ts::askGemini`). Mocks
  `fetch`/`fetchWithTimeout` only; real request building and real JSON/schema parsing run.
- **`layer2-fields/`** — decision -> file content. Pure appliers (`coachIntents.ts`,
  `coachWeekFiles.ts`, `coachWorkoutFiles.ts`, `turnWrites/*.ts`) that take the current JSON plus a
  parsed action and produce the next JSON. No network, no git — these are the most unit-like tests
  in the suite.
- **`layer3-commit/`** — file content -> git commit (`ui/api/_lib/githubGitData.ts::commitFilesAtomic`).
  Mocks `fetch` against the GitHub REST endpoints only; the real blob->tree->commit->ref sequence
  runs.
- **`integration/`** — the full turn pipeline (`coachTurn.ts`'s `commitOrdinaryTurn`/`commitClosingTurn`,
  and `activitySyncTurn.ts`), with `fetch` mocked at the Gemini and GitHub HTTP boundary only. Real
  prompt building, real schema parsing, real turnWrites, real commit-payload assembly all execute.

## Not part of the 3-layer split

Files staying at the top level of `_tests/` test support modules the pipeline depends on, not one
of the three pipeline layers themselves: `chatThreads.test.ts`, `close-signal.test.ts`,
`coachChatFiles.test.ts`, `day-offsets.test.ts`, `onboarding-hints.test.ts`,
`renderCoachContext.test.ts`, `renderQuestContext.test.ts`, `sessionPlan.test.ts`,
`text-caps.test.ts`, `workoutLibrary.test.ts`.

`coach-chat-eval/` is the live-API eval harness (`npm run eval:coach-chat`), unrelated to this
vitest suite — see its own directory for details.

## Everything here is mocked at the network edge only

No layer or integration test invents behavior for our own code. `fetch` is the only thing ever
stubbed; JSON parsing, schema validation, turnWrites, and commit-payload construction are the real,
unmodified code running against canned (ideally real-observed) input. A failing test means our code
mishandled that input, not a guess about what Gemini or GitHub would do.

## Adding a test

Pick the layer that owns the code you're changing. Changing what a Gemini response looks like or
how it's parsed -> `layer1-gemini/`. Changing how a decision becomes file content -> `layer2-fields/`.
Changing the git commit sequence -> `layer3-commit/`. Changing how the layers wire together ->
`integration/`. If unsure, run `npm test` after adding a test in your best-guess layer and see
which other layers stay green — if only your layer's tests fail on a deliberate break, you picked
the right spot.

## Running and logging

`npm test` runs this whole suite (plus everything else under `ui/`) via Vitest — no live API calls
required. `npm run test:logged` (added alongside the layer-1/3 work) additionally writes a dated,
timestamped JSON run report to `tests/<date>/unit/`, matching the logging convention already used
by `eval:coach-chat` (`tests/<date>/eval/`) and `test:coach-chat-manual` (`tests/<date>/manual/`).
