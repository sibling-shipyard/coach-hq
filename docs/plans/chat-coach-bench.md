# Coach Bench

> Status: Current · Owner: Tech Lead · Verified: 2026-08-30 · Issue: #714

## Context

We cannot say whether a cheaper model is good enough for Coach, because nothing measures the
part that matters. `ui/scripts/eval-coach-chat.ts:27` calls `askGemini` with `soul: ""`, so the
22 transcripts grade schema and action fields while the persona goes untested. Priority is P1:
`chat-openrouter-migration.md` ships first and runs on Gemini as its own baseline.

## Goal

Two layers. The first already exists and only needs to go green.

```
                  +-- Layer A: GATE (exists) ---------------+
  candidate  ---> | 22 transcripts, structural rubric       | --> pass / fail
  model           | schema valid, no fabricated saves,      |     disqualifying
                  | action fields correct                   |
                  +-----------------------------------------+
                                  | survivors only
                                  v
                  +-- Layer B: SCORE (new) -----------------+
                  | real turns replayed, blind pairwise     | --> win-rate
                  | against a reply the athlete liked       |     vs reference
                  +-----------------------------------------+
```

Layer A is binary and disqualifying, which is also how DeepSeek's structured-output risk gets
settled by measurement instead of argument. Layer B is graded.

A case is `(context at turn N, the athlete's real message) -> the reply the athlete liked`.
ADR 0012 commits every close atomically, so the commit at turn N holds the state as it was —
real context is recoverable from git rather than hand-written.

**Rubric:** voice per `platform/soul/A_identity.md` §3 · recall (invented no workout, injury or
number) · action fidelity (`file_updates` match what the turn implies) · judgment (push vs back
off is defensible) · concision. The first four decide; concision breaks ties.

**Judging:** blind pairwise with randomised order, never absolute 1-5 scores. The judge is not
the model that wrote the reference — `llm-provider-current.md:105` already flags that
self-preference trap. Two judges from different families; keep the cases where they agree.

**Output** is one table, and it is the decision:
`| model | gate | win-rate vs reference | $/1k turns | p95 latency |`. Cost and latency come
free — `withGeminiSpan` (`ui/api/_lib/sentry.ts:338`) already records usage per call.

## Milestones

| # | Milestone | Result |
|---|---|---|
| 0 | Gate green (#670) — **not ours**, Skanda owns it | A green baseline run exists on `main` |
| 1 | v0 bench | One scored table row per model, from ~10 hand-picked real turns |
| 2 | SOUL in the eval prompt | The gate exercises the real persona, not `soul: ""` |
| 3 | Git-replay context | Cases build from athlete-repo history, not hand-picked fixtures |
| 4 | Multi-judge agreement | Disagreed cases are dropped rather than averaged |

## PR stack

| PR | milestone | outcome | final base | files | owner | parallel with | result |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Judge call + pairwise scoring in the existing runner | `main` | `ui/scripts/eval-coach-chat.ts`, `ui/scripts/lib/` | UI Expert | PR 2 | |
| 2 | 2 | Real SOUL passed to `askGemini` in the eval | `main` | `ui/scripts/eval-coach-chat.ts` | UI Expert | PR 1 | |
| 3 | 3 | Cases reconstructed from commit history | PR 1 | `ui/scripts/lib/`, `ui/api/coach-chat/_tests/coach-chat-eval/` | UI Expert | — | |
| 4 | 4 | Second judge, agreement filter | PR 3 | `ui/scripts/lib/` | UI Expert | — | |

PRs 1 and 2 both touch `eval-coach-chat.ts` and must rebase into the stack before review.

## Blocked on

Athlete-repo name and the directory BYOB Coach runs from, so the real threads and the
`~/.claude/projects/` session logs can be exported. Nothing above is designed around the
answer; PR 1 cannot start without it.

**Privacy:** these are the athlete's health conversations. Reference sets stay gitignored and
local-only, the same treatment `.eval-cache.json` already gets. Nothing derived from a real
conversation is committed at HQ.

## Done when

1. `npm run eval:coach-chat` reports a win-rate alongside its pass/fail count.
2. Two models can be compared on one table without hand-editing a script.
3. The eval sends the real SOUL, so a persona regression can fail it.

## Deferred

- Scoring the BYO Claude Code build — this measures the hosted chat path only.
- Judging cost per run as a gate. ADR 0024 covers when a paid check runs.
- Retiring `MODEL` in `eval-coach-chat.ts:169`, whose comment claims to mirror `GEMINI_MODEL`
  and no longer does. Cache-key only, so nothing breaks today.
