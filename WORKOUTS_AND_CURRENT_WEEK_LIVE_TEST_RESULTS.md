# Live test results: Workouts redesign + Current Week

**Date:** 2026-09-12
**Method:** real conversations through `ui/scripts/run-manual-coach-chat-test.ts`, `LLM_PROVIDER=openrouter`, against a real athlete repo (`skanda-2003/coach-skanda-2003`), each on its own disposable `test/*` scratch branch. Never touched `main`. Code under test: the full fixed `#727` PR stack (`#983`-`#993`), plus this doc's own fixes, which all live on `core/727-live-test-fixes` (PR #995, stacked on `#993`).

Every finding below is something that actually happened in a real model call and a real commit (or failure to commit) — not a code-reading guess. Where I re-ran a scenario after a fix, I say so and give the result.

**Bottom line:** two full rounds of live testing. Round 1 covered workouts create/delete/edit/FSP. Round 2 added Current Week's patch-mode paths (move/mark-done/skip/unplanned) plus a create+remove-in-one-turn check, and chased down the one risk Round 1 left open. **7 real bugs found, 7 fixed**, all on PR #995, all tested, all green. Two things remain genuine OpenRouter/model reliability, not backend bugs — see "Model reliability, not fixed in code" at the end.

---

## Workouts: scenario results

### 1. Create a workout (`workout_create`)

**Ran 5 times** (different phrasing, different equipment, different injury framing). **3 succeeded, 2 failed the same way.**

