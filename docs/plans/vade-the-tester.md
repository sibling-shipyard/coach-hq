# New agent role: vade-the-tester

> Status: Draft, not started · Owner: Tech Lead · Created: 2026-09-14

## Context

Testing today is ad hoc: whoever makes a change (Tech Lead, Bob, UI Expert, iOS Builder) also
decides what to test and runs it themselves. Three different tools cover this, described in
`docs/eng-docs/coach-chat-testing.md`: the free layered `npm test` suite, the paid live-API
`eval:coach-chat` tool (ADR 0024, transcript-based), and the paid live `test:coach-chat-manual`
tool. That last one makes real Gemini calls and real commits against a real athlete repo on a
scratch branch. A fourth pattern has no tooling or doc home at all: direct live verification
against a real athlete repo's commits and file diffs, used repeatedly this session for the
#973/#727 migration. It's just something Tech Lead does by hand each time.

The output side has the same problem from the other direction: dated JSON logs under `tests/`
(96 files, 7 date folders, 3 sub-kinds each) are permanent and git-tracked, which is good, but
unreadable without opening each JSON by hand. On top of that, 6 more ad hoc findings docs
(`GEMINI-PRO-BASELINE-2026-09-10.md`, `OPENROUTER-K1-*.md`, etc.) sit loose in the repo root.
They sit outside both the `docs/eng-docs/` and `docs/plans/` filing systems, cross-referencing
each other by filename with no index or lifecycle rule.

Nothing skips a re-run today either. Every paid check either runs at ADR 0024's named gates or
doesn't - there's no per-test-case memory of "this exact case already passed against this exact
code, don't burn another paid call proving it again."

The fix: a dedicated agent, **vade-the-tester**, that owns all of this - running the tests,
authoring new coverage when a change needs it, deciding what actually needs re-running, and
writing one readable report per day. Tech Lead hands off "verify this" the same way it already
hands off Sentry triage to Cyclops, and reviews vade-the-tester's evidence rather than re-running
tests itself - same trust relationship Tech Lead already has with CI.

This mirrors ADR 0034's own precedent for adding Cyclops: a concrete scope gap, a named agent,
an ADR justifying it, and a full wiring pass through `AGENTS.md`, `tech-lead.md`,
`CODEOWNERS`/`gen-codeowners.py`, and the two routing-gate pointer files.

## Decision: scope and ownership

**Owns:** the testing *infrastructure and process* - `ui/api/coach-chat/_tests/coach-chat-eval/`
(eval harness + transcripts), `ui/scripts/eval-coach-chat.ts`, `ui/scripts/run-manual-coach-chat-test.ts`,
`ui/scripts/run-tests-logged.ts`, the renamed results folder (see below), and the new day-doc
reporting system. Runs every kind of test described in `coach-chat-testing.md`, plus the direct
athlete-repo verification pattern (formalized as a fourth kind). Authors new eval transcripts or
manual-test scenarios when a change ships with no existing coverage - "owns all the things needed
for testing" includes writing test scenarios, not just running them.

