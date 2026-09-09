# OpenRouter K1 re-test — findings log

Narrative log for the OpenRouter re-test of PR #921's tip. Root-cause digging on anything that
fails, fixes applied (or proposed if not applied), and gaps noticed in how testing itself is set
up. See OPENROUTER-K1-TEST-RESULTS.md for the structured per-scenario pass/fail results this feeds
from.

Status: COMPLETE. All 6 real-athlete-repo agents + the fixture eval suite + full check gate have
reported. See the bottom of this file for the closing summary and priority-ordered action list.

---

## Fixes applied this pass

All on branch `fix/openrouter-retest-findings`, stacked on PR #921's tip. Full check gate green
(9/9) after every commit.

1. **Finding C** - OpenRouter now retries once on `finish_reason: "length"` truncation before
   giving up, mirroring the Gemini adapter's existing retry. `openRouterAdapter.ts`.
2. **Finding A** - `requestCoachReply` now fetches real template/session context and folds it into
   `extraContext` via `activeTemplatesContext`/`activeWeekSessionsContext` before asking the model,
   instead of only fetching that context after the reply to validate a guess. `coachTurn.ts`,
   `coachWeekFiles.ts`.
3. **Akash's finding** (a dropped action's reply lying for one turn) - the dropped-action
   correction now also gets appended to the reply sent back this same turn, not just folded into
   next turn's `coach_log.json` context. `coachTurn.ts`.
4. **`injury_flag` duplication** - `applyInjuryFlag` now checks incoming text against existing
   active flags (word-overlap ratio, not exact match) before minting a duplicate; the Finding-4
   restraint instruction now also names `injury_flag`. `coachIntents.ts`, `coachPromptText.ts`.
   Transcript 25 got a matching `actionFieldsAbsent: ["injury_flag"]` assertion.
5. **Eval transcript date rot** - transcript 19's session date is now a `{{TOMORROW}}` token
   resolved against the eval script's own real run-time date, not a hardcoded absolute date that
   can rot again. `eval-coach-chat.ts`.
6. **Finding E** - `quest_event`'s instruction now has an explicit anti-pattern callout (mirroring
   `season_start`'s existing one) that describing a completion in `coach_note`/`reply` isn't the
   same as logging it. Live-verified 3/3 on `coach-skanda`, real `progress.json` writes confirmed
   via diff. `coachPromptText.ts`.
7. **Finding B** - split `B_engine.md`'s file-edit guardrail so the Claude-Code-only half (real
   shell/git access to hand-edit a file) no longer composes into the hosted chat build at all,
   where it had nothing to do with `template_edit` (a separate, validated, server-executed
   mechanism) but was read as banning it anyway. Live-verified on `coach-akash`: `template_edit`
   now fires and commits for real (was a 100% refusal rate before, 6/6 attempts across the
   original test). `platform/soul/B_engine.md`, `compose-soul.mjs`, both composed builds,
   `SOUL_HISTORY.md` v5.25.

**Finding D remains unresolved.** A genuine attempt was made (see below) - live-verified as not
having fixed it, reported honestly rather than claimed. Left as an open item, not silently dropped.

## Finding A (P1, pre-existing, provider-agnostic) — `plan_edit`/`session_reconcile` silently no-op and the reply lies about it

Found on `coach-prateek`, root-caused to actual source, not guessed. This is a real production bug
that would reproduce on direct Gemini too - nothing about it is OpenRouter-specific.

**What happens:** on an ordinary turn, ask Coach to swap tomorrow's session for something else
(`plan_edit`) or reconcile what actually happened vs. what was planned (`session_reconcile`,
`actual` override). The model correctly understands the request, writes a `reply` and `coach_note`
narrating that it made the change ("Swapped Thursday's ride for an easy walk...") - but **never
sets the `plan_edit`/`session_reconcile` action field at all.** `current_week.json` is completely
untouched. The athlete is told something happened that didn't. This also directly violates the
app's own `SAVE_CLAIM_GUARD` prompt instruction ("Never say something is saved... unless the
matching action field reflects it").

**Root cause:** `coachTurn.ts`'s `requestCoachReply` (the function behind every ordinary chat turn)
builds `extraContext` for the prompt as just `firstSessionContext(...)` - it never calls
`activeTemplatesContext(templateIds)` or `activeWeekSessionsContext(sessions)`
(`coachPromptText.ts`), the two functions that render the athlete's real `template_id`s/`session_id`s
into the prompt so the model has something legal to reference. Grepped every call site:
`activeWeekSessionsContext` is called exactly once in the whole codebase, in
`commit/activitySyncTurn.ts` - a different code path entirely. `activeTemplatesContext` is called
**nowhere** outside its own definition. Meanwhile the system prompt unconditionally tells the model
"every `template_id`/`session_id` you use must come from the supplied context... never invent one" -
but for an ordinary turn, no such context is ever supplied. Caught between "you may use this field"
and "you may never invent its id," the model either hallucinates a plausible-but-wrong id (caught
safely by post-hoc validation, see `week-plan-kickoff-ritual` below) or - what happened here -
self-censors the action field while still narrating success in prose, because nothing validates
`reply`/`coach_note` text against what was actually committed.

