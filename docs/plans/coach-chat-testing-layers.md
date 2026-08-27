# Coach-chat unit test restructure

## Context

Right now coach-chat has two test tools: `npm run eval:coach-chat` (derived, live Gemini,
transcript-scenario based) and `npm run test:coach-chat-manual` (observed, live Gemini + live
GitHub commits, full end-to-end). Both are integration-style — a failure doesn't tell you which
layer broke.

Athlete (Akash) input, echoed by Skanda: split into unit-testable layers matching the real
pipeline shape (input → Coach decides what fields to fill → backend writes fields to files → git
commit to the athlete's repo), plus one integration test that exercises the full chain with only
the network edges mocked. Goal: when something breaks, the failing layer should point straight at
the bug, and swapping GitHub→Supabase or Gemini→another LLM later should mean swapping one layer's
tests, not rewriting the suite.

Investigation found the codebase already has ~24 Vitest files under
`ui/api/coach-chat/_tests/` covering most of layers 2-3 (`coachIntents.ts`, `turnWrites/*.ts`,
`coachReplySchema.ts`) via `vi.mock()` on `commitFilesAtomic`. Two real gaps exist:
`ui/api/coach-chat/_lib/geminiClient.ts` (the actual Gemini HTTP call — prompt building, response
parsing, retry-on-stale-cache) has zero tests, and `ui/api/_lib/githubGitData.ts` (the git
blob→tree→commit→ref chokepoint) has zero tests. There's also no single test that chains all three
layers together with mocks only at the true network boundary (fetch to Gemini, fetch to GitHub) —
today's "integration" coverage is either fully live (manual/eval) or starts mid-pipeline (passes a
prebuilt `GeminiReply` straight into `commitOrdinaryTurn`).

## Layers (confirmed from code, not the plan doc)

1. **Input → decision** (`geminiClient.ts::askGemini`) — prompt in, structured `GeminiReply` out.
   Pure transport + parsing function, no file/git code inside it. **No tests today.**
2. **Decision → file content** (`coachIntents.ts`, `coachWorkoutFiles.ts`, `coachWeekFiles.ts`,
   `turnWrites/*.ts`) — pure appliers, current JSON + action → next JSON. **Mostly covered** by
   existing `*.test.ts` files; will be regrouped, not rewritten.
3. **File content → git commit** (`ui/api/_lib/githubGitData.ts::commitFilesAtomic`) — blob→tree→
   commit→ref-update sequence with retry-on-non-fast-forward. **No tests today.**
4. **Integration** — `coachTurn.ts`'s `commitOrdinaryTurn`/`commitClosingTurn` end to end, with
   `fetch` mocked at the Gemini and GitHub HTTP boundary only (real prompt building, real schema
   parsing, real turnWrites, real commit-payload assembly all execute for real).

## Plan

### 1. Restructure existing tests into the layer framing
- Create `ui/api/coach-chat/_tests/layer1-gemini/`, `layer2-fields/`, `layer3-commit/`,
  `integration/` directories.
- Move existing files by what they actually test: `coachIntents.test.ts`, `coachWeekFiles.test.ts`,
  `coachWorkoutFiles.test.ts`, `coachReplySchema.test.ts`, `turnWrites`-adjacent tests (`weekWrite`,
  `fspWrites`, `onboardingWrites`, `templateEdit`, `textCapsWrites`, `coach-since`, `first-session-injection`)
  → `layer2-fields/`. `close-signal.test.ts`, `day-offsets.test.ts`, `chatThreads.test.ts`,
  `coachChatFiles.test.ts`, `renderCoachContext.test.ts`, `renderQuestContext.test.ts`,
  `workoutLibrary.test.ts`, `sessionPlan.test.ts`, `text-caps.test.ts`, `onboarding-hints.test.ts`
  stay top-level (`_tests/`) as support-module tests, not part of the 3 pipeline layers.
  `coachTurn.test.ts` / `coachTurn-reprompt.test.ts` → `integration/` (they already exercise
  commit+writes together).
- Just `git mv` + fix relative imports (one path-depth level deeper) — no test logic changes in
  this step.
- Add `ui/api/coach-chat/_tests/README.md`: one paragraph per layer, what it covers, what's
  mocked, pointer to `docs/eng-docs/coach-chat-testing.md` for the full picture.

### 2. Layer 1 tests — `layer1-gemini/geminiClient.test.ts`
Mock `fetchWithTimeout` (or `fetch`, matching the existing `_lib` mock style). Cover:
- Happy path: valid JSON response → parsed `GeminiReply` matches schema.
- Malformed/schema-violating response → what `askGemini` does today (throws vs. passes through) —
  document actual behavior, don't invent new handling.
