# OpenRouter K1 re-test — findings log

Narrative log for the OpenRouter re-test of PR #921's tip. See `OPENROUTER-K1-TEST-RESULTS.md` for
the structured per-scenario pass/fail results this feeds from.

**Status: 7 of 8 findings fixed and pushed on PR #948. Finding D is the only thing still open —
read that section first, everything else below is resolved and kept short on purpose.**

---

## OPEN — Finding D: severe structured-output omission, root cause unknown

**What's happening:** send a dense first message (a goal + 2 injuries + 2 habits, all in one
message) to a freshly-reset athlete, and the model frequently returns only `profile_update.name`,
silently dropping everything else — while its `reply` text still narrates the dropped facts as
saved. Not a crash, not a validation drop (`droppedActions` is empty) — the fields are just never
in the model's JSON.

**Real numbers, not estimates:** a deep-dive with real prompt/response instrumentation (24 live
OpenRouter calls, `google/gemini-3.8-flash`, low reasoning effort) found **0/8 full successes** —
7/8 dropped everything but the name. A turn-2 control (same message, restated after one trivial
turn, real history present) still dropped everything — so this is **not turn-1-specific**, contrary
to the original (much smaller-sample) read.

**Ruled out with data, not guessed away:**
- Reasoning effort — raising `low` → `medium` (confirmed 587–1327 real reasoning tokens spent via
  OpenRouter's own usage payload) still gave 2/2 total omission, and added a 3rd truncation crash
  (a real tradeoff against the Finding C fix — more reasoning effort measurably hurts that one).
- Token budget — completion stayed at 250–470 of a 4096 budget, `finish_reason: "stop"`, nowhere
  near exhausted.
- Declaration order — the schema declares `season_start`/`injury_flag` *before* `profile_update`,
  yet the later-declared field is what survives.
- A prompt instruction addition ("save facts on message 1 too") — made zero measurable difference,
  3/3 failed identically before and after. The existing instruction was already explicit and
  unambiguous; wording is not the bottleneck.

**Direct-Gemini comparison, now run (Sep 9) — real numbers, both models tested on the same
scenario, same repo, same reset-to-blank-FSP method as the OpenRouter pass:**

| Model | Full success | Partial omission | Total omission | n |
|---|---|---|---|---|
| OpenRouter `google/gemini-3.8-flash` | 0/8 (0%) | 1/8 | 7/8 (88%) | 8 |
| Direct Gemini `gemini-pro-latest` (production's real current default) | 12/12 (100%) | 0/12 | 0/12 | 12 (10 baseline + 2 turn-2 control) |
| Direct Gemini `gemini-flash-latest` (temporary local override, matched to OpenRouter's alias) | 4/9 (44%) | 3/9 (33%) | 2/9 (22%) | 9 (8 baseline + 1 turn-2 control) |

Turn-2 control: pro was clean 2/2 (matches its 10/10 baseline — genuinely not turn-specific in
either direction for pro). Flash's single turn-2 control was a full success, but only after the
existing `coach_note`-missing reprompt regenerated the reply and picked up `injury_flag` the
second time — the first pass of that same turn also dropped a field, so flash's problem isn't
turn-specific either, same conclusion as OpenRouter's turn-2 finding.

**Verdict: this is not purely OpenRouter-specific.** Direct-Gemini `gemini-pro-latest` — what
production actually runs today — is completely clean (12/12), so there's no live production risk
right now. But the same underlying `google`-side flash model, called directly through Gemini's own
API with no OpenRouter routing involved, still drops structured fields at a real, non-trivial rate
(5/9 not fully clean). That rules out "OpenRouter's routing/proxy layer is the cause" as the full
explanation — the instability travels with the **flash model itself**, not the OpenRouter path.
OpenRouter's number is still meaningfully worse than direct flash's (0% vs. 44% full success), so
OpenRouter may still be compounding the problem on top of flash's own baseline unreliability — but
flash itself, independent of OpenRouter, is not safe for this scenario. Two new flash-specific
failure shapes were seen that never appeared in the pro runs or the OpenRouter data: a `coach_note`
correctly narrating facts while the matching structured field never has appeared at all (not
recoverable by the existing reprompt in 2 of 3 cases), and one run where the model spent its
output generating a 200+ item garbage `sports_update` array instead of the real fields (a runaway
generation, not a clean omission).

**Practical read:** production is safe today (`gemini-pro-latest`, 12/12 clean) as long as it stays
pinned there. Reverting to `gemini-flash-latest` for cost/speed reasons — independent of any
OpenRouter decision — would reintroduce this exact omission risk. M3 (flipping to
`LLM_PROVIDER=openrouter`) should stay blocked until either (a) flash's own reliability improves
upstream, or (b) the reprompt safety-net idea (detect narrated-but-uncommitted facts, force a
corrective second call) is built and proven to catch this — same proposal already on the table
below, now with evidence it would need to fire on direct-Gemini flash too, not just OpenRouter.

**Do not merge anything touching coach-chat's model-calling path, and do not proceed with M3
(flipping `LLM_PROVIDER=openrouter` in production), until a decision is made on the flash-reliability
question above.**

**Mitigation built and live-tested (Sep 9, later pass): a reprompt safety net, real improvement,
not a full fix.** Added `unrecorded_facts` to the response schema - the model self-audits its own
`reply`/`coach_note` against what it actually set in action fields this turn, and lists anything
mentioned-but-uncaptured. If it flags anything, one reprompt fires (same one-retry-cap pattern as
the two existing content-violation reprompts in `coachTurn.ts`), naming exactly what's missing.
Chosen over a keyword-heuristic alternative because dense messages use too much wording variety for
a fixed keyword list to reliably tell "a new fact" from "a reference to something already on file."

**Live numbers, small sample (5-7 trials each, real numbers not rounded up):**
- OpenRouter flash, 5 trials with the fix: **3/5 full success, 2/5 partial-but-honest** (injuries
  captured, goal/habits explicitly and transparently deferred - "holding off until intake is
  confirmed" - never falsely claimed as saved), **0/5 total silent omission** (down from 7/8
  baseline) and **0/5 false-success claims** (down from the core original problem). One partial
  case involved the safety net directly working as designed: first pass had `unrecorded_facts`
  correctly flagging the gap, one reprompt fired, second pass captured everything.
- Direct Gemini flash, 2 trials with the fix: 1/2 full success, 1/2 partial - `season_start` and
  habits captured correctly, but `injury_flag` silently missing despite the reply/coach_note
  narrating it **and the self-audit itself reporting `unrecorded_facts: []`** - a real false
  negative in the self-audit, worth knowing about before trusting it fully.

**Honest read:** this is a real, measurable improvement over the 0/8 and 4/9 baselines - the two
most dangerous failure modes (silent total omission, false success claims) dropped to zero in this
sample, and the safety net demonstrably converted at least one would-be failure into a full success
live. It is not a complete fix - partial omissions still happen, and the self-audit field is itself
sometimes wrong (as the direct-flash injury_flag miss shows). Sample size is small (5-7 per
provider, not the 10+ originally planned) - treat this as a strong positive signal, not a final
verified number. Recommend: land this now (it's a strict improvement, unit-tested, and doesn't
regress anything), keep gathering live data before flipping any production default.

---

## Fixed — 7 items, all on PR #948, full check gate green (9/9) after every commit

- **Finding A** — `plan_edit`/`session_reconcile` silently no-op'd while the reply claimed success,
  because `requestCoachReply` never gave the model real template/session ids to reference on an
  ordinary turn. Fixed by fetching that context before asking, not just after to validate a guess.
  Pre-existing, provider-agnostic — not an OpenRouter bug. **Live-re-verified 3/3** on `coach-prateek`
  with varied phrasing (no explicit session_id stated) — every diff confirmed against real
  `current_week.json` content. Holds up cleanly, fully closed.
- **Finding B** — `template_edit` was refused 100% of the time live (6/6). Root cause: a
  Claude-Code-only SOUL guardrail ("never modify template files") was composing into the hosted
  chat build too, where it had nothing to do with the separate, validated `template_edit` action
  but read as banning it. Fixed by scoping the guardrail correctly. **Live-verified** on
  `coach-akash`: fires and commits for real now.
- **Finding C** — OpenRouter had no retry on `finish_reason: "length"` truncation (~37% of
  first-turn calls failed outright). Fixed with one retry, mirroring the Gemini adapter's existing
  pattern. **Live-re-verified, partial:** confirmed the retry works exactly as designed (2 real
  truncations recovered invisibly across 10 fresh-FSP trials), and the failure rate dropped from
  ~37% to ~20% - but did not drop to near-zero. **New, separate bug found:** the remaining 2/10
  failures are malformed JSON (`SyntaxError: Unterminated string`) with a finish reason that isn't
  `"length"`, so the current retry never engages for them. Not fixed - needs its own fix (broaden
  the retry trigger to cover a JSON-parse failure too, not just the explicit truncation signal).
- **Finding E** — `quest_event` had no reprompt safety net if the model just skipped it (3/3 misses
  in testing). Strengthened its instruction the same way `season_start`'s already was. **Live-verified**
  3/3 on `coach-skanda`, real `progress.json` writes confirmed via diff.
- **`injury_flag` duplication** — a re-stated injury on a filler turn could mint a genuine duplicate
  flag (no dedup existed at all). Added a word-overlap dedup check plus a matching prompt restraint
  instruction and a fixture assertion. Unit-verified.
- **Dropped-action reply honesty** — when a bad reference gets validated and dropped, the athlete's
  `reply` for that same turn used to still claim it worked (correction only reached next turn's
  context). Now corrected in the same turn's reply. Unit-verified.
- **Eval transcript date rot** — transcript 19 hardcoded a session date that rotted twice (same
  #807 bug class, predicted by K1 itself). Now resolves its date at run time instead of staying
  hardcoded — can't rot the same way again.

**Confirmed still working, no regression:** the #27 fix itself (hallucinated template_id/session_id
no longer crashes the whole atomic commit) — 0/3 crashes on the exact field-crowding load that used
to crash 4/5 times, live-verified. The `new_habits` P0 guard — happy path live-confirmed, crash-guard
unit-tested. Template generation at onboarding through the OpenRouter seam — live-verified clean.

---

## Merge readiness — what's left before this stack merges

1. **Finding D** (above) — resolved to a verdict: production (`gemini-pro-latest`) is clean today,
   no live risk. But `gemini-flash-latest` itself is unreliable at this scenario (44% full success
   direct, 0% through OpenRouter) - a model problem, not purely an OpenRouter one. This blocks any
   move toward flash, on either provider, until fixed or a safety net is built. Does not block
   merging code that doesn't touch the model-calling path.
2. **DONE.** Findings A and C both live-re-verified. A holds up cleanly (3/3). C's retry works as
   designed but uncovered a new, separate, unfixed bug (malformed-JSON responses with a non-
   `"length"` finish reason aren't retried) - failure rate dropped 37%→20%, not to zero. Needs a
   follow-up fix.
3. **DONE.** K1's own LLD (`docs/plans/ccr-k1-final-test-pass-lld.md`) now records today's work,
   pushed to #824. M2's LLD execution table is still stale (low priority, "leave M2 for now").
   Plan-file deletion correctly not done yet (K1 hasn't merged).
4. **F1 (athlete repo migration/backfill)** — still the hard production blocker, unrelated to
   Finding D. Merging triggers an immediate production deploy (confirmed via `vercel.json`); without
   F1's `coaching_style` backfill, every real athlete's onboarding resets on their next message.
   Not started.
5. **M3 (flipping the provider in production)** — not started. Now specifically blocked on flash's
   own reliability, not just an OpenRouter question - flipping to OpenRouter would mean flash, and
   flash drops facts on dense messages at a real rate even called directly. Needs either a fix to
   flash's reliability or a reprompt safety net before this proceeds.
6. **157 local-only scratch branches** accumulated across the 6 real athlete repos from all this
   testing (`coach-skanda`: 64, `coach-skanda-testing`: 42, `coach-akash`: 25, `coach-shreyas`: 13,
   `coach-date2022`: 11, `coach-prateek`: 2). None touch any athlete's real `main`, none are PRs.
   Cleanup owed once the investigation is fully done, not urgent.
7. **Git mechanics are not blocking anything** — the whole 22-PR chain + PR #948 is rebased onto
   current `main`, green CI, mergeable. Only the findings above are.

---

## Test-infrastructure gaps noticed (not fixed, low priority, kept short)

- No way to inspect the raw assembled prompt sent to the model without editing source — a debug
  flag on the manual harness would have sped up both major root-cause investigations.
- No `pretest` hook for the manual harness — first run fails with `ERR_MODULE_NOT_FOUND` until SOUL
  is built manually.
- `--message` mode silently starts a new thread every invocation; `--turns` is required for real
  multi-turn continuity — easy to miss, documented but easy to skim past.
- The manual harness has no way to reach `mode: "activity_sync"` at all.
- No retry on a known-shape GitHub API race right after branch creation (one false "ERROR" seen).
- Run log filenames have no repo/athlete tag, only a timestamp — hard to filter when several agents
  test in parallel.
- Resetting an athlete repo to genuinely-blank FSP state is fully manual, no reusable tooling.
- A misleading counter name (`droppedFacts`) in the harness's own log line undercounts what most
  people mean by "dropped."

## Minor observations, pre-existing, not investigated further

- `injuries.json` writes drop `version`/`_meta`, unlike every other file this app writes.
- `memory.json` writes always materialize a `"coaching_style": null` key even when unrelated to the
  turn — a schema-normalization side effect, not a bug.