**Does not own:** colocated unit test files next to feature code (e.g. Bob's own
`layer2-fields/*.test.ts`, UI Expert's `*.test.tsx`). Those stay with whoever owns the feature -
adding a cross-agent handoff to every small unit-test edit would create more friction than the
role is meant to remove. vade-the-tester's unit-suite job is running `npm test`/`test:logged` and
reporting the result, not owning every test file in the repo.

**Trigger:** Tech Lead hands off "verify PR #N" / "run tests for this change" / "full regression
pass," same pattern as a Cyclops triage thread. A worker (Bob/UI Expert/iOS Builder) finishing a
change routes through Tech Lead first, same as today.

**Write access:** real commits/branches on real athlete repos for live verification (same
scratch-branch, never-touch-`main`, never-a-PR discipline `coach-chat-testing.md` already
documents), plus commits to its own owned paths in coach-hq. Never touches application/production
code.

## The redesign

### 1. Rename `tests/` → `test-results/`, split raw vs. readable

- Raw JSON keeps being written (still useful as exact, machine-checkable evidence - real prompts,
  real replies, real commit shas) but moves to `test-results/raw/<YYYY-MM-DD>/<eval|manual|unit>/`.
- The new primary, human-facing artifact is **one file per day**: `test-results/<YYYY-MM-DD>.md`.
  Every run that day - however many, however many kinds - appends a dated, timestamped section to
  that same file. Not one file per run.
- `ui/api/coach-chat/_tests/coach-chat-eval/transcripts/` (the fixed source-of-truth scenario
  inputs) doesn't move - only the dated *output* folder does.

### 2. `kdb/test-doc-style.md` - the day-doc format

A short, new style doc (sibling to `kdb/doc-style.md`, which governs design docs specifically and
doesn't fit an operational log). Defines one skeleton per day-doc, and one template per test kind
inside it - kinds differ enough (a table of transcript pass/fail vs. a turn-by-turn chat
transcript vs. a file-diff summary) that one shared table format would lose information. Rough
shape:

```markdown
# Test results — 2026-09-14

## Run 1 — 14:02, verifying PR #1021 (requested by Tech Lead)

**Scope decided:** workout_create eval transcripts #12/#15 (PR touches coachPromptText.ts's
workout_create section) + 2 manual repo checks. Skipped the other 21 eval transcripts - untouched
since the 2026-09-10 pass, nothing in this diff touches what they exercise.

### Unit suite
412 passed, 0 failed, 3.1s. Raw: `test-results/raw/2026-09-14/unit/vitest-results-14-02-11.json`

### Live eval — paid, model: gemini-pro-latest via OpenRouter, 2 calls, $0.014
| Transcript | Result | Notes |
|---|---|---|
| #12 workout-create-basic | PASS | |
| #15 workout-create-injury-dose | FAIL | `injury_event` missing on turn 2 - see Bug below |

**Bug:** `coachPromptText.ts:213` - injury-dose instruction dropped when workout_create's own
block was rewritten. Fix: re-add the cross-reference sentence PR #1021 removed.

### Manual live-chat — athlete: skanda, repo: coach-skanda-2003, branch: test/1021-verify,
model: gemini-pro-latest, 1 call, $0.009
1. Turn 1 - "give me a new core routine" → `workout_create` fired → commit `a1b2c3d` → diff:
   `+user_data/.../sessions/2026-09-14_core_a.json` → PASS

### Manual repo verification — repo: coach-akash-suresh, branch: core/973-migrate-akash
`validate-current-week`: PASS. Diff reviewed: `engine/lib`/`engine/scripts` re-carved,
`current_week.json` migrated (2 fields dropped, 0 discipline values normalized).

**Run cost:** $0.023 (3 paid calls). **Day total so far:** $0.023.
```

Every section states, at minimum: what ran, why it was selected (not just "everything"), the
model/provider for any paid section, and a pass/fail verdict per case. A failure always gets a
named root cause (file:line) handed to Tech Lead, not just "FAIL."

**Cost is not optional, on every paid section.** Every call to a paid provider (`eval:coach-chat`,
`test:coach-chat-manual`, and the simulation suite above) logs its call count and real dollar cost
next to the model/provider it used - not just which model, how much it cost.

**A real prerequisite, checked directly, not assumed:** `askGemini()`'s public return type is
`Promise<GeminiReply>` only - token usage is computed internally by
`geminiAdapter.ts`/`openRouterAdapter.ts` (for Sentry spans) but never reaches the caller today.
The wiring PR needs to extend `askGemini`'s return shape to also carry the usage numbers the
adapters already compute. That lets `eval-coach-chat.ts`/`run-manual-coach-chat-test.ts` multiply
real token counts by the provider's own per-token pricing
(`docs/eng-docs/llm-provider-current.md`'s Options table) - not an estimate, and not a new
capability, just a value that already exists one layer too deep. Each run
section ends with its own **Run cost**, and the day-doc's very last run of the day adds a
**Day total**, so a week of day-docs is also a week of real spend, readable without opening a
billing dashboard.

### 3. The fourth test type: a tracked FSP/daily-conversation simulation suite

Checked directly (2026-09-14): the *capability* already exists, just not as a tracked test type.
`test:coach-chat-manual` already calls the real production `handle()` - real SOUL (from the
generated build, not a stub), real athlete repo files, real multi-turn conversation via `--turns`.
`ui/scripts/examples/` already has real, realistic scenario files for exactly this -
`manual-coach-chat-turns-fsp.json` (a full six-turn First Session) and
`manual-coach-chat-turns-daily.json`/`-daily-2.json` (ordinary daily check-ins). The gap is
process, not mechanism: these are run by hand, one file at a time, whenever someone remembers to.
No driver runs the full set, scores it, or tracks when a scenario was last verified - unlike
`eval:coach-chat`'s 23 transcripts, which get exactly that treatment.

**The fix:** a `vade-the-tester`-owned driver that runs a defined library of scenario files
(seeded from the existing `examples/` FSP and daily files, grown over time) through
`test:coach-chat-manual`'s real pipeline. It scores each against its own `expect` block, the same
shape `eval:coach-chat`'s transcripts already use. Each scenario gets a day-doc section (see the
format below) plus a `coverage-index.json` entry, so an unchanged scenario doesn't get re-run for
free every single day.

**Real-repo constraint, not a simplification:** only two people build this app and both have real
athlete repos cloned locally (`coach-skanda-2003` and `coach-akash-suresh`, plus
`coach-skanda-testing` for anything that needs a wipe). This test type always runs against one of
those real repos on a scratch branch, never a synthetic/mocked one. That's the whole point of the
type - proving the real pipeline against real data, the same guarantee `test:coach-chat-manual`
already gives, just made repeatable and tracked instead of ad hoc.

### 4. Selective re-run: `test-results/coverage-index.json`

A small machine index, separate from the human day-doc (grepping prose for "did this pass
before" would be fragile). One entry per test case:

```json
{
  "eval:15-workout-create-injury-dose": {
    "type": "eval",
    "last_pass_sha": "6f7c632c",
    "last_run_date": "2026-09-10",
    "watched_paths": ["ui/api/coach-chat/_lib/gemini/coachPromptText.ts", "ui/api/coach-chat/_lib/decide/turnWrites/workoutWrite.ts"],
    "status": "pass"
  }
}
```

Before running a candidate case, vade-the-tester checks `git diff --quiet <last_pass_sha> HEAD --
<watched_paths>`. An empty diff means skip - nothing this case exercises has changed since it last
passed. A case with no index entry (new) or `status: "fail"` always runs. This is ADR 0024's own
"name what this diff could catch" principle, applied per test case instead of per PR. The free
unit suite is the one exception - it always runs in full; it's fast enough that selecting a subset
isn't worth the bookkeeping. Tech Lead can force a full run (ignoring the index) before a release -
an explicit ask, not the default.

### 5. The handoff loop

1. Tech Lead hands off a diff to verify (a PR, or "full regression" before a release).
2. vade-the-tester checks `coverage-index.json` for cases whose `watched_paths` intersect the
   diff, plus any case still at `status: "fail"`, plus any genuinely new behavior with no existing
   coverage (writes a new transcript/scenario for it).
3. Runs only that set. Unit suite always runs in full.
4. Appends a run section to today's `test-results/<date>.md`, updates the coverage index.
5. Reports back to Tech Lead: pass/fail summary, and for every failure a concrete finding - same
   evidence bar as a code-review finding, file:line plus failure scenario, not a vague "something's
   off."
6. Tech Lead fixes, hands back only the failed cases (+ whatever the fix itself now touches) -
   not a full rerun.

Tech Lead's "verification" of vade-the-tester's report means reviewing that evidence - the named
file:line, the real `git diff`/commit sha, the raw JSON. It's the same relationship Tech Lead
already has with a green CI check, not a blind trust that needs no evidence at all.

## Wiring (the actual build, when this plan is picked up later)

Suggested as 4 stacked PRs. The simulation suite ships first, deliberately - it's the one piece
that closes a real, named gap in what's testable *today* (the FSP/daily-conversation regression
hole `coach-chat-testing.md` now names explicitly) independent of whether the agent role itself
ever lands. Establishing the role second means vade-the-tester's very first real duty, once it
exists, is running a capability that already works end to end - not standing up infrastructure
with nothing yet to point it at.

**PR1 - the FSP/daily-conversation simulation suite. Ships before the agent role exists.**
- A small driver script runs a defined library of `--turns` scenario files (seeded from
  `ui/scripts/examples/manual-coach-chat-turns-fsp.json` and the `-daily`/`-daily-2` files)
  through `test:coach-chat-manual`'s real pipeline against real local athlete repos
  (`coach-skanda-2003`/`coach-akash-suresh`/`coach-skanda-testing`). It scores each against an
  `expect` block, and writes a `coverage-index.json` entry per scenario.
- Extend `askGemini()`'s return shape to surface the token-usage numbers
  `geminiAdapter.ts`/`openRouterAdapter.ts` already compute internally but never return today -
  the real prerequisite for cost tracking, named above.
- This PR can be reviewed and live-tested on its own, with no vade-the-tester role, no renamed
  folder, no day-doc format yet - it's a standalone capability, not a dependency of the rest.

**PR2 - establish the role, no behavior change:**
- New ADR `kdb/decisions/0044-vade-the-tester-agent.md` (Context/Decision/Why/Rejected/Enforces,
  modeled on ADR 0034), indexed in `kdb/decisions/README.md`.
- New role doc `.github/agents/vade-the-tester.md`, following the worker-doc skeleton
  (`## Scope`, boot reads, mechanics, `## Learnings`) every other role doc uses. Names the
  simulation suite from PR1 as one of the four test types it owns from day one.
- `AGENTS.md`: new routing table row, bump the "Six agents" count.
- `tech-lead.md`: add to "The Team" table + boundaries bullets.
- `CODEOWNERS` + `platform/scripts/gen-codeowners.py`'s `SCOPE_MAP`: vade-the-tester's owned
  paths (infra only, per the scope decision above).
- `.claude/hooks/session-start.sh` + `.cursor/rules/routing-gate.mdc`: bump their agent count
  (already stale at "Five" vs. AGENTS.md's "Six" - pre-existing drift, fix alongside this change
  rather than leave two different wrong numbers).

**PR3 - the mechanical infrastructure:**
- Rename `tests/` to `test-results/`, with a `raw/` subpath. Update every script that writes
  there (`eval-coach-chat.ts`, `run-manual-coach-chat-test.ts`, `run-tests-logged.ts`, PR1's new
  driver, and whatever shared lib computes the dated path) and every doc that references the
  old path.
- New `kdb/test-doc-style.md`, including the cost-tracking requirement above.
- New `test-results/coverage-index.json` (seeded from PR1's simulation-suite entries plus, where
  cheaply derivable, backfilled from the existing 96 dated JSON files).
- Update `docs/eng-docs/coach-chat-testing.md` to describe the new day-doc system as primary,
  raw JSON as backing evidence, and the simulation suite as a fourth, tracked test type rather
  than a known gap.

**PR4 - prove the loop works:**
- vade-the-tester's first real verification pass against a real pending change, producing the
  first real `test-results/<date>.md` (with real cost figures) and a real coverage-index update
  end to end.
- Delete this plan file (`docs/plans/vade-the-tester.md`) per the plan-delete-on-last-PR rule,
  once PR4 lands.

## Open decision - not resolved here

**The 6 root-level ad hoc testing docs** (`GEMINI-PRO-BASELINE-2026-09-10.md`,
`OPENROUTER-K1-RETEST-FINDINGS.md`, `OPENROUTER-K1-TEST-RESULTS.md`,
`LIVE_VERIFICATION_REVIEW_FIXES_727.md`, `PAID_EVAL_AND_MANUAL_VERIFICATION_727.md`,
`WORKOUTS_AND_CURRENT_WEEK_LIVE_TEST_RESULTS.md`) - what happens to them is explicitly left for
the athlete to decide later, not resolved by this plan.

## Done when

- The FSP/daily-conversation simulation suite (PR1) runs against real local athlete repos,
  scores its scenarios, and `askGemini()` surfaces real token usage to its callers.
- ADR 0044 accepted, role doc merged, routing fully wired (`AGENTS.md`, `tech-lead.md`,
  `CODEOWNERS`, both routing-gate pointer files).
- `test-results/` replaces `tests/` everywhere, `kdb/test-doc-style.md` exists and is followed,
  including its cost-tracking requirement.
- `coverage-index.json` exists and a real verification pass has used it to skip at least one
  already-passing case.
- One real day-doc exists from an actual vade-the-tester run, with real cost figures, not a
  synthetic example.
- The 6 root-level docs have an explicit decision (still open as of this plan).
- This file is deleted in the finishing PR.