**Why no existing test caught this:** the fixture-based eval harness injects `extraContext` as a
literal field in the transcript JSON itself (e.g. transcript 19's own hand-written
`"extraContext": "Current templates...Current week's sessions..."`) - bypassing `requestCoachReply`
entirely and hand-feeding the model exactly the context `activeTemplatesContext`/
`activeWeekSessionsContext` were supposed to generate for real. Every fixture transcript touching
`plan_edit`/`session_reconcile`/`template_edit` passes because the fixture simulates what the real
code *should* build, not what it *actually* builds. This is a real, live-only bug with a
structural blind spot in test coverage, not a flaky/rare thing.

**Confirms as a data point:** `template_edit` (scenario 5, PR #921's own new scope) *did* work
correctly - but only because the athlete happened to type the exact real template id themselves in
their message, giving the model a legal id without needing `activeTemplatesContext` at all. The
same request phrased the way an athlete actually talks ("drop the warmup from my strength workout,"
no id stated) would very likely hit the same starvation bug.

**Proposed fix (not applied - real source change, needs an owner):** extend `requestCoachReply`'s
`extraContext` build to also call `activeTemplatesContext`/`activeWeekSessionsContext`, sourced the
same way `activitySyncTurn.ts` already does it - the plumbing exists in two other places
(`validTemplateIdsFromManifest`'s lazy-fetch discipline, `activeWeekSessionsContext` itself), it's
just never invoked before `askGemini()` runs on this path (currently only fetched *after* the reply,
purely to validate whatever the model already guessed). This is a build-before-ask ordering fix, not
new capability.

**This predates this whole OpenRouter stack and this whole K1 pass** - it's not a regression from
anything tested in this doc, it's a real gap this retest happened to be the first thing thorough
enough to surface. Given the user's goal is "everything works perfectly, no errors" before merging,
this is the single biggest open item from this whole retest.

## Finding B (P1, needs disambiguation vs direct Gemini) — `template_edit` may be effectively unreachable in live conversation

Found on `coach-skanda`. Across 6 honest, varied live attempts (real template id and fake, implicit
request and an explicit "just do it" command, benign edit and a safety-adjacent one) the model
**never once emitted a `template_edit` action field** - not even when the athlete named a real,
valid template id directly. It consistently replied with some version of "I don't touch base
templates" - once redirecting into `injury_event` on an already-flagged issue instead of touching
the template at all.

`coachPromptText.ts`'s own template_edit instruction is unconditional ("If the athlete asked to
PERMANENTLY change one of their own existing workout templates, set template_edit...") - nothing in
it says decline or prefer a session-level edit instead. The likely source, from reading
`platform/soul/B_engine.md` (composed into both SOUL builds): repeated framing around "always start
from the base template... no structural deviations," written for *session*-level prescriptions, but
apparently bleeding into the model's judgment about *template_edit* itself - it seems to have
internalized "templates are sacred" as a blanket policy even though `template_edit` exists
specifically for the one case that framing doesn't cover (a deliberate, permanent, athlete-requested
change).

**Not disambiguated: is this OpenRouter/`google/gemini-3.8-flash`-specific, or would it reproduce on
direct Gemini too?** Not tested against direct Gemini in this pass (would mean extra live calls
outside this task's scope) - this needs a maintainer to check before treating it as either "an
OpenRouter regression to fix before flipping providers" or "a pre-existing prompt gap this retest
happened to be the first thing to surface live" (same blind spot as the `plan_edit`/
`session_reconcile` finding above - the fixture eval harness mocks the network call, so it's never
actually tested whether a real model complies with the template_edit instruction).

**Consequence for the #27 regression proof specifically:** the actual fix (pre-validate template_id
before building the write) is confirmed correct at the code level - `validateTemplateEdit()` read
in full, and the existing mocked-LLM test
(`fullTurnPipeline.test.ts -t "hallucinated template_id and session_id"`) passes, proving a bad
template_id drops cleanly while a real co-occurring fact still commits. But this could not be
independently **live**-reproduced for template_edit specifically, on either a real or fake id,
because the live model won't attempt template_edit at all right now. The backend fix is sound; the
feature it protects may not be reachable in practice today. Worth checking whether this makes
`template_edit` effectively dead code as shipped, separate from anything this stack touched.

## THE HEADLINE RESULT — 0/3 crashes on the exact field-crowding scenario that used to crash 4/5 times (the #27 fix, confirmed)

Found on `coach-skanda-testing`, the most important result in this whole retest. 3 fresh FSP
conversations, each crowding a real goal (`season_start`), 2 injuries (`injury_flag`), and 2 habits
(`new_habits`) into one dense message - the identical shape Agent D's original investigation found
crashing the whole atomic commit 4/5 times (hallucinated `template_edit.template_id`).

**0/3 crashed.** 2/3 (runs 2, 3) captured every fact correctly with nothing dropped - goal, both
injuries, both habits, all landed clean in `seasons.json`/`quests.json`/`injuries.json`. 1/3 (run 1)
had a partial silent omission (goal and both habits never proposed, though both injuries landed
correctly) - not a crash, not a `droppedActions` entry, just the model not proposing those fields
this particular time. No `template_edit` or any other hallucinated field appeared in any of the 3
runs at all - the original crash trigger simply didn't fire this time around.

**This confirms the fix holds under the exact real-world load that originally broke it.** The
partial-omission case in run 1 is a different, milder failure mode (see Finding 2 below, tied to
first-message timing, not field crowding) - not the crash this fix targets.