- Retry-on-stale-cache path (already implemented — one retry on a specific condition).
- Timeout → the `status: 504`-tagged error from `httpTimeout.ts` propagates correctly.
- Regression case for issue #609: a reply containing `template_edit: { template_id: "none" }`
  passes schema validation (it's schema-valid, just semantically wrong) — this test documents that
  the sentinel bug is a layer-2 problem (`applyTemplateEdit`), not layer-1, confirming where the
  real fix belongs.

### 3. Layer 3 tests — `layer3-commit/githubGitData.test.ts`
Mock `fetch` against the GitHub REST endpoints `commitFilesAtomic` calls. Cover:
- Happy path: N `FileEntry` writes → correct blob creates → one tree → one commit → ref update,
  right call count and payloads.
- Non-fast-forward ref update → retry-and-succeed path.
- A blob/tree/commit call failing outright → error surfaces, no partial ref update (atomicity).
- Empty entries list edge case, if one is reachable from real callers.

### 4. Integration test — `integration/fullTurnPipeline.test.ts`
One new file. Mock `fetch` only (not `commitFilesAtomic`, not `askGemini` internals) so a real
prompt gets built, a real (canned) Gemini JSON response gets parsed through the real schema, real
turnWrites run, and a real commit payload gets assembled — assert on the final GitHub API call
bodies. 2-3 scenarios: an ordinary turn with one profile_update action, a closing turn with a
chat/coach_log write, and the #609 regression (template_edit "none" reaching the closing turn) to
confirm the fix (once made — see Scope guard below) or document the current crash.

### Scope guard
This plan is test infrastructure only. It does **not** fix issue #609 — that's already filed and
out of scope here. If layer-1/3 tests surface *new* bugs beyond #609, they get flagged the same
way: filed as issues, not fixed inline.

### 5. Rewrite `docs/eng-docs/coach-chat-testing.md` at the end, not append to it
Once the restructure is actually done (not before — the doc should describe what exists, not what's
planned), rewrite this doc from current state: the 3-layer + integration structure, where each
lives, and the documented swap seams (`askGemini`'s `prompt-shaped args → Promise<GeminiReply>`,
`commitFilesAtomic`'s `FileEntry[] → Promise<{commitSha}>`) — no formal `LlmClient`/`RepoBackend` TS
interface yet, add one only when a second real implementation exists. Remove anything the doc
currently says that's no longer true once the restructure lands (old file layout references,
stale "no unit tests exist" framing if present).

### 6. Stacked PRs
Land this as a stack, not one PR: (1) restructure/move existing tests + `_tests/README.md`,
(2) layer-1 `geminiClient.test.ts`, (3) layer-3 `githubGitData.test.ts`, (4) integration test,
(5) doc rewrite (must be last — it describes the finished state). Each PR: `Refs: #<issue>` until
the last, which gets `Fixes:`. Each layer's own README (see below) lands in that layer's PR, not
bundled into the first.

### 7. READMEs at every level
- `ui/api/coach-chat/_tests/README.md` — top-level map: the 4 categories, what's mocked at each,
  where to look for what. Written in step 1, updated if later steps change the shape.
- `ui/api/coach-chat/_tests/layer1-gemini/README.md`, `layer2-fields/README.md`,
  `layer3-commit/README.md`, `integration/README.md` — one file each, what this layer tests, what's
  mocked vs. real, the one or two files to read first. Each written in the PR that creates that
  directory (step 2/3/4), not backfilled later.
- Goal: another developer (or an agent) can read `_tests/README.md` alone and know which layer to
  add a test to for a given bug, without reading this plan or asking Skanda.

## Automation and reporting (how this changes day-to-day testing)

Today: Skanda manually runs `npm run test:coach-chat-manual` and reads raw JSON logs by hand.
Target state after this plan:

- **Layers 1-3 + integration (this plan's scope) run via `npm test` (vitest)** — fully automated,
  no live Gemini/GitHub calls, no manual reading required. Any agent (Claude Code, Codex, etc.) can
  run `npm test` and report pass/fail directly — this is the main lever for "I shouldn't have to sit
  and test things myself."
- **`eval:coach-chat` and `test:coach-chat-manual` stay live-API tools** — still needed because they
  catch things unit tests structurally can't (real Gemini prompt-following quality, real GitHub
  auth/branch mechanics). Not replaced by this plan. Their logs already land in `tests/<date>/` —
  that part's already "automated + logged," just needs consistent committing (separate from this
  plan; flagged as a loose end from the current testing pass).
