# OpenRouter K1 re-test - findings log

Narrative log for the OpenRouter re-test of PR #921's tip. See `OPENROUTER-K1-TEST-RESULTS.md` for
the structured per-scenario pass/fail results this feeds from.

## Status

**Investigation complete. Decision: stay on `gemini-pro-latest` direct for now** - see "Model &
provider comparison" below for the full reasoning and real numbers. Whole 26-PR stack rebased and
mergeable, not merged. Five PRs stacked on `main`: #948 (the 7 original findings) -> #949 (Finding
D's reprompt safety net) -> #950 (Finding C's residual bug) / #951 (test-infra + a real
`GEMINI_API_KEY` bug) / #952 (a genuine crash-fix found during Finding D's larger pass) - 950/951/952
are three siblings on #949, not a linear chain. Testing workflow for local athlete repos is
documented in `docs/eng-docs/coach-chat-testing.md` (added on #951).

**Open, as of 2026-09-10:** Finding D (structured-output omission on dense messages, see "Still
open" below) and direct pro's `GEMINI_API_KEY` billing credits, which ran out mid-investigation and
block a planned re-verification of Findings A/B/E directly on pro (see "Model & provider
comparison" for what that blocked and what was tried instead).

---

## Bugs found and fixed

Across #948-#952, full check gate green (9/9) after every commit. Every "live-verified" claim
below is a real diff on a real athlete repo, not the test harness's own PASS/FAIL guess.

| Bug | Root cause | Fix | Verification |
|---|---|---|---|
| **Finding A** - `plan_edit`/`session_reconcile` silently no-op'd while the reply claimed success | `requestCoachReply` never gave the model real template/session ids to reference on an ordinary turn | Fetch that context before asking the model, not just after to validate a guess | Live-re-verified 3/3 on `coach-prateek`, varied phrasing, every diff confirmed against real `current_week.json`. Pre-existing, provider-agnostic - not an OpenRouter bug |
| **Finding B** - `template_edit` refused 100% of the time (6/6) | A Claude-Code-only SOUL guardrail ("never modify template files") was composing into the hosted chat build too, where it had nothing to do with the separate, validated `template_edit` action but read as a ban on it | Scoped the guardrail correctly (Claude-Code layer vs shared layer) | Live-verified on `coach-akash`: fires and commits for real |
| **Finding C** - OpenRouter had no retry on `finish_reason: "length"` truncation (~37% of first-turn calls failed outright) | Missing retry, plus a second distinct bug: malformed JSON with a finish reason that isn't `"length"`, so the first retry never engaged | One retry mirroring the Gemini adapter's pattern (#948); second bug fixed on #950 | First fix dropped the rate to ~20%, not zero. Full fix live-verified 10/10 clean afterward |
| **Finding E** - `quest_event` had no reprompt safety net if the model just skipped it (3/3 misses) | Weaker prompt instruction than `season_start`'s equivalent | Strengthened the instruction to match | Live-verified 3/3 on `coach-skanda`, real `progress.json` writes confirmed via diff |
| `injury_flag` duplication - a re-stated injury on a filler turn could mint a genuine duplicate flag | No dedup existed at all | Word-overlap dedup check plus a matching prompt restraint instruction | Unit-verified, fixture assertion added |
| Dropped-action reply dishonesty - athlete's `reply` claimed a dropped action worked | Correction only reached next turn's context, not the same turn's reply | Same-turn reply now carries the correction | Unit-verified |
| Eval transcript date rot - transcript 19 hardcoded a session date that rotted twice (same #807 bug class) | Hardcoded date | Resolves its date at run time instead | Can't rot the same way again |
| `coach-chat.ts`'s real `handle()` required `GEMINI_API_KEY` regardless of provider - a genuine production bug | Found while fixing test-infra gaps; a deployment with only `OPENROUTER_API_KEY` set had coach-chat entirely disabled | Reads the right key for the resolved provider | Fixed on #951, live-verified |
| Direct Gemini flash truncating on `MAX_TOKENS` 8/8 times on the dense-message scenario | Thinking alone was consuming ~3930 of the 4096-token `CHAT_MAX_OUTPUT_TOKENS` budget, leaving almost no room for JSON output | Raised budget to 8192 | Fixed on #952, live-verified 0/8 -> 6/6 clean. Plain crash fix, no provider/model judgment involved |

**Confirmed still working, no regression:** the #27 fix (hallucinated `template_id`/`session_id` no
longer crashes the whole atomic commit) - 0/3 crashes on the exact field-crowding load that used to
crash 4/5 times, live-verified. The `new_habits` P0 guard - happy path live-confirmed, crash-guard
unit-tested. Template generation at onboarding through the OpenRouter seam - live-verified clean.

---

## Still open

### Finding D - severe structured-output omission, root cause unknown

**What's happening:** send a dense first message (a goal + 2 injuries + 2 habits, all in one
message) to a freshly-reset athlete, and the model frequently returns only `profile_update.name`,
silently dropping everything else - while its `reply` text still narrates the dropped facts as
saved. Not a crash, not a validation drop (`droppedActions` is empty) - the fields are just never
in the model's JSON.

**Ruled out with data, not guessed away** (24 live OpenRouter calls, `google/gemini-3.8-flash`, low
reasoning effort - 0/8 full successes, 7/8 dropped everything but the name):
- Reasoning effort - raising `low` -> `medium` (confirmed 587-1327 real reasoning tokens spent via
  OpenRouter's own usage payload) still gave 2/2 total omission, and added a 3rd truncation crash.
- Token budget - completion stayed at 250-470 of a 4096 budget, `finish_reason: "stop"`, nowhere
  near exhausted.
- Declaration order - the schema declares `season_start`/`injury_flag` *before* `profile_update`,
  yet the later-declared field is what survives.
- A prompt instruction addition ("save facts on message 1 too") - made zero measurable difference,
  3/3 failed identically before and after.
- Turn-1-specific - a turn-2 control (same message, restated after one trivial turn, real history
  present) still dropped everything, so this is not turn-1-specific either.

**Not purely OpenRouter-specific.** See "Model & provider comparison" below for the direct-Gemini
head-to-head that proves this - the instability travels with the flash model itself, not the
OpenRouter routing path.

**Mitigation built and live-tested: a reprompt safety net, real improvement, not a full fix.**
Added `unrecorded_facts` to the response schema - the model self-audits its own `reply`/`coach_note`
against what it actually set in action fields this turn, and lists anything mentioned-but-uncaptured.
If it flags anything, one reprompt fires (same one-retry-cap pattern as the two existing
content-violation reprompts in `coachTurn.ts`), naming exactly what's missing. Chosen over a
keyword-heuristic alternative because dense messages use too much wording variety for a fixed
keyword list to reliably tell "a new fact" from "a reference to something already on file."

**Larger sample (32 trials: 18 OpenRouter, 14 direct flash) - the small-sample read above was
optimistic, not representative:**

| Leg | n | Full success | Partial-but-honest | Total silent omission | False-success-claim |
|---|---|---|---|---|---|
| OpenRouter `google/gemini-3.8-flash` | 18 | 0 | 17 | 1 | 0 |
| Direct `gemini-flash-latest` (after the token-budget fix) | 6 | 0 | 3 | 1 | 2 |

Full success is rare on either provider at this sample size, not common as the earlier 5-7-trial
read suggested. Habits get honestly deferred in every single trial across all 32 runs (100%) - the
model consistently wants more intake before committing them, and the reprompt doesn't override
that. Total silent omission still happens on OpenRouter (1/18) - the self-audit missed it, a second
confirmed false negative. Direct flash produces false-success-claims at 2/6 (33%) even after its own
crash bug (see "Bugs found and fixed") was fixed - the self-audit missed both.

**Honest read:** the reprompt safety net is real and worth keeping (a strict improvement with no
downside), but at this sample size it is clearly not reliable enough on its own to justify moving
off `gemini-pro-latest`. The self-audit itself is wrong often enough (3 confirmed false negatives
across 32+ trials, on both providers) that a false-success-claim or a silent omission can still
reach a real athlete. **This firmer data points more strongly toward keeping M3 blocked, not less.**

**Do not merge anything touching coach-chat's model-calling path, and do not proceed with M3
(flipping `LLM_PROVIDER=openrouter` in production), until flash's reliability on this scenario
improves upstream or a stronger mitigation is found.**

### Direct pro's `GEMINI_API_KEY` ran out of billing credits (2026-09-10)

Every call, direct or via `soulCache`'s context-caching path, returns `429 RESOURCE_EXHAUSTED -
"Your prepayment credits are depleted"`. Confirmed independently by 3 separate live-verification
attempts (Finding A on `coach-prateek`, Finding B on `coach-akash`, Finding E on `coach-skanda`),
all hitting the identical error with correct config (`LLM_PROVIDER` unset, `gemini-pro-latest`
resolved correctly). This is the same key production's real current default provider uses - while
this key has no credit, direct pro cannot serve any request at all, test or production. Needs a
human to top up at ai.studio before the pending direct-pro re-verification (confirming Findings
A/B/E hold on pro specifically, not just on OpenRouter/flash where they were originally found) can
run. See "Model & provider comparison" for what was tried as a same-day substitute.

---

## Model & provider comparison

### Why does `pro` work so well while flash fails so much?

Most likely just model-capability tier - `pro` needs less "thinking" to reliably extract several
facts from one dense message than a smaller/faster model does. Nothing found in this investigation
contradicts that; not tested further since there was no lead suggesting otherwise.

### Direct Gemini vs OpenRouter, same scenario, same repo, same reset-to-blank-FSP method

| Model | Full success | Partial omission | Total omission | n |
|---|---|---|---|---|
| OpenRouter `google/gemini-3.8-flash` | 0/8 (0%) | 1/8 | 7/8 (88%) | 8 |
| Direct Gemini `gemini-pro-latest` (production's real current default) | 12/12 (100%) | 0/12 | 0/12 | 12 (10 baseline + 2 turn-2 control) |
| Direct Gemini `gemini-flash-latest` (temporary local override, matched to OpenRouter's alias) | 4/9 (44%) | 3/9 (33%) | 2/9 (22%) | 9 (8 baseline + 1 turn-2 control) |

Turn-2 control: pro was clean 2/2 (matches its 10/10 baseline - genuinely not turn-specific in
either direction for pro). Flash's single turn-2 control was a full success, but only after the
existing `coach_note`-missing reprompt regenerated the reply and picked up `injury_flag` the second
time - the first pass of that same turn also dropped a field, so flash's problem isn't turn-specific
either.

**Verdict: this is not purely OpenRouter-specific.** Direct-Gemini `gemini-pro-latest` - what
production actually runs today - is completely clean (12/12), so there's no live production risk
right now. But the same underlying `google`-side flash model, called directly through Gemini's own
API with no OpenRouter routing involved, still drops structured fields at a real, non-trivial rate
(5/9 not fully clean). That rules out "OpenRouter's routing/proxy layer is the cause" as the full
explanation - the instability travels with the flash model itself, not the OpenRouter path.
OpenRouter's number is still meaningfully worse than direct flash's (0% vs. 44% full success), so
OpenRouter may still be compounding the problem on top of flash's own baseline unreliability - but
flash itself, independent of OpenRouter, is not safe for this scenario. Two new flash-specific
failure shapes were seen that never appeared in the pro runs or the OpenRouter data: a `coach_note`
correctly narrating facts while the matching structured field never appeared at all (not recoverable
by the existing reprompt in 2 of 3 cases), and one run where the model spent its output generating a
200+ item garbage `sports_update` array instead of the real fields (a runaway generation, not a
clean omission).

**Practical read:** production is safe today (`gemini-pro-latest`, 12/12 clean) as long as it stays
pinned there. Reverting to `gemini-flash-latest` for cost/speed reasons, independent of any
OpenRouter decision, would reintroduce this exact omission risk.

### Why is OpenRouter's flash worse than direct Gemini's flash?

Root-caused, not guessed: `openRouterAdapter.ts` forces `reasoning: {effort: "low"}` on every call
(the model 400s on `{enabled: false}` - "low" is the floor), specifically to stop it burning its
output budget on reasoning (Finding C). `geminiAdapter.ts` sets no reasoning config at all - direct
Gemini flash gets whatever default thinking budget the API picks for itself.

| Effort | Full success | Partial | Truncation (100% visible failure) | n |
|---|---|---|---|---|
| "low" (shipped default) | 0/8 | 1/8 | 0/8 | 8 |
| "medium" | 3/5 | 2/5 (1 honest, 1 false-claim - self-audit missed it) | 0/5 | 5 |
| "high" | 0/5 | 0/5 | 5/5 (100%) | 5 |

"Medium" is a real improvement over "low." "High" is strictly worse than doing nothing - every
single trial burned ~3930 of the 4096-token budget on reasoning and truncated twice in a row (both
retries exhausted, surfaces as a visible 502 every time). **If OpenRouter's reasoning effort is
ever raised, "medium" is the only defensible value - never "high."** Not shipped - this is a real
tradeoff against Finding C that needs a decision, not a default choice made silently.

### Is the `google-vertex` routing pin even verifiable?

No - confirmed, not just assumed. Hit OpenRouter's raw endpoint directly with and without the pin:
identical `provider: "Google"` in the response either way, no `X-Provider-Name` header actually
sent despite being listed as exposable, `/api/v1/generation` 404s under this account's
`data_collection: "deny"` exactly as predicted. The existing code comment is accurate and complete -
this really is unknowable from the client side.

### How does DeepSeek perform (via OpenRouter)?

Tested live, 5 trials, same scenario. Not viable: 0/5 full success (worse than either Gemini flash
variant), plus a failure mode neither Gemini variant showed - hallucination (invented
`profile_update` values never stated, e.g. a fabricated name and timezone). The self-audit missed
both of DeepSeek's worst trials too - same blind spot already seen once on direct Gemini flash, now
seen twice across two different models.

### DeepSeek v4 pro (via OpenRouter), a separate newer model, 4 trials

`deepseek/deepseek-v4-pro` (distinct from whichever DeepSeek id the 5-trial test above used) - no
`google-vertex` pin applies, resolved to provider "NextBit." `OPENROUTER_MODEL` locally overridden
for these runs only, same worktree/method as the OpenRouter-pro trials above, not committed, not
shipped. Also required dropping the adapter's hardcoded `provider.only: ["google-vertex"]` filter
(Google-specific, meaningless for a non-Google model) for the raw request to route at all.

| # | Scenario | Repo | Result | Evidence |
|---|---|---|---|---|
| 1 | Finding E (`quest_event`, mark `cold_shower` complete) | coach-skanda | **FAIL, severe hallucination** - asked to log one habit completion, the model instead fabricated an entire absent narrative (a "20-day gap since last check-in" that never happened), resolved 3 real, unrelated injury flags with invented justification text, fired a wrong action (`quest_create` instead of `quest_event` for an already-existing quest), and fabricated a whole new season ("ABC Prep") with invented dates and a main quest never discussed. `unrecorded_facts` came back empty - the self-audit saw nothing wrong with any of it | Real diff: 6 files touched (`injuries.json`, `seasons.json`, `quests.json`, `memory.json`, `coach_log.json`, `chat_history.json`) - all real writes, none reverted by any validator |
| 2 | Finding A (`plan_edit`, swap a real session to a rest day) | coach-prateek | **PASS** - real session `sess_20260911_1` swapped from "Easy Mobility & Recovery" to a Full Rest Day, correct id, clean | Real diff: `current_week.json`'s `sess_20260911_1` entry confirmed changed |
| 3 | Finding B (`template_edit`, drop `workout_a`'s wrist warm-up phase) | coach-akash | **FAIL, false-success claim** - `template_edit` fired with `skip_phases: ["Wrist Warm-up"]`, but the real phase is named "Warm-up — Wrist Prep" - same string-mismatch shape as the OpenRouter-pro trial above. App correctly logged the mismatch and dropped the edit, but the reply claimed "The wrist warm-up is out of workout_a for good" | Real diff: `workout_a.json`'s `phases` array unchanged, "Warm-up — Wrist Prep" still present |
| 4 | Progress-quest completion (`quest_event`, first full push-up, a fresh repo/athlete) | coach-date2022 | **FAIL, false-success claim** - `quest_event` never appeared in the JSON at all (not even attempted and dropped - just absent), yet `coach_note` stated "Updated push-up progression milestone to 1." `unrecorded_facts` came back empty again | Real diff: `quests.json`'s `full-pushup` entry still `current: 0`, target `1`, unchanged |

**Read, n=4: 1 pass, 3 fails, all 3 fails are false-success claims the self-audit missed
completely.** Worse than the earlier 5-trial DeepSeek result, and a materially more dangerous
failure shape - the earlier test found hallucinated *profile* fields (wrong name/timezone,
annoying but low-stakes); trial 1 here fabricated and committed changes to *injury* and *season*
state, the kind of data an athlete would reasonably expect to be accurate, and trials 3-4 show the
same "claims success, nothing changed" pattern is not a one-off. `unrecorded_facts` was empty on
every single failure (4/4) - on DeepSeek, the self-audit is not just imperfect, it has caught
nothing yet across every trial run against it. Enough to keep DeepSeek off the table for anything
production-facing regardless of final sample size.

### OpenRouter-pro, tried as a same-day substitute while direct pro's key was dead

`google/gemini-3.1-pro-preview` via `google-vertex` - not a stand-in for direct pro, it's a
different model id behind a different routing path, but real live-tested data on it is worth
keeping regardless. All 3 trials ran from a worktree with the actual `selectLlmAdapter` wiring
(`origin/fix/finding-d-more-verification`, PR #952's tip - HQ's own `main` checkout does not have
this wiring yet, `coachTurn.ts` there still calls `askGemini`/direct-Gemini unconditionally,
confirmed the hard way after an initial test run against `main` silently no-op'd). `OPENROUTER_MODEL`
was locally overridden from `google/gemini-3.8-flash` to `google/gemini-3.1-pro-preview` for these
runs only, not committed, not shipped.

| # | Scenario | Repo | Result | Evidence |
|---|---|---|---|---|
| 1 | Finding E (`quest_event`, mark `cold_shower` complete) | coach-skanda | FAIL - 1st attempt hit a hard OpenRouter 502 (real infra failure, not our code); retry ran clean but the model never emitted `quest_event`, only a `coach_note` - and falsely claimed "cannot log as `quest_event` is missing from the provided schema" (it is not). The `unrecorded_facts` self-audit correctly flagged it, the reprompt fired, but the model repeated the same false claim on the second pass too | Real diff: only `chat_history.json` changed, `quests.json` untouched |
| 2 | Finding B (`template_edit`, drop `workout_a`'s wrist warm-up phase) | coach-akash | FAIL, false-success claim - `template_edit` fired with `skip_phases: ["wrist warm-up"]`, but the template's real phase is named "Warm-up - Wrist Prep" - a string mismatch. The app correctly logged `no phase named "wrist warm-up" in this template - ignoring` and dropped the edit, but `coach_note`/`reply` both still claimed success | Real diff: `workout_a.json`'s `phases` array unchanged, "Warm-up - Wrist Prep" still present |
| 3 | Finding A (`plan_edit`, swap a real session to a rest day) | coach-prateek | PASS - real session `sess_20260911_1` swapped from "Easy Mobility & Recovery" to a Rest Day, correct id picked out of 5 real sessions in the week | Real diff: `current_week.json`'s `sess_20260911_1` entry confirmed changed (`title`, `discipline` both updated) |

**Read:** small sample (n=3), but two new failure shapes neither direct-pro nor OpenRouter-flash
testing has shown before - a false "not in the schema" claim, and a phase-name string mismatch
silently swallowed while the reply still claims success. Both are self-audit blind spots, same class
of gap Finding D's mitigation already isn't fully closing. Not enough data to characterize
OpenRouter-pro's real reliability, but enough to say it is not a clean drop-in either - do not treat
"OpenRouter can reach a pro-tier model" as equivalent to "direct pro's reliability, just cheaper."

### Overall recommendation

**Stay on `gemini-pro-latest` direct for now.** It remains the only 12/12-clean option found
anywhere in this whole investigation. Nothing tested - not the reprompt safety net, not raising
reasoning effort, not DeepSeek, not OpenRouter-pro - closes the reliability gap enough to justify
the cost savings today. If cost pressure forces a move anyway, "medium" reasoning effort on
OpenRouter flash plus the reprompt safety net is the least-bad combination found, but it is a real,
measured tradeoff (occasional partial omissions, one confirmed false-claim, a self-audit that isn't
airtight) - not a safe default, a deliberate risk to accept knowingly.

---

## Merge readiness - what's left before this stack merges

1. **DONE - decision made.** Model/provider question resolved: stay on `gemini-pro-latest`. Not a
   blocker to merging - production keeps its current default either way, nothing in this stack
   flips it. Revisit if flash's reliability improves or cost pressure forces the tradeoff.
2. **DONE.** Findings A and C both fixed and re-verified live. A holds up cleanly (3/3). C got a
   second fix (#950) for the residual malformed-JSON bug the first fix's retry didn't cover.
3. **DONE.** K1's own LLD (`docs/plans/ccr-k1-final-test-pass-lld.md`) records today's work, pushed
   to #824. M2's LLD execution table is still stale (low priority, "leave M2 for now" stands).
   Plan-file deletion correctly not done yet (K1 hasn't merged).
4. **DONE.** All 7 test-infra gaps fixed on #951, plus a real `GEMINI_API_KEY` production bug found
   and fixed in the same pass, plus the local-athlete-repo testing workflow now documented in
   `docs/eng-docs/coach-chat-testing.md`. `activity_sync` mode testing intentionally left out per
   explicit instruction (deferred, not forgotten).
5. **F1 (athlete repo migration/backfill)** - still the hard production blocker, unrelated to
   everything above. Merging triggers an immediate production deploy (confirmed via `vercel.json`);
   without F1's `coaching_style` backfill, every real athlete's onboarding resets on their next
   message. Not started.
6. **M3 (flipping the provider in production)** - not started, and given the decision above (stay
   on `pro`), not currently planned. Revisit "Model & provider comparison" above if that changes.
7. **Real athlete repo scratch branches have accumulated well past 157** across this whole
   investigation. None touch any athlete's real `main`, none are PRs. Cleanup owed once the
   investigation is fully done, not urgent - explicitly deferred per instruction, same as
   `activity_sync` and `coach-message` testing.
8. **Git mechanics are not blocking anything** - the whole 26-PR stack (`769`->...->`921`->`948`->
   `949`->{`950`,`951`,`952`}) is rebased onto current `main`, green CI, mergeable. Nothing merged.

---

## Test-infrastructure gaps - all fixed on #951 except one deferred item

- **Fixed:** `--debug`/`DEBUG=1` dumps the raw assembled prompt now.
- **Fixed:** `pretest:coach-chat-manual` hook builds SOUL automatically on a fresh checkout.
- **Fixed:** `--message` now prints a loud stderr warning about the new-thread-per-call gotcha.
- **Fixed:** `getHeadSha`'s harness call sites retry once on a transient GitHub API race.
- **Fixed:** run log filenames now carry a repo slug, not just a timestamp.
- **Fixed:** `coachTurn.ts`'s log line reports commit-failure drops and validation drops as two
  distinct counters instead of one misleading `droppedFacts`.
- **Fixed:** the harness's own startup check, and `coach-chat.ts`'s real `handle()` (a genuine
  production bug, not just a test-harness one), now require the right API key for the actual
  selected provider instead of always requiring `GEMINI_API_KEY`.
- **Still not fixed, deferred on purpose:** the manual harness has no way to reach
  `mode: "activity_sync"` at all - explicitly left for later per instruction, not forgotten.
- **Documented, not code:** the local-athlete-repo testing workflow (recreating a conversation,
  verifying via real diffs, resetting to blank FSP state via the GitHub API) is now written up in
  `docs/eng-docs/coach-chat-testing.md` instead of living only in agent transcripts.

## Minor observations, pre-existing, not investigated further

- `injuries.json` writes drop `version`/`_meta`, unlike every other file this app writes.
- `memory.json` writes always materialize a `"coaching_style": null` key even when unrelated to the
  turn - a schema-normalization side effect, not a bug.