Also on `coach-skanda-testing`: template generation at onboarding (PR #921's own new scope,
`adjustTemplatesWithGemini` via `selectLlmAdapter`) worked cleanly through OpenRouter - 6 real
templates generated and committed with real, personalized `coaching_note` content, confirmed the
call goes through the provider-neutral seam rather than a hardcoded path.

## Finding C (P1) — OpenRouter has no retry on truncation; ~37% of first-turn calls failed outright in this pass

Found on `coach-skanda-testing`. The athlete's very first *ordinary* turn hit `OpenRouter truncated
its response before finishing (finish=length...)` 3 times out of 8 such calls - always on a short,
simple opening message. A 4th call didn't truncate but produced a ~900-word reply that degenerates
into the same sentence repeated dozens of times - the same underlying failure (the model burning its
output budget in a repetition loop) manifesting two ways: sometimes it exceeds the token budget and
gets cut off (throws), sometimes it stays just under budget and ships garbage text as a "successful"
reply.

**Root cause:** `openRouterAdapter.ts` throws immediately with `status: 502` on `finish_reason ===
"length"` - no retry. Compare `geminiAdapter.ts`, which has an explicit one-retry policy for
transient failures (400/503/504) - and since coach-chat's `askGemini` always sends a `cachePrefix`,
that retry is live in production on the Gemini path today. OpenRouter has no equivalent for its
own truncation case at all: one bad generation and the athlete sees a plain error and has to resend.

**Athlete-facing impact:** ~37% (3/8) of first-ordinary-turn calls through OpenRouter failed
outright in this pass and needed a resend. That's a real, noticeable failure rate if OpenRouter
becomes more than a manual-test path - **this needs fixing before any M3 cutover consideration**,
not just noted.

**Proposed fix (not applied):** give `openRouterAdapter.ts`'s `finish_reason === "length"` branch
the same one-retry treatment `geminiAdapter.ts` already gives its own transient cases - narrow,
scoped change, existing precedent in the same directory (`_lib/llmAdapters/`).

## Finding D — UPGRADED TO P0/P1, WORSE THAN ORIGINALLY MEASURED, NOT WHAT IT LOOKED LIKE

**A deep-dive investigation (Sep 9, later pass) found this is far more severe and fundamentally
different from the original characterization below.** Read this box first, the original writeup
below it is now superseded in every particular except as investigation history.

With real instrumentation (actual prompt sent + actual raw model JSON + OpenRouter's own
reasoning/usage numbers, not inference), 24 live calls across 13 fresh `coach-skanda-testing`
branches:

- **Baseline, dense message as turn 1 (n=8 valid completions): 7/8 dropped everything except
  `profile_update.name`.** `season_start`, `injury_flag`, `sports_update` all missing. **0/8 full
  success**, not the ~50% originally reported.
- **Turn-2 control (the same dense message restated after one trivial turn, real history present):
  still dropped everything but the name.** This directly contradicts the original finding's central
  claim that restating on turn 2 "fires correctly every time" - **this is not turn-1-specific at
  all**, at least not in this larger sample. The original ~50%/"probabilistic, turn-1-only" read was
  likely an artifact of a too-small sample (the original pass's n was much smaller).
- **Reasoning-effort hypothesis (the leading theory going into this investigation): ruled out with
  data.** `reasoning_tokens` was 0 on every low-effort run, including the one partial success.
  Raising effort to `medium` (587-1327 real reasoning tokens spent, confirmed via OpenRouter's own
  usage payload) still produced total omission 2/2, and added a 3rd truncation crash - confirming
  the Finding C tradeoff with real numbers: raising effort doesn't help this and measurably hurts
  Finding C.
- **Token-budget/declaration-order theory: ruled out.** The schema declares `season_start`/
  `injury_flag` before `profile_update`, yet the later-declared field is what survives while the
  earlier ones vanish - and completion stayed at 250-470 of a 4096 budget with a clean `finish_reason:
  "stop"`, nowhere near exhausted.
- **The one test that would settle "OpenRouter-specific vs. a real, general model/prompt problem" -
  a direct-Gemini comparison - could not run.** `GEMINI_API_KEY` is billing-exhausted, confirmed via
  `RESOURCE_EXHAUSTED` on all 3 attempts. This is now the single blocking question.

**What this actually looks like now: a severe, general structured-output-omission problem with
`google/gemini-3.8-flash` via OpenRouter under `strict: true` JSON schema mode** - not confined to
turn 1, not moved by prompt wording, not moved by reasoning effort. In the worst-measured case
(baseline), a real athlete's structured facts survive intact only ~12% of the time on a
fact-dense message. This is meaningfully worse than every other finding in this document and needs
its own decision, not a quiet P2 label.

**Options going forward, none implemented:**
1. Refill `GEMINI_API_KEY` credits and run the direct comparison - the fastest way to know if this
   is an OpenRouter routing/model-alias problem (worth reporting to OpenRouter/checking if the
   underlying model behind the alias drifted) versus something that would also hit production
   Gemini today.
2. A reprompt safety net, same shape as Finding E's proposal: detect when `reply`/`coach_note`
   narrates facts the structured fields didn't actually capture, and force a corrective second call
   before committing - since neither prompt wording nor reasoning effort moved this at all, a
   structural catch may be the only lever left short of a model/provider change.
3. Given the severity, reconsider whether `LLM_PROVIDER=openrouter` should be treated as
   production-viable at all right now, independent of Finding C's fix - this finding alone suggests
   real athlete data could be silently lost on any fact-dense message, not just a first one.

---

### Original finding (superseded above, kept for investigation history)

**Found on `coach-skanda-testing` (original retest pass)** - see the corrected numbers above before
acting on anything in this section.

Found on `coach-skanda-testing`, observed 4 times across the pass, always specifically on the turn
immediately after `greet` (before any `profile_update` has ever committed): stated brand-new
injuries or a stated goal+habits simply don't get proposed at all - not dropped via
`droppedActions`, just never in the model's response - while `profile_update` for whatever identity
info was also in the message lands fine. Every one of these same facts fired correctly once
restated (or originally stated) as the conversation's *second* ordinary turn, after some
`profile_update` had already landed. Base rate observed: 1 silent drop + 3 full misses out of ~8
first-message attempts - probabilistic, not universal (2 of the 3 field-crowding runs above, same
message density, on a first message, captured everything fine).

Not the #808 shape (that was specifically the habit sub-field dropping when paired with a goal;
this is the whole structure sometimes going missing on message 1 specifically). Not permanent data
loss - the coach re-asks and eventually captures it on a later turn. May be OpenRouter-specific
(untested against direct Gemini in this pass) or a genuine SOUL-prompt gap (no explicit instruction
found that facts should commit on the turn stated regardless of turn number). **REC: a quick
live-Gemini comparison of the same "dense first message" shape before deciding if this needs a
prompt fix or is provider-specific.**

**Status: attempted, did not fix, remains open.** A follow-up pass added an explicit
`coachPromptText.ts` instruction ("this applies on message 1 too, don't wait for a later turn"),
then a stronger version, and live-verified on 3 fresh `coach-skanda-testing` scratch branches with
the same dense-first-message shape as the original test. All 3 failed identically both before and
after the change - only `profile_update` (name) landed; `season_start`, both `injury_flag`s, and
both habits were never proposed, despite the reply claiming they were "locked in." 3/3 failing with
the fix in place is the same or worse than the original's probabilistic base rate, so the attempt
is reported as a genuine non-fix rather than forced through. Left open - needs either a live-Gemini
comparison (per the original REC) or a different angle than a prompt instruction addition, which
this pass showed doesn't move the needle on its own.

## Finding E (P2, needs a decision) — `quest_event` has no reprompt safety net if the model just skips it

Found on `coach-skanda`, 3 honest live attempts logging a real habit-quest completion
("cold shower... keeping that streak going" / "mark it complete"). Every attempt correctly fired
`coach_note` describing the completion in prose, but `quest_event` itself never landed - `quests.json`
was untouched all 3 times, and this is not a validation drop (`droppedActions` was empty, no "bad
reference" log line) - the field was simply never in the model's JSON response.

`coach-note-required-with-quest-event`'s own transcript description already acknowledges Gemini
doesn't reliably comply single-shot for the *coach_note* half, and that production relies on
`coachTurn.ts`'s `ACTIONS_REQUIRING_COACH_NOTE` reprompt to fix that specific direction (missing
coach_note when another action fired). There is **no equivalent reprompt for the reverse case** -
athlete clearly describes completing a quest, but `quest_event` doesn't fire at all. Nothing catches
this today; the athlete's real progress silently doesn't get logged, with no error, no dropped-action
note, nothing - just a coach_note that describes what they said with no lasting effect on their
actual quest ledger. Needs a decision: is this accepted as noise the same way #670 was, or does
`coachTurn.ts` need a matching reprompt for "an action was clearly described but nothing fired"?

## Fixes proposed but not applied (needs a decision)

**A dropped action's `reply` text can tell the athlete something false, for one turn.** Confirmed
live on `coach-akash`: a turn resolved a real injury AND hallucinated a `session_reconcile` id.
The hallucinated id correctly got dropped by `validateSessionReconcile` (this fix works exactly as
designed - `current_week.json` untouched, the real injury update landed, no crash). But the
model's own `reply` text, already generated by the time validation runs, said *"sess_20260905_1 is
marked done"* - false. Root cause (`coachTurn.ts:711-730`): `formatDroppedActionsNote` only folds
the correction into `coach_log.json` for the *next* turn's context, by design (comment: "fold it
into the next turn's context... instead of the athlete finding out never"). So the promise is
"finds out eventually," not "isn't told something false right now." Not a regression from the #27
fix - a pre-existing gap this test surfaced concretely for the first time. **P2, product call, not
fixed here.** Two directions if wanted: (a) cheapest - also append the dropped-action note to the
*reply* sent this turn, not just `coach_note`; (b) strip/rewrite reply sentences referencing a
dropped action before sending - more fragile (string surgery on model prose), avoids a second model
call.

**Weaker-than-intended test coverage on `coach-akash` for two scenarios, not a bug - a real-data
limitation.** `injury-event-array` and `injury-event-real-id-among-several` both want multiple
*active* sibling injury flags to properly exercise array-collapse/sibling-id-picking; akash's real
`injuries.json` only has one active flag (two others are resolved). Both scenarios still passed on
what they could test, but neither is as strong a proof as the original fixture. If stronger proof
is wanted: either a second athlete repo with multiple active flags, or a throwaway scratch-branch
edit seeding two active flags before testing (never touching the athlete's real data).

**`injury_flag` has no deduplication - a re-stated injury on a filler turn creates a real duplicate
entry in `injuries.json`.** Found in the fixture eval suite (Track A, `incremental-injury-disclosure
[3/3]`), not hypothetical - this is a genuine "would happen on a real commit" bug.

The conversation: turn 2 discloses a new hip injury, model correctly fires `injury_flag` + a
`coach_note` describing it - matches the fixture's expectation exactly. Turn 3 is pure filler
("Anyway, that's the update. Heading out now.") with zero new information. The model re-fired
`injury_flag` again for the *same* injury (near-identical text: "Left hip soreness persisting for
3 days" vs turn 2's "Left hip soreness for the past 3 days, noticed during runs.") plus a
near-duplicate `coach_note`.

Checked `applyInjuryFlag` (`ui/api/coach-chat/_lib/decide/coachIntents.ts:168-194`): it has **no
deduplication whatsoever**. Every `injury_flag` entry unconditionally appends a new flag with a
freshly minted id (`inj_<date>_<slug>`). If this exact turn had landed on a real athlete repo, it
would have created two separate "active" injury flags for the same real injury, same day - the
athlete would see it logged twice, and any later `injury_event` referencing it by `flag_id` would
only ever update one of the two duplicates.

This is the same *shape* of problem the K1 pass already found and partially mitigated for
`season_start`/`week_plan`/`template_edit` firing unprompted ("Finding 4" - a restraint instruction
in `coachPromptText.ts`'s returning branch telling the model not to invent fields with no real
reason). `injury_flag` on a pure filler turn is arguably the same class of "the model isn't
checking whether this was already established" - but the existing Finding 4 mitigation is scoped to
different fields and doesn't cover this. K1's fixture correctly flags the `coach_note` half of this
(`actionFieldsAbsent: ["coach_note"]` on turn 3) but the fixture's `expect` block doesn't check for
`injury_flag` at all on turn 3 - so even with a perfect prompt fix, this exact fixture wouldn't
catch the duplicate-flag half of the bug unless the fixture itself gets a matching
`actionFieldsAbsent: ["injury_flag"]` assertion added.

**Proposed fix (not applied - needs a decision, this is model-prompt-shaped, not a pure code fix
like the #27/season_start ones):**
1. Add `injury_flag` to the restraint instruction's scope alongside `season_start`/`week_plan`/
   `template_edit` in `coachPromptText.ts` - "don't restate a fact this conversation already
   established."
2. Belt-and-suspenders, cheaper to build and would have caught this regardless of prompt quality:
   `applyInjuryFlag` could dedupe against existing *active* flags with near-identical text before
   minting a new id (same spirit as `validateActions.ts`'s pre-write validation layer, though this
   isn't a bad-reference case - it's a bad-but-well-formed one, so it doesn't fit the
   `DroppedAction` pattern directly; would need its own shape).
3. Add `actionFieldsAbsent: ["injury_flag"]` to transcript 25's turn 3 `expect` block regardless of
   which fix above lands, so this specific regression has real eval coverage going forward.

Not fixed in this pass - flagging for a decision on which of 1/2/3 (or all three) to do.

## Minor observations, pre-existing, out of scope for this pass

- `applyInjuryFlag`/`applyInjuryEvent` write `injuries.json` as `{ flags }` only - no `version`/
  `_meta` wrapper, unlike every other file this app writes. Seen on 3 separate real diffs during
  the akash retest. Not investigated further, not filed as a bug - just a pointer in case it's an
  oversight.
- `memory.json` writes always materialize a `"coaching_style": null` key on any write, even ones
  that don't touch coaching style - a schema-normalization side effect (confirmed by reading
  `memoryWrite.ts`), not a bug, just worth knowing so it's not mistaken for a coaching-style reset
  later.

## Test-infrastructure gaps noticed

**The exact systemic risk flagged during K1's own testing pass already bit again, within days.**
K1's LLD explicitly warned: *"any eval transcript with a hardcoded date will rot the same way and
misreport a live regression that isn't real - no freshness check exists today."* Transcript 19
(`plan-edit-vs-template-edit-disambiguation`) hardcodes a session date of `2026-09-05` in its
`extraContext`; today is `2026-09-09`, so "tomorrow" (2026-09-10) no longer matches any session in
context, and the model correctly declined to fire `plan_edit` - which the fixture reads as FAIL.
This is the *identical* bug shape as #807 (which hit this *same transcript* on 2026-08-19, was
fixed, and the fixture's own description text literally warns "Keep this date fresh going forward
- a session-context transcript this specific will go stale again"). It went stale again in under
five weeks. This is not a one-off - it's a predictable, recurring failure mode with zero automated
protection. A transcript-freshness check (e.g. a CI step that fails if any transcript's embedded
date is more than N days old, or better, dates expressed relative to "today" at eval-run time
rather than hardcoded absolute dates) would have caught this before it ever produced a false
regression signal. Worth raising as its own fix, not specific to OpenRouter.

**The manual harness has no way to test `activity_sync` mode at all.** `requestCoachReply`/
`coachTurn.ts`'s ordinary path is hardcoded to `mode: "ordinary"` for every `--message`/`--turns`
call. `mode: "activity_sync"` is only reachable through `commit/activitySyncTurn.ts`, which the
manual harness never calls - there's no `--activity-sync` flag or equivalent. If activity-sync ever
needs a live retest like this one, the harness needs a new entry point mirroring
`run-manual-coach-chat-test.ts` for that specific path.

**Orphaned template files on disk make hallucinated-id bugs easier to trigger by accident.**
`coach-prateek`'s `user_data/activities/workout_plans/templates/` has `strength_a.json` and
`foundation.json` sitting on disk but NOT listed in `_manifest.json`. Not a bug on its own (caught
safely by validation either way), but it means a hallucinated id like `strength_a` "looks" more
plausible than a pure invention would, since a file with that name genuinely exists just outside
the manifest that defines what's valid.

**Testing session/plan-referencing scenarios on a real but onboarding-incomplete athlete costs
several throwaway turns before the real scenario can even start.** `coach-prateek`'s real
`current_week.json` was still the empty `skeleton-init` placeholder despite being a real returning
athlete, and First Session gating required two full rounds of clarifying questions (training
days/style, then injury/DOB) before `week_plan` would even fire - meaning 3 extra live API turns
and 3 extra real commits just to reach a state where the actual scenarios under test had real
session ids to reference at all.

**No `pretest`-equivalent hook for the manual harness - first run fails with `ERR_MODULE_NOT_FOUND`
until you manually build SOUL.** `npm run test:coach-chat-manual` needs `ui/api/_generated/soul.ts`,
which doesn't exist in a fresh worktree - `npm test`'s own `pretest` script builds it automatically,
but `test:coach-chat-manual` isn't named `test` so npm doesn't run that hook for it. Requires
manually running `node scripts/build-soul.mjs` (or `compose-soul.mjs` then `build-soul.mjs`) first.
One-time cost per worktree (this shared worktree only needed it once, other concurrent agents were
unaffected once the first agent hit and fixed it), but easy to forget and wastes a first real API
call finding out. Worth a `pretest:coach-chat-manual` script or a self-check in the harness itself.

**No way to inspect the raw assembled prompt sent to the model without editing source.** Both major
findings above (`template_edit` refusal, `quest_event` silent skip) would have been much faster to
root-cause with a `--debug`/`DEBUG=1` flag on `run-manual-coach-chat-test.ts` that dumps the full
assembled prompt text, not just the parsed JSON reply. Top suggested addition to the harness.

**The manual harness always requires `GEMINI_API_KEY` even for a pure OpenRouter run.** Its startup
check reads `process.env.GEMINI_API_KEY` unconditionally regardless of `LLM_PROVIDER`. Harmless
when both keys are already set (as they were here), but worth knowing if a future run only has
`OPENROUTER_API_KEY` configured.

**Resetting an athlete repo to genuinely-blank FSP state for testing is fully manual, no tooling
exists for it.** `coach-skanda-testing`'s `main` already had a completed onboarding from a prior
session, so every fresh-FSP scenario in this pass needed its own reset-and-push step
(profile/memory/injuries/seasons/quests files reset to `carve-skeleton.mjs`'s blank templates)
before the harness could run against it. A small one-off script was written for this session only
(not committed, scratch-only) - worth turning into a real, reusable "reset this athlete repo's
scratch branch to blank FSP state" script if fresh-FSP live testing happens again.

**A misleading counter name in the harness's own turn-committed log line.** `[coach-chat] turn
committed ... droppedFacts:0` reads like "nothing was dropped this turn," but `droppedFacts` only
counts `commitFailureDrops` (late GitHub write failures) - a different, narrower thing than
`droppedActions` (bad quest/injury/session/template ids caught by pre-write validation, which is
what this whole fix is about). The real drop is logged one line earlier as `[coach-chat] dropped a
structured-fact action - bad reference: {...}` and is easy to scroll past. Worth a rename or a
combined summary line.

**`--message` mode silently starts a new thread every process invocation - `--turns` is required
for real multi-turn continuity, easy to miss.** Running the same `--branch` twice with two separate
`--message` calls does not continue one conversation (each mints a fresh synthetic `t-${Date.now()}`
threadId) - it silently starts two separate threads on the same branch. This is documented in the
script's header comment but easy to miss on a skim; one tester initially ran a 3-turn scenario as
three separate `--message` calls before catching this.

**Writing a regression fixture for "hallucinated id" bugs needs a *plausible* fake id, not an
obviously fake one.** An id like `session_xyz_made_up` gets self-censored by the model before it
ever emits the action field at all, so it never reaches the validator under test. A plausible id in
the real format (`sess_YYYYMMDD_N`, a real date) that just doesn't match the real session for that
date is what actually triggers the hallucination and exercises the code path. Worth documenting for
anyone writing future regression transcripts for this bug class.

**A single missed GitHub API poll right after branch creation gives the manual harness a false
"ERROR" it can't tell apart from a real failure.** `run-manual-coach-chat-test.ts`'s `getHeadSha`
throws on any non-2xx with no retry; called once before and once after each turn to compute a
diff. On `coach-date2022`'s `test/retest-regress-a` run this threw once (likely a transient
rate-limit or ref-consistency race - 6 agents were sharing one GitHub token running this same
script concurrently at the time), and the harness reported the turn as `ERROR` even though the
underlying commit landed perfectly (independently confirmed via `git diff`). One retry before
giving up would fix this - it's a known-shape race (branch just created, ref API briefly
inconsistent), not a real inability to read the branch.

**The manual harness's run log has no repo/athlete tag in its filename**, only a timestamp
(`manual-coach-chat-log-<HH-MM-SS>.json`), and it's written under the *coach-hq checkout's* own
`tests/<date>/manual/` directory, not the athlete repo being tested (the header comment's
"`<repo-root>/tests/...`" means the coach-hq monorepo, not the athlete repo - non-obvious).
With 6 agents running the same script concurrently against 6 different athlete repos sharing one
coach-hq checkout, this directory filled up with interleaved logs from every agent at once,
matchable only by timestamp. A repo slug in the filename would make this trivially easier to
filter when testing runs in parallel like this.

**Could not reproduce the `new_habits`-omitted case live, across 5 tries.** The whole point of the
P0 fix (`input.new_habits ?? []`) is defense against Gemini/the model dropping a schema-required
field - documented as a real, observed historical behavior, not theoretical. Across 5 separate
`season_start`-triggering turns on `coach-date2022` (OpenRouter, `google/gemini-3.8-flash`), the
model *always* included `new_habits` in its output, either populated or as an explicit empty
array - never omitted the key outright. So the actual crash-guard branch (`input.new_habits` being
`undefined`, not just empty) was never live-exercised in this pass. The fix doesn't regress the
happy path (confirmed, 5/5 clean), but "doesn't reproduce the failure live in 5 tries" is not the
same as "proven fixed under the real failure condition" - the only way to get a deterministic proof
would be a unit test that mocks a reply with `new_habits` truly absent (worth checking whether
`coachIntents.test.ts` already covers this exact case - not checked in this pass, scoped to live
conversation only).

**Resolved (checked by Tech Lead, not the date2022 agent):** yes, `coachIntents.test.ts:1001` already
has exactly this case - `"does not throw when new_habits is absent from the reply, despite being
required in the schema"` - added as part of the original P0 fix itself. So the crash-guard has
deterministic unit coverage even though 5 live tries never triggered the real omission. Combined:
happy-path proven live (5/5), crash-guard proven deterministically (unit test) - the live-repro gap
is expected and acceptable, not a real coverage hole.