- **Result A (success):** "Can you build me a quick upper body workout? I only have dumbbells at home today, no gym." → Coach wrote a real routine (`upper_body_dumbbell_strength.json`), acknowledged all 3 of the athlete's active injury flags (elbow, knee, back), committed the file + manifest.
- **Result B (failure, reproduced twice):** same kind of ask → Gemini/OpenRouter returned a `workout_create` where one exercise's `reps` field was missing entirely (`type: "reps"` but no `reps` key). `validateWorkout` correctly refused to commit it (**this is working as designed** — never commit invalid data). But two real problems sat behind that correct refusal:
  1. Coach's own reply text still confidently described the "saved" workout in full detail — the athlete would have no idea nothing was actually written, if the correction note weren't accurate (see Bug #3).
  2. The one time I made the schema error message include the actual bad value, it said `got undefined` — confirming the model simply omitted the field, not that it sent a wrongly-typed value.
- **Result C (once, no schema error at all):** the model answered entirely in prose, no `workout_create` field, no error. This is a plain reliability miss, not a backend bug — nothing to catch or drop, the model just didn't use the tool that turn.

**Classification:** the missing-`reps` case and the tool-not-invoked case are **OpenRouter/model reliability**, not backend bugs — the schema already marks `reps`/`duration_secs` as required-shaped fields, but Gemini's structured-output mode (further loosened over OpenRouter specifically) has no way to make a field conditionally required only when `type: "reps"`, a known, already-documented limitation elsewhere in this codebase. The backend correctly refuses the bad data either way. What I found and fixed was the **athlete-facing consequence** of that miss (Bug #3, below).

### 2. Delete a workout (`workout_remove`)

**Ran twice. First attempt failed outright — a real backend bug, since fixed and reverified.**

- **First attempt:** created a routine, then asked "can you remove it from my workouts page?" Coach's reply: *"I pulled Upper Body Dumbbell Focus right off your workouts page. It's gone."* **This was false.** No `workout_remove` field was ever emitted. The file and its manifest entry were both still there afterward, confirmed directly against the repo.
- **Root cause (Bug #1, below):** the context block listing an athlete's real routine ids literally said *"use these exact template_ids for **template_edit**"* — written before `workout_remove` (or `session_plan`) existed, never updated. The real ids were in context; nothing told the model they applied to a removal request.
- **After the fix, reran the identical scenario:** Coach correctly emitted `workout_remove: { routine_id: 'upper_body_dumbbell_strength' }`, the file and manifest entry were both actually deleted, confirmed against the repo.
- **Bonus case, worked correctly both times:** asking to remove a workout that doesn't exist ("remove my 'leg day blast' workout... I don't think it exists") → Coach checked, replied honestly that it wasn't there, no hallucinated deletion, no error.

### 1b. Create + remove in the same turn (round 2)

Asked Coach to build a new core workout and remove an old unused template, both in one message. Coach only emitted `workout_remove` (correctly deleted the old template and its manifest entry, single clean manifest write) and skipped the create half entirely, no error, no explanation of the omission. **Model reliability** — nothing to catch or drop, the model chose to only act on half the request. The A2 manifest-merge fix (PR #995 round 1) is already unit-tested for the actual combined case (both actions succeeding together in one turn) — this run just didn't happen to exercise it, since the model didn't attempt both.

### 3. Edit a workout for a new injury (`template_edit` + `injury_flag`)

**Ran twice, both outcomes were reasonable, model behavior varied:**

- **Run A:** athlete reports new shoulder pain, asks Coach to edit the just-created workout. Coach correctly recorded a new `injury_flag` **and** called `template_edit` with `skip_phases` to remove the overhead-loading phase. Both committed correctly.
- **Run B (same prompt, different run):** Coach recorded the `injury_flag` but this time did **not** attempt `template_edit`, and said so honestly: *"the template editing tool only allows skipping existing exercises rather than rewriting movements... drop any overhead pressing... manually"* and asked a clarifying question instead.

**Classification:** both are acceptable — `template_edit`'s real capability actually is limited to skip-only, never a full rewrite (by design, since free-form template rewriting was previously removed for reliability reasons — see `coachWorkoutFiles.ts`'s own comment). Run B is the model being honest about that limit rather than forcing an imprecise edit. Non-deterministic, not a bug.

### 4. First Session Protocol — benchmark + first week

**Two real bugs found, both fixed, both reverified live.**

To test this at all, I had to actually complete a fresh intake conversation (name, dob, sports, coaching style, season goal) on a scratch branch seeded with a genuinely blank profile/memory/seasons (via `carve-skeleton.mjs`'s own placeholder output) — a real athlete never has an incomplete profile to test this path against.

- **Bug #4 (severe, found first):** on the very first attempt, using **skanda's own real, already-established repo** (profile complete for months), a completely ordinary conversation ("can you build me a workout?") silently wrote a synthetic benchmark routine and **overwrote `current_week.json` with a fabricated "first week"** — on an athlete who has had a real, live week for months. Root cause: my own earlier fix for a different bug (see Bug #5) had dropped the requirement that this only run on the literal moment a profile transitions from incomplete to complete; `profileComplete` is recomputed fresh every turn and stays `true` forever once real, so the check fired on every single turn. Fixed by restoring the transition requirement.
- **Bug #5 (the original bug this was meant to fix):** before Bug #4's fix, the gate checked "does `_manifest.json` exist at all" to decide whether First Session's benchmark had already run. Carve-skeleton now seeds a manifest with two starter templates at carve time (from `#727`'s own A4), so that check was always true for a freshly carved repo — meaning **no new athlete would ever get a benchmark or a first week, silently, forever.** Fixed by checking specifically for the benchmark's own routine id in the manifest, not "any manifest at all."
- **Bug #6 (found during the successful reverified run):** the benchmark picked a "Cable fly" (`equipment: ["full_gym"]`) for a fresh athlete who had never confirmed owning any equipment. Root cause: the picker sorted candidates by `equipment.length`, so a one-item `["full_gym"]` array tied a one-item `["bodyweight"]` array and could win alphabetically. Fixed with a real equipment-accessibility ranking (bodyweight lowest, full_gym highest).
- **After all three fixes, reran the full intake-to-benchmark flow on the scratch branch:** profile completed correctly on the coaching-style-revealing turn, benchmark routine written and structurally valid, one progression seeded per movement pattern (`current: null`, correctly "not yet benchmarked"), first week compiled and committed with the benchmark scheduled on a real day.

---

## Current Week: scenario results

Not originally in scope for this pass, but tested once the FSP work above surfaced a related crash risk in the shared `week_update` write path (`#973`, already merged).

### 5. Swap a day / mark a session done, with no live plan

Skanda's real repo currently has no live `current_week.json` (expired/stale). Asked to swap tomorrow to a rest day, then to mark today's session done. **Both handled correctly** — Coach recognized there was no live plan to act on and responded honestly (no hallucinated `week_update`, no fabricated session), asked a sensible clarifying question on the second one instead of guessing. Not a bug.

### 6. Weekly kickoff (`week_update`, full 7-day commit)

**One severe pre-existing bug found, fixed, reverified live (twice).**

- Asked Coach to plan the week, answered its clarifying questions (no conflicts, knee feels fine), said "lock it in."
- **First attempt (before the fix):** Gemini returned a full 7-day kickoff where 2 of the 7 days had a missing/empty `intent` field — `current_week.json`'s own schema requires a non-empty `intent` per day. The applier (`coachWeekFiles.ts`) correctly refused to write invalid data and threw — **but nothing caught that throw.** The exception propagated straight out of `buildTurnWrites`, and the whole request errored out. **The athlete got nothing — not even Coach's own reply text**, unlike every other action field in this pipeline (`workout_create`, `template_edit`, `quest_event`, ...), which all drop just the one bad action and keep the rest of the turn going.
- **Root cause:** the full-kickoff path builds and validates the week object eagerly, inline, with no error boundary around it — unlike the patch-mode path, which defers behind an async `resolve()`.
- **Fixed:** wrapped the call in a try/catch, reporting a `week_update` dropped-action, same pattern every other action field already uses.
- **Reran twice after the fix:** first run, the kickoff succeeded outright (`current_week.json` committed correctly, a real week with a real intent per day). Second run, the model produced the exact same missing-`intent` shape again — **this time it was gracefully dropped**, the turn completed normally, no crash.

**Classification:** the missing-`intent` field itself is an OpenRouter/model reliability issue (recurred on its own, independent of anything in the `#727` stack). The crash was a real, severe backend bug — now fixed.

### 7. Patch-mode `week_update` — move / mark done / skip / unplanned addition (round 2)

Ran a real 4-turn conversation against a scratch branch that already had a live, real week (from a successful kickoff test): move a session to a different day, mark today's session done, skip a session, log an unplanned extra session. Same branch, same thread, sessions actually referenced each other turn to turn.

- **"Move Monday's session to Tuesday":** correct. `sess_20260914_1` moved to `2026-09-15`, `original_date: "2026-09-14"` recorded properly.
- **"I got today's session done this morning":** **partially wrong, model reliability, not a backend bug.** Instead of marking the real moved session (`sess_20260914_1`, now sitting on today) as done, the model invented a brand-new session with a fresh id and the title "Mobility & Recovery," marked *that* done, and left the real session sitting `planned`. `validateWeekUpdate` correctly allowed this — creating a new session with no `session_id` is legitimate syntax by design (that's how a real new session gets added) — so there was nothing for the backend to refuse. The model just picked the wrong move: it should have referenced the existing session that was already sitting on that date.
- **"Skip Wednesday's session":** correct. Real `session_id` referenced, marked `skipped`.
- **"Unplanned swim this afternoon":** dropped correctly - but this was a test-setup artifact, not a finding. The kickoff had planned the *following* week (Sep 14-20, since the kickoff conversation happened on a Saturday and the model reasonably chose to start fresh next Monday), so "today" during this patch conversation fell outside the plan's own date range entirely. Coach correctly refused to attach a session to a day that isn't in the current week rather than hallucinating one.

**Classification:** 3 of 4 handled correctly. The "wrong session" case is model reliability (a reasoning miss, not a validation gap - the backend's job here is exactly to allow a legitimately-shaped new session, which this was). Worth a prompt-text improvement if you want to reduce it (e.g., telling the model explicitly to check for an existing session on today's date before creating a new one), but not something achievable with a validation rule, since "create a new session" is valid behavior in other real cases.

---

## All fixes (PR #995, `core/727-live-test-fixes`, stacked on `#993`)

| # | Fix | File(s) | Commit |
|---|---|---|---|
| 1 | Tell the model existing routine ids are also valid for `workout_remove`/`session_plan`, not just `template_edit` | `coachPromptText.ts` | `93068b86` |
| 2 | Benchmark picks by equipment accessibility (a real ranking), not raw item count | `coachFirstSessionBenchmark.ts` | `af0adfce` |
| 3 | Honest dropped-action correction text (was hardcoded to a wrong explanation); better validation error messages | `coachTurn.ts`, `workoutSchema.ts` | `b9c11e75` |
| 4 | Restore the `wasProfileComplete` transition requirement for First Session's benchmark (a live-verified regression in my own earlier fix) | `coachTurn.ts` | same commit history as fix #2 on this branch |
| 5 | A bad `week_update` kickoff no longer crashes the whole turn | `coachTurn.ts` | `2bb68e62` |
| 6 | Patch-mode `week_update` validated eagerly too, closing the same crash risk one level later (chased down after round 1 flagged it as a risk, not yet live-reproduced) | `coachTurn.ts` | `0becf2d2` |
| 7 | A pre-existing test fixture (`coachTurn.test.ts`) was missing most of `current_week.json`'s required fields - only worked before because nothing forced full validation eagerly. Found while wiring fix #6's regression test; rebuilt as a real, complete fixture | `coachTurn.test.ts` | `0becf2d2` |

All 9 local gate checks pass on every commit. Full stack (`#983`-`#993` + `#995`) still mergeable, nothing merged.

---

## Model reliability, not fixed in code

These are real, reproduced-live findings, not overlooked bugs — nothing in this codebase can force a language model to reason correctly every time, and the backend's job (refuse invalid data, never silently corrupt a real file) worked exactly as designed in every one of these.

- **`workout_create` intermittently omits a required field** (a `type: "reps"` exercise with no `reps` key), or skips the tool entirely and answers in prose. Reproduced twice out of five runs. The JSON schema has no way to make a field conditionally required only when `type: "reps"` - a known, already-documented limitation of Gemini's structured-output mode, more pronounced over OpenRouter specifically.
- **A "mark today's session done" patch invented a new session instead of updating the real one already sitting on that date.** The backend correctly allowed it (creating a new session with no `session_id` is legitimate, by design), the model just made the wrong call given a real existing session was available to reference.

If you want to reduce either, the two realistic levers are: a corrective reprompt (the pipeline already does one retry for over-length text fields in `requestCoachReply` - could plausibly extend to a missing required field or an unreferenced-existing-session case), or tighter prompt guidance (e.g., explicitly telling the model to check for an existing session on a date before inventing a new one). Neither is a validation-layer fix, since both cases are the model choosing a legal-shaped but wrong action, not sending malformed data.
