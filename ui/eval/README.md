# ui/eval/ — coach-chat eval and manual live-LLM testing

Everything here calls a real model. Nothing under `ui/api/` (deployed routes) or `ui/scripts/`
(build/CI tooling) does that - `ui/eval/` exists so a paid, live-model call is never mixed in with
either of those. Owned by vade-the-tester (ADR 0044) - mechanics for all four test kinds are in
`docs/eng-docs/coach-chat-testing.md`.

## Contents

| Path                                  | What it is                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| `eval-coach-chat.ts`                   | Golden-transcript eval - real `askGemini()` call per transcript, structural rubric only, no repo writes |
| `run-manual-coach-chat-test.ts`        | Drives a real conversation through the hosted coach-chat handler against a real athlete repo, on a scratch branch |
| `run-manual-coach-message-test.ts`     | Same, against the coach-message (post-sync proactive) handler                    |
| `run-manual-simulation-suite.ts`       | Runs the tracked `SCENARIOS` library through `run-manual-coach-chat-test.ts`'s real pipeline, scored against each scenario's `expect` block |
| `prefix-cache-probe.ts`                | Throwaway probe (#890), not wired into any npm script or CI                      |
| `examples/`                            | Manual coach-chat `--turns` fixtures - both the simulation suite's tracked scenarios and ad hoc example conversations |
| `transcripts/`                         | Golden transcripts `eval-coach-chat.ts` runs                                     |

## Why this is its own folder

`ui/api/` is deployed Vercel routes - a paid, live-model call and a batch of manual-test fixtures
never belonged in there just because one eval script used to read its transcripts from a path
nested under `ui/api/coach-chat/_tests/`. `ui/scripts/` is build-time/CI tooling that runs on
every push - it never calls a live model or writes to a real athlete repo. Everything in this
folder does both, on purpose, only when someone runs it by hand or via `workflow_dispatch`
(ADR 0047). Keeping it separate also lets CI/Vercel build triggers exclude this folder outright
(`docs/plans/ui-ci-vercel-trigger-scoping.md`) without touching either of the other two.

## Running these

All from `ui/`:

```bash
npm run eval:coach-chat
npm run test:coach-chat-manual -- --athlete skanda --greet
npm run test:coach-message-manual -- --athlete skanda --activity-ids "healthkit:UUID1"
npm run test:simulation-suite -- --list
```

Shared helpers (`testLog.ts`, `llmPricing.ts`, `athleteRepos.ts`, `repoDataProfile.ts`,
`preconditions.ts`, `coverageIndex.ts`) live in `ui/scripts/lib/` - they aren't eval-specific,
and `ui/scripts/run-tests-logged.ts` depends on `testLog.ts` too.