---

## MERGE READINESS — what's left before this stack merges (as of this check)

Compiled while the Finding D Gemini-flash comparison runs, so it's ready to read regardless of
when that finishes. Covers the whole 22-PR chain (`769`→...→`824`→`917`→`920`→`921`) plus the two
newer PRs stacked on top of it (`#948` - the 7 retest fixes, and whatever Finding D's fix becomes).

### 1. Finding D - the one thing that could still change the picture

In progress. A Gemini-flash comparison (matching OpenRouter's own test methodology exactly) is
running now, redirected mid-flight to use `gemini-flash-latest` specifically (not the
production-pinned `gemini-pro-latest`) for a fair comparison against OpenRouter's `google/gemini-
3.8-flash` results. Until this lands, the honest state is: **PR #921's tip may have a severe,
provider-general structured-output-omission problem on fact-dense messages, and we don't yet know
if this is new, pre-existing, or OpenRouter-specific.** Do not merge anything touching coach-chat's
model-calling path until this resolves - see the finding's own section above for the 0/8-success
numbers that triggered this.

### 2. Live re-verification gaps on the already-fixed findings

PR #948's own body says this plainly: findings A (`plan_edit`/`session_reconcile` context
starvation) and C (OpenRouter truncation retry) were fixed and unit-verified, but **not re-run
through the original live real-repo scenario that found them** - only B and E got that treatment.
Before calling this stack done, worth a live confirmation pass on A and C specifically (a
`plan_edit`/`session_reconcile` request with no explicit id from the athlete, and enough truncation-
prone first-turn calls to check the retry actually helps the ~37% rate).

### 3. Doc upkeep still owed

- **K1's own LLD** (`docs/plans/ccr-k1-final-test-pass-lld.md`) still has not been updated with any
  of today's work - not the #27 crash-not-drop reframing, not the OpenRouter retest, not the 7
  fixes, not Finding D. Its own "Done when" rule requires every item to have real evidence attached
  before K1 can honestly close - this doc (the one you're reading) and its sibling results doc are
  that evidence, but nothing links them from K1's LLD yet.
- **M2's LLD** (`docs/plans/openrouter-m2-chat-lld.md`) execution table is still stale (says "not
  started" for PRs that are done) - flagged early in this session, still not fixed, still low
  priority per your own "leave M2 for now" instruction from earlier.
- **Plan-file deletion** - correctly not done yet (K1 hasn't merged), but worth remembering this is
  the PR that has to delete every `docs/plans/ccr-*-lld.md` plus the `chat-commit-redesign.md`
  umbrella doc when it finally does, per `AGENTS.md`'s plan-delete-on-last-PR rule.

### 4. F1 (athlete repo migration/backfill) - still the hard production blocker

Unchanged from earlier in this session: K1's own LLD calls this a **hard blocker before this ships
to any real athlete** - merging to `main` triggers an immediate production Vercel deploy (confirmed
via `vercel.json`'s `ignoreCommand`), and shipping without F1's `coaching_style` backfill would
reset every existing real athlete's onboarding on their next message. Not started. Independent of
Finding D - this blocks safe deployment regardless of what Finding D resolves to.

### 5. M3 (flipping `LLM_PROVIDER=openrouter` in production) - not started, now higher-risk

Was already "not started" before today. Given Finding D's severity, M3 should not proceed at all
until Finding D has a real resolution (fixed, or confirmed OpenRouter-specific and therefore a
reason to NOT flip providers). This was already true in spirit (M2's own LLD says "flipping to
openrouter... gated on #670's live baseline") but Finding D makes it concrete: a live baseline
comparison is now literally in progress for exactly this reason.

### 6. Real-repo scratch branch cleanup

157 local-only `test/`/`retest/` scratch branches have accumulated across the 6 real athlete repos
today (`coach-skanda`: 64, `coach-skanda-testing`: 42, `coach-akash`: 25, `coach-shreyas`: 13,
`coach-date2022`: 11, `coach-prateek`: 2) from this session's testing plus the earlier K1 #27
investigation. None touch any athlete's real `main`, none are PRs - purely local-only clutter on 6
real people's real GitHub repos. Not urgent, but worth a cleanup pass once the investigation phase
is fully done (don't delete mid-investigation - some findings' evidence lives only on these
branches).

### 7. What's fully done and doesn't need more testing

- The #27 fix (hallucinated template_id/session_id no longer crashes the whole atomic commit) -
  confirmed live under the exact real-world field-crowding load that originally broke it, 0/3
  crashes, both on the original Gemini pass and again on the OpenRouter retest.
- The `new_habits` P0 guard - happy path live-confirmed, crash-guard unit-tested deterministically.
- Findings B and E - fixed AND live-re-verified against real repos post-fix.
- The whole 22-PR + 1 (`#948`) chain is rebased onto current `main`, green CI, mergeable - the git
  mechanics are not blocking anything; only the open findings above are.

---

## CLOSING SUMMARY

The reason this retest was run: verify PR #921's tip (the full 22-PR rebased stack) works via
OpenRouter, since it just gained a provider-neutral seam and direct Gemini credits were exhausted.
Bottom line: **the specific bug this whole redesign chased (#27 - hallucinated ids crashing the
whole atomic commit) is confirmed fixed, live, under the exact real-world load that originally broke
it.** That's a real, load-bearing result. Along the way this pass also surfaced several things that
were true before this stack existed and nobody had caught yet, because nothing this thorough had
been run against real repos and a real model before.

### Priority-ordered action list — UPDATED after the fix pass on `fix/openrouter-retest-findings`

**Fixed and live-verified this pass:**
1. **Finding A** - `requestCoachReply` now supplies real template/session context before asking the
   model. `plan_edit`/`session_reconcile`/`template_edit` should no longer silently no-op while the
   reply claims success. (Unit-verified via mocked prompt-content assertions; not yet re-run through
   the full live real-repo scenario that originally found it - worth one live confirmation pass.)
2. **Finding C** - OpenRouter retries once on truncation now. Unit-verified (mock truncate-then-succeed
   and mock double-truncate-then-fail). Not yet re-measured live for the ~37% failure rate dropping.
3. **Finding B** - `template_edit` refusal fixed at the root (SOUL guardrail scope). **Live-verified**
   on `coach-akash`: fired and committed for real, where the original test saw a 100% refusal rate
   (0/6).
4. **Finding E** - `quest_event`'s instruction strengthened. **Live-verified** 3/3 on `coach-skanda`,
   real `progress.json` writes confirmed via diff.
5. The `injury_flag` dedup gap - code-level guard added plus a matching restraint instruction and
   fixture assertion. Unit-verified, not live-re-run.
6. The akash-observed reply-honesty gap - dropped-action corrections now reach the same turn's
   reply, not just next turn's context. Unit-verified, not live-re-run.
7. The eval-transcript date-rot risk - transcript 19 now resolves its date at run time instead of
   staying hardcoded. Can't rot the same way again.

**Still open, not fixed:**
8. **Finding D** - structured facts silently deferred on an athlete's literal first message. A
   genuine, live-verified fix attempt was made (prompt instruction addition) and it made no
   measurable difference (3/3 failed identically before and after). Needs either a live-Gemini
   comparison run (per the original REC - is this provider-specific?) or a different angle than a
   prompt instruction, which this pass showed isn't sufficient on its own.

**Not blockers, confirmed working (unchanged from the original retest):**
- The #27 fix itself (id-hallucination pre-validation) - confirmed live under real load.
- The `new_habits` P0 guard - happy path confirmed live, crash-guard confirmed by existing unit test.
- Template generation at onboarding through the new OpenRouter seam (PR #921's own scope).
- coach-message's seam (inferred correct from source, not independently live-tested - no harness
  exists for it).

**Test-infra gaps (item 9 from the original list) not addressed this pass** - still open, lower
priority, logged above with specifics.

7 of 8 findings fixed and pushed on `fix/openrouter-retest-findings` (stacked on PR #921), full
check gate green (9/9) after every commit. Finding D remains open and is not silently dropped -
it's the one thing from the original "fix all" ask that a genuine attempt could not resolve.

(agent findings appended below - this section marks the end of the live investigation)
