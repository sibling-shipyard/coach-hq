# Coach chat — testing

> Status: Current · Owner: Tech Lead · Verified: 2026-09-18

Three suites, three different questions. None replaces another — a green `npm test` means
"our logic is sound against known-real inputs", never "Gemini is up" or "GitHub commits work
right now". The live tools answer that.

| Suite | Command | Cost | Network | Real writes | Answers |
|---|---|---|---|---|---|
| Layered suite | `npm test` | free | none | no | "Given a specific Gemini/GitHub response, does our code do the right thing?" |
| Eval | `npm run eval:coach-chat` | paid | live Gemini | no | "Does the real model still produce structured output shaped like our fixtures?" |
| Manual | `npm run test:coach-chat-manual` | paid | live Gemini + GitHub | yes | "Does the whole real pipeline — prompt, SOUL, athlete data, model, commit — work end to end?" |

The layered suite mirrors the pipeline's own layers: `layer1-llm/` (the Gemini call through
`coachLlmClient.ts::askLlm`), `layer2-fields/` (decision → file content, pure appliers),
`layer3-commit` (`commitFilesAtomic`; its test lives with its source at
`ui/api/_lib/_tests/githubGitData.test.ts`), `integration/` (the full turn with `fetch` mocked
only at the Gemini/GitHub edge). A failing test means our code mishandled a known-real input,
never a guess about what Gemini or GitHub would do.

Only the manual tool uses the real SOUL — it drives the real production `handle()`
(`ui/api/coach-chat.ts`), which loads SOUL straight from `ui/api/_generated/soul.ts`. The
layered suite uses a placeholder and the eval deliberately sends an empty string (its own
header comment in `ui/eval/eval-coach-chat.ts`), so neither can catch a SOUL wording
regression. That gap is named, not closed.

Both paid tools are manual-only by design: the eval workflow runs on `workflow_dispatch`
alone, and the manual tool refuses to run against a repo's real default branch. Eval and
manual runs log to `test-results/raw/<YYYY-MM-DD>/<eval|manual>/`; a simulation suite
(`npm run test:simulation-suite`) drives a tracked scenario library through the same real
pipeline and skips cases whose watched paths haven't changed since their last pass
(`test-results/coverage-index.json`).

The day's readable record is `test-results/<YYYY-MM-DD>.md` (format: `kdb/test-doc-style.md`);
the dated JSON underneath is backing evidence. Harness how-to lives in `ui/eval/README.md`.

## Done when

`npm test` / `npm run test:logged` ends with every file green. An eval/manual run ends with
`N/M passed`; check today's day-doc for the readable summary.
