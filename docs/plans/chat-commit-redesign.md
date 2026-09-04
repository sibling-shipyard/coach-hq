# Coach-chat commit redesign

> Status: Current · Owner: Tech Lead · Verified: 2026-09-01

## Context

Live FSP testing on a fresh athlete repo found `quest_create` silently dropping the athlete's
stated goal and habits. Root cause traced past the prompt-wording level (the closed #674 "fix")
into two structural bugs. A placeholder `main_quest` seeded at carve time fools the completion
gate. And `fspIncrementalWrites` discards every ordinary-turn write once a profile is complete —
already tracked as #616. Its blast radius turned out to be much larger than one field. For a
**returning athlete**, Gemini's own response schema returns *zero* action fields on an ordinary
turn — established athletes cannot save a profile change, injury, or quest update outside a
formal close, ever, today. Chasing that surfaced a cluster of related gaps worth fixing together.
Placeholder data sits elsewhere in the carve template too. Chat history deletes past 7 threads.
Validation stops at text-length caps (#736). A coaching-style preference (`accountability` /
`encouragement` / `analysis`) was deliberately removed and is now needed back with real SOUL
wiring. And every schema/carve change here needs propagating to the 5 live athlete repos, not just
future carves — tracked against the existing #703 batched-migration epic (child issue #760).
Along the way, `platform/scripts/validate-soul.mjs`'s known writable-set gap (#735) gets closed too,
since this redesign is already editing the exact SOUL sections that bug lives next to.

## Decision / goal

Every coach-chat turn commits whatever it produces, immediately, for every athlete in every mode —
no data waits on a formal "close." That one change cascades. The closing-turn concept itself
becomes removable (own PR). Chat history can safely retain everything instead of deleting older
threads (own PR). And `coach_note` becomes a day-keyed row, updated in place by whichever turn's
own Gemini call already touches that day — no separate trigger, no separate call, no dependency on
"the athlete pressed End Conversation" at all.
Placeholder data removal, returning-athlete quest/season access, and a full validation audit (not
deferred) are each their own milestone. So are Sentry latency profiling, coaching-style
restoration, propagating all of it to the real athlete repos, trimming the eval-transcript suite
to match, and a final docs/SOUL consistency pass.

```mermaid
flowchart LR
  A1["A1 persist every write\n(#616 + schema fix)"] --> B1["B1 remove placeholder data"]
  A1 --> A2["A2 chat history retention"]
  B1 --> B2["B2 client null-safety"]
  B2 --> B3["B3 seasons/quests for\nreturning athletes"]
  B3 --> C1["C1 remove closing turn"]
  C1 --> C2["C2 coach log redesign\n(day-keyed running note)"]
  A1 --> D1["D1 self-correcting validation\n+ commit-failure UX"]
  D1 --> D2["D2 full validation audit"]
  D2 --> D3["D3 Sentry latency + errors"]
  D1 --> I1["I1 staged progress\nindicator (web + iOS)"]
  E1["E1 coaching style"] --> F1
  B3 --> F1["F1 propagate to skeleton\n+ 5 athlete repos"]
  D2 --> F1
  C1 --> G1["G1 trim eval transcripts"]
  D1 --> G1
  D3 --> G2["G2 redesign layered\ntest suite"]
  C2 --> J1["J1 stale/unused\nfile cleanup"]
  I1 --> J1
  F1 --> J1
  G1 --> J1
  G2 --> J1
  J1 --> J2["J2 restructure ui/api/\n(coach-chat layers)"]
  J2 --> H1["H1 docs + SOUL\nconsistency, closes #735"]
  H1 --> K1["K1 final live test pass\nbefore merge to main"]
```

## Milestones (execution order)

| PR | Milestone | Outcome | Final base | Files (primary) | LLD | Result |
|---|---|---|---|---|---|---|
| A1 | A — Stop losing data | Every turn commits its writes, for every athlete, every mode | `main` | `ui/api/coach-chat/_lib/fspWrites.ts`, `coachTurn.ts`, `coachReplySchema.ts` | [`ccr-a1-persist-writes-lld.md`](ccr-a1-persist-writes-lld.md) | #616 closed, daily-flow writes persist |
| A2 | A — Stop losing data | Chat history never deletes; clients still see only the latest 7 | A1 | `ui/api/coach-chat/_lib/chatThreads.ts`, response-building call sites | [`ccr-a2-history-retention-lld.md`](ccr-a2-history-retention-lld.md) | Full history retained, ADR supersedes #0012 |
| B1 | B — No placeholder data | `main_quest`/`timezone` genuinely absent until real | A1 | `platform/scripts/carve-skeleton.mjs`, `coachQuestFiles.ts`, `coachIntents.ts` | [`ccr-b1-quest-placeholder-lld.md`](ccr-b1-quest-placeholder-lld.md) | Completion gates can't be fooled again |
| B2 | B — No placeholder data | Client renders "no quest yet" instead of crashing | B1 | `ui/client/src/components/home-warm/*` | [`ccr-b2-quest-client-lld.md`](ccr-b2-quest-client-lld.md) | Fresh-athlete dashboard safe |
| B3 | B — No placeholder data | Returning athletes can start a new season with its goal, one atomic action; `main_quest` only ever changes with a season change | B2 | `coachReplySchema.ts`, `coachIntents.ts` | [`ccr-b3-seasons-quests-returning-lld.md`](ccr-b3-seasons-quests-returning-lld.md) | Quest/season parity for every athlete, `main_quest` season-scoped |
| C1 | C — Simplify session model | No more closing turn, no End Conversation button | B3 | `closeSignal.ts` (deleted), `coachTurn.ts`, web + iOS composer | [`ccr-c1-remove-closing-turn-lld.md`](ccr-c1-remove-closing-turn-lld.md) | One turn shape, everywhere |
| C2 | C — Simplify session model | `coach_note` becomes a day-keyed row, updated inline, no separate trigger | C1 | `coachReplySchema.ts`, `coachIntents.ts`, `turnWrites/*.ts` | [`ccr-c2-coach-log-lld.md`](ccr-c2-coach-log-lld.md) | Zero extra Gemini calls, no dependency on a close |
| D1 | D — Reliability | Validation self-corrects; a commit failure never discards Coach's reply; a dropped action is always signaled; a Gemini-call failure gets its own honest message, not a generic one | A1 | `coachReplySchema.ts`, `geminiClient.ts`, `coachIntents.ts`, `coachTurn.ts`, web + iOS error handling | [`ccr-d1-validation-lld.md`](ccr-d1-validation-lld.md) | Closes #736, no silent data loss or vague error on any of the 3 real failure points |
| D2 | D — Reliability | Every `user_data/` field gets a real shape/enum check, not just what D1 touched | D1 | `coachIntents.ts`, `turnWrites/*.ts`, `validate-data.yml`, `coachReplySchema.ts` | [`ccr-d2-validation-audit-lld.md`](ccr-d2-validation-audit-lld.md) | No unvalidated field left, incl. Claude/BYOB writes |
| D3 | D — Reliability | GitHub + backend latency visible in Sentry | D2 | `ui/api/_lib/sentry.ts` | [`ccr-d3-sentry-latency-lld.md`](ccr-d3-sentry-latency-lld.md) | Matches existing Gemini latency instrumentation |
| E1 | E — Coaching style | `coaching_style` back, and it actually changes how Coach talks | none | `coachMemoryFiles.ts`, `platform/soul/*.md`, `carve-skeleton.mjs` | [`ccr-e1-coaching-style-lld.md`](ccr-e1-coaching-style-lld.md) | Independent, can land anytime |
| F1 | F — Propagate everywhere | Skeleton re-stamped first, then diffed structurally against all 5 athlete repos for exact shape parity, then this redesign's own fields backfilled with real values | B3, D2, E1 | 6 separate repo PRs, not HQ code | [`ccr-f1-repo-migration-lld.md`](ccr-f1-repo-migration-lld.md) | Closes #760 (child of #703) |
| G1 | G — Update tests | Eval transcripts trimmed to 10-14, covering current behavior only, gate actually passes | C1, D1 | `ui/api/coach-chat/_tests/coach-chat-eval/transcripts/`, `docs/eng-docs/coach-chat-testing.md` | [`ccr-g1-eval-transcripts-lld.md`](ccr-g1-eval-transcripts-lld.md) | Closes #670 — first-ever green run of this gate |
| G2 | G — Update tests | Layered test suite (`layer1-gemini`/`layer2-fields`/`layer3-commit`/`integration`) redesigned for the final system, no stale assertions | D3 | `ui/api/coach-chat/_tests/{layer1-gemini,layer2-fields,layer3-commit,integration}/` | [`ccr-g2-layered-tests-lld.md`](ccr-g2-layered-tests-lld.md) | Each of the 3 real turn stages properly tested |
| I1 | I — Progress UX | Cycling "thinking/parsing/updating" labels replace the plain dots; failure messages are accurate per real stage | D1 | web + iOS coach-chat composer/loading state | [`ccr-i1-progress-indicator-lld.md`](ccr-i1-progress-indicator-lld.md) | No new infra; true streaming deferred to issue #767 (P3) |
| J1 | J — Repo cleanup | Confirmed-dead files (migration scripts, orphaned exports) removed repo-wide, not just coach-chat | C2, D3, F1, G1, G2, I1 | `ui/scripts/`, `ui/api/`, `ui/client/`, `engine/` | [`ccr-j1-stale-file-cleanup-lld.md`](ccr-j1-stale-file-cleanup-lld.md) | Confirmed real example already found: 3 stale `migrate-coach-memory-part*.mjs` scripts |
| J2 | J — Repo cleanup | Coach-chat's `_lib/` mirrors its own 3-layer test structure; rest of `ui/api/` audited | J1 | `ui/api/coach-chat/_lib/*` (file moves only, no logic change) | [`ccr-j2-api-restructure-lld.md`](ccr-j2-api-restructure-lld.md) | A file's path tells you which of the 3 real stages it belongs to |
| H1 | H — Final consistency | Every doc and SOUL layer reflects the shipped state | J2 | `docs/eng-docs/*`, `platform/soul/A_identity.md`, `SOUL_HISTORY.md` | [`ccr-h1-docs-soul-consistency-lld.md`](ccr-h1-docs-soul-consistency-lld.md) | Closes #735 |
| K1 | K — Final live test pass | One consolidated live-Gemini + live-scratch-repo pass against the fully integrated stack, the actual gate before merge to `main` | H1 | `tests/<date>/eval/` run logs, no code | [`ccr-k1-final-test-pass-lld.md`](ccr-k1-final-test-pass-lld.md) | This plan's own docs deleted once green, folded into eng-docs |

Each PR gets its own LLD, named `ccr-<pr-code>-<topic>-lld.md` — the prefix matches the PR column
above. Filename sort mostly tracks execution order, with two exceptions: **H1 runs after J2**, not
alphabetically first among H/I/J — it needs J1/J2's changes already landed to document them
accurately. **K1 runs last of all**, after H1 — it's this redesign's true finish line (deletes this
plan's own docs once its live pass is green), not H1 anymore now that K1 exists. Follow the table's
row order above, not the alphabet, when in doubt. Read this doc for the shape of the whole redesign;
read the LLD for the PR you're actually building.

## Done when

Every LLD's own "Done when" is met, and `bash platform/scripts/check.sh --quiet` is green on each
PR. A live re-test on a fresh scratch athlete repo confirms three things. FSP goal, habits, and
injuries all land in the same conversation regardless of when profile fields complete. An
established athlete's ordinary "I'm 76kg now" persists without closing. And `quests.json` /
`profile.json` show no skeleton-init placeholder data after carve. K1's own "Done when" (one
consolidated live pass against the fully integrated stack, this plan itself deleted once it's
green) is the redesign's actual finish line.

## Deferred

- C2's documented fallback (reactive day-boundary backfill via `waitUntil`) and real scheduled cron,
  both only if C2's chosen day-keyed design doesn't hold up in practice — see that LLD's own
  Fallback section, not re-derived here.
- True real-time streaming progress (I1's simulated cycling labels replaced with a live backend
  signal) — filed as issue #767, P3.
- `engine/scripts/` pipeline Sentry coverage — checked, deliberately out of scope; matches the
  existing `docs/eng-docs/sentry-runbook.md` boundary, not reopened by D3.