- **What still needs Skanda on web/iOS:** anything about actual UX — does the chat feel right, does
  the iOS app render correctly, timing/latency as experienced live. Vitest and the manual harness
  can't see a screen. This plan doesn't try to automate that; it narrows what's left needing a human
  to exactly that category.
- **Logging — every one of the 6 test types, same `tests/<YYYY-MM-DD>/<kind>/` convention already
  used for manual runs.** Nothing runs "bare" anymore:
  - `test:logged` (new, built in step 1): `vitest run --reporter=default --reporter=json --outputFile=json:../tests/<date>/unit/vitest-results-<time>.json`.
    Covers layers 1-3 AND the integration test in one run (they're all just vitest files) — one log
    file per run, per-file/per-test pass/fail/duration.
  - `eval:coach-chat` and `test:coach-chat-manual` **already** log to `tests/<date>/eval/` and
    `tests/<date>/manual/` respectively — no change needed there, just confirming the same
    convention now covers all three folders under one `tests/` root: `unit/`, `eval/`, `manual/`.
  - Whichever of the two Skanda runs by hand on web/iOS (layer that can't be automated at all) —
    if there's ever a manual note worth keeping (a screen recording, a written observation), it
    goes in `tests/<date>/manual-ui/` or similar, same dated-folder convention, so ten years from
    now every test run this project ever did lives under one `tests/` tree, dated, greppable.
  - Net effect: an agent asked "run the tests" always ends by pointing at a real dated file path
    under `tests/`, never a bare terminal transcript that's gone once the session closes.

## How the mocked layers stay trustworthy

This is the part that needs to be explicit, since "mocked" can sound like "not really testing
anything":

- **Only the network edge is faked, nothing else.** In layer 1, `fetchWithTimeout`/`fetch` is
  swapped for a stub that returns a canned HTTP response body — everything downstream of that (JSON
  parsing, schema validation via `coachReplySchema.ts`, retry-on-stale-cache logic) is the real,
  unmodified code executing on that fake input. Same in layer 3: `fetch` to GitHub's REST API is
  stubbed, but the real blob→tree→commit→ref sequence, real payload construction, and real
  retry-on-non-fast-forward logic all run. A test failure means *our* code mishandled that input —
  not a guess about what Gemini/GitHub would do.
- **Canned inputs come from real observed data, not invented ones.** The Gemini response fixtures
  for layer 1 and the integration test should be built from the existing eval transcripts
  (`ui/api/coach-chat/_tests/coach-chat-eval/transcripts/*.json`) and real logged responses under
  `tests/<date>/manual/` — actual shapes Gemini has actually produced, including the malformed
  `template_edit: "none"` case from issue #609 — not hand-guessed JSON. This is what makes a passing
  unit test mean something: it's checking our code against inputs we know are real.
  Same for layer 3: fixture GitHub API responses (blob/tree/commit/ref bodies) come from actual
  `githubGitData.ts` call shapes, not invented ones.
- **What unit tests can and can't tell you — two separate questions, two separate tools:**
  1. "Given a specific Gemini/GitHub response, does our code do the right thing with it?" — this is
     what layers 1-3 + integration answer, deterministically, on every commit, no network needed.
  2. "Does the real Gemini API actually still produce responses shaped like our fixtures? Does the
     real GitHub auth/branch flow actually still work end to end?" — this is a *different* question
     that a mock can never answer, and it's exactly what `eval:coach-chat` and
     `test:coach-chat-manual` exist for. They stay in the loop specifically to answer this.
  A green `npm test` run means "our logic is sound against known-real inputs." It does not mean
  "Gemini is up" or "GitHub commits are working right now" — that's what the live tools are for.
  Neither tool alone is sufficient; that's why both stay.
- **Integration test's job specifically:** confirm the three layers are wired together correctly
  (layer 1's output shape is what layer 2 expects, layer 2's `FileEntry` output is what layer 3
  expects) — a real gap unit tests miss when each layer is tested in isolation with fixtures that
  quietly drift from what the layer next door actually produces.

## Verification
- `npm test` (vitest run) from `ui/` — all existing + new tests pass, count of test files matches
  the move (no file dropped in the `git mv`).
- Confirm `npm run test:coach-chat-manual` and `npm run eval:coach-chat` still run unchanged (this
  plan doesn't touch them).
- Spot check: intentionally break `commitFilesAtomic`'s tree-creation call locally and confirm only
  `layer3-commit` tests fail, not layer1/2/integration — proves the isolation actually works.
