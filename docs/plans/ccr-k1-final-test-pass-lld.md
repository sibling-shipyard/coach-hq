# K1 — Final live test pass before this redesign ships — LLD

> Status: Current · Owner: Tech Lead · Verified: 2026-09-02

Execution detail for K1 in [`chat-commit-redesign.md`](chat-commit-redesign.md). Runs **last**,
after H1 — the actual gate before this whole stack merges to `main`, not one more milestone
alongside the others.

## Problem

Every PR in this redesign deferred its own live-Gemini and live-scratch-repo checks — each one
individually reasonable (paid API calls, ADR 0024's gate), but nothing ever consolidated them into
one real pass against the final, fully-integrated stack. Per-PR eval runs test that PR's own diff
in isolation; they don't prove the whole redesign together still does what the HLD's own "Done
when" section promises. Right now that promise is unverified end to end.

## Fix — one consolidated live pass, with real evidence per item

Run against the final integrated branch (every PR in this stack landed, right before merge to
`main`), not a scratch branch missing later work:

1. **Full `npm run eval:coach-chat` on `gemini-pro-latest`** (the real production model — see
   `geminiModel.ts`). Triage every failure: fix it, or file it as its own issue and note it here
   as a known, accepted gap. 2026-09-02's run (11/15 flash, 12/15 pro, logged in
   `tests/2026-09-02/eval/`) is a starting point, not the final answer — re-run once every PR in
   the stack has actually landed together.
2. **Live multi-day scratch-repo conversation, C2's own "Done when"**: one `coach_log` row per
   day that had messages, updated in place as the day progresses, absent on inactive days,
   present whenever another structured write also fired that turn. Never run live — C2's PR body
   flagged it, never done.
3. **Two live scratch-repo conversations, E1's own "part that matters most"**: same fact stated
   with two different `coaching_style` values, confirming Coach's reply text actually reads
   differently — direct/unpadded vs. progress-first vs. reasoning-first. Never run live.
4. **Re-verify #807 and #808** (both filed during G1's live eval pass): `plan_edit` silently
   dropped without a wrap-up cue, and `quest_create` flaky (~1 in 3) when a habit is stated
   alongside `season_start` after profile completion. Confirm still-reproducing, still-open, or
   fixed by something later in the stack — don't let them go stale unconfirmed.
   - **#808 — prompt strengthened, live-tested, still flaky (2026-09-03, PR #824).** Root cause:
     the pre-redesign closing-turn prompt had a dedicated "this is the field most likely to get
     missed" warning for `quest_create`. C1 removed the closing-turn path entirely, and the
     surviving FSP ordinary-turn text never carried that warning over — `season_start` and
     `quest_create` sat as two clauses in one flat sentence with no mention of the pairing risk.
     Fixed in both places that actually reach a live turn: `coachPromptText.ts`'s FSP
     ordinary-turn block, and `B_engine.md`'s Step 4. The latter reaches the hosted app too,
     since its First Session section is horcrux-injected per-turn, not part of the static
     `SOUL.chat.md` prefix. Live-tested (5 fresh runs each via
     `npm run eval:coach-chat -- --only 30-fsp-quest --fresh`). Also fixed
     `eval-coach-chat.ts`'s `PROMPT_SOURCES` in the same PR. J2 moved
     `coachPromptText.ts`/`coachReplySchema.ts`/`geminiClient.ts` into `_lib/gemini/`, and the
     eval harness's cache-fingerprint list still pointed at the pre-J2 paths. It had been silently
     unrunnable on the stack tip since J2 landed. **`gemini-flash-latest`: 0/5 pass** —
     same failure every run, `season_start`/`sports_update` fire, `quest_create` never does, and
     both the reply text and `coach_note` explicitly claim the habits are saved anyway.
     **`gemini-pro-latest` (the real production model, per `geminiModel.ts`'s pin): 4/5
     pass** — an improvement over the ~1-in-3 baseline this issue was filed against. Still not
     reliable, and n=5 is a small sample. The prompt fix alone is not sufficient, at least on
     flash. Live evidence points at a structural cause beyond wording.
     `.github/agents/bob-the-builder.md`'s own Learning says Gemini's `responseSchema` fills
     properties roughly in declaration order. `quest_create` is declared **last** in both
     `FSP_ACTIONS` and `RETURNING_ACTIONS` (`coachReplySchema.ts`) — same position regardless of
     model, which would explain why prompt wording alone couldn't move flash's rate at all.
     **Not yet tried:** reorder `quest_create` earlier in both action-field lists (e.g. beside
     `season_start` in the data-fact half, not trailing every other field), then re-test both
     models. Left for a follow-up on #808, not blocking this pass.
   - **#808 — returning-athlete path found and fixed the same day, still not resolved
     (2026-09-04, PR #824).** A full line-by-line audit of the SOUL layers and
     `coachPromptText.ts` (prompted by wanting to be sure this PR was actually complete before
     merging) found the first commit only strengthened the First Session branch. B3 already made
     `season_start`/`quest_create` available to a returning athlete on any turn. The returning
     branch (`coachPromptText.ts`'s non-FSP block, and `B_engine.md`'s `s5b1` "Current Season"
     rule) had zero pairing warning — the exact same bug shape, unfixed. Added the matching
     warning to both. `s5b1` has no `keyTargets` override, so it lands in `SOUL.chat.md`'s static
     prefix directly — confirmed via `compose-soul.mjs`, no horcrux dependency this time. New eval
     transcript `35-returning-season-and-habit-same-turn.json` (a returning athlete starting a new
     season and naming a new daily habit in the same message; the harness runs with `soul: ""`, so
     this only exercises `coachPromptText.ts`, not the SOUL addition). 5 fresh runs each:
     **`gemini-flash-latest`: 0/5. `gemini-pro-latest`: 0/5.** Worse than the FSP path's 4/5 on
     pro, and the prompt fix moved neither model at all here — `season_start` fires every time,
     `quest_create` never does, reply text and `coach_note` both claim the habit is saved anyway.
     Confirmed genuine on a full run log, not a transcript-setup artifact. The audit's own
     field-order check found `season_start`/`quest_create` sit at positions 8-9 of 9 in
     `FSP_ACTIONS` (last, right before `reply`), and at 9-10 of 15 in `RETURNING_ACTIONS`.
     That's nominally less exposed there, yet the live result is worse, not better. Wording alone
     does not fix either path.
   - **#808 — field order reordered and re-tested, hypothesis rejected (2026-09-04, PR #824).**
     Moved `season_start`/`quest_create` from the tail of `FSP_ACTIONS`/`RETURNING_ACTIONS` to
     right after `coach_note` (both arrays), on the theory that Gemini's declaration-order fill
     tendency was the structural cause the prompt fix couldn't reach. Updated the two schema
     tests in `first-session-injection.test.ts` that asserted the old order. Re-ran all 4
     combinations, 5 fresh runs each: **FSP flash 0/5** (unchanged), **FSP pro 4/5** (unchanged),
     **returning flash 0/5** (unchanged), **returning pro 1/5** (up from 0/5, still mostly
     failing). Reordering moved almost nothing — pro-latest's FSP rate is identical before and
     after, and flash didn't move at all on either branch. The field-order theory is not the
     (or not the whole) explanation; something else is driving the drop. Kept the reorder in
     since it's a plausible minor contributor and has no measured downside (all existing tests
     still pass), but it does not fix #808 on its own. A schema-level `required` marker isn't an
     option — Gemini structured output doesn't enforce conditional requireds across sibling
     fields. **Not yet tried:** a two-pass approach (detect the compound case, ask Gemini to
     confirm the habit was captured), or a stricter self-check instruction referencing the
     specific fired field. #808 stays open, unresolved by this PR.
   - **#807 — untouched by this pass.** Same G1 batch, different failure shape (`plan_edit`
     agreed in prose, no field set at all, not a pairing-drop) — needs its own root-cause dig, not
     assumed to share #808's fix.
5. **The HLD's own "Done when" section, run for real**, on one fresh scratch athlete repo. FSP
   goal, habits, and injuries all land in the same conversation regardless of when profile fields
   complete. A returning athlete's ordinary "I'm 76kg now" persists without closing. `quests.json`
   / `profile.json` show no skeleton-init placeholder data after carve.
   **DONE (2026-09-04, flash, `coach-skanda-testing` branch `test/fresh-fsp-k1`, reset to genuine
   `carve-skeleton.mjs` output).** All three confirmed live with real observed diffs. Goal + habit
   landed together (#808's fix, already recorded above). An injury flagged in a later turn of the
   same conversation - `injury_flag`, real minted id, `coach_since` correctly set on profile
   completion, 7 initial workout templates auto-seeded. An ordinary post-completion weight update
   (`profile_update: weight_kg`) committed with zero closing ritual. No placeholder data at any
   point - confirmed `main_quest: null`/`current_season_id: null` pre-FSP, real values post.
6. **`bash platform/scripts/check.sh --quiet`**, clean, on the actual final integrated tip — not
   per-PR (already done), the merged whole.

## Testing coverage audit (2026-09-04)

Chasing #808 in isolation surfaced a bigger question: how much of coach-chat's real behavior has
never been checked against a live model at all, not just this redesign's own new fields? Full
inventory of the 16 `eval:coach-chat` transcripts against every one of `coachReplySchema.ts`'s 15
action fields, plus what only the manual harness's real observed diffs can answer.

**Covered by `eval:coach-chat` (single-shot, derived file-impact only):** `coach_note` (day-keyed
required-with/absent, `#33`/`#34`), `injury_flag` (FSP only, `#28`), `injury_event` (array + 3-turn
incremental disclosure, `#11`/`#25`), `quest_event` (array, `#10`). Also `profile_update` (`#12`,
FSP via `#30` turn 1), `coaching_style_update` (FSP only, `#29`), `season_start`
(`#27`/`#30`/`#32`/`#35`), `quest_create` (`#27`/`#30`/`#35`/`#36`). Plus the baseline modes:
greeting (`#01`), ordinary ADR-clean (`#02`), activity_sync (`#20`).

**Never independently tested live, any mode:** `memory_update`, `sports_update`. Also
`coaching_style_update` on a *returning* athlete - an explicit mid-relationship style-change
request, FSP-only coverage today. Also `template_edit`, `session_plan`, `week_plan`,
`session_reconcile` - this whole family is "down to one representative transcript" by the README's
own admission. `#19` only tests `plan_edit` vs `template_edit` disambiguation, not whether any of
these four actually fire correctly on their own. A dynamic-enum/hallucination fixture (bad
`flag_id`/`quest_id` reference, D1's corrective retry) was explicitly deferred in the README pending
D1. D1 has since landed in this stack, and the fixture was never revisited.

**Structurally can't be answered by `eval:coach-chat` at all.** It calls `askGemini()` directly, one
shot, no commit pipeline, no `coachTurn.ts` reprompt logic, `"derived"` file-impact only - see
`docs/eng-docs/coach-chat-testing.md`'s own "derived" vs "observed" distinction. That leaves several
real questions unanswered: whether `coach_note` really updates one row in place across multiple
turns the same day, instead of duplicating it. Whether it's genuinely absent on an inactive day.
The actual tone difference `coaching_style` produces across a real multi-turn conversation. Whether
a full FSP conversation (name through injuries, 8+ turns) actually flips profile-complete at the
right moment and reads back its own earlier turns' saves correctly. Whether an ordinary turn's
`injury_event`/`quest_event` reference a *real* `flag_id`/`quest_id` read from actual repo state,
not a canned fixture. Only `test:coach-chat-manual` against a real scratch branch (`coach-skanda`),
with real Gemini calls and real GitHub commits, gives an `"observed"` (ground-truth) answer to any
of these - this redesign has never run it. The three 2026-08-26/27/30 manual logs in `tests/`
predate C2/E1 landing and don't count as current evidence.

**Revised plan — test everything before fixing anything further.** Two tracks, `flash` first
throughout. Drop to `pro-latest` only if `flash` itself starts erroring, not just failing a
field-check - a clean 200 with a field missing is not a `flash` problem, see #808's evidence above:
- **Track A — fill the eval gaps.** New single-shot transcripts for every field in the "never
  tested live" list above, plus the unblocked dynamic-enum/hallucination fixture. Fast, cheap,
  catches schema-shape regressions.
- **Track B — manual harness, real multi-turn/multi-day conversations.** A full FSP run (one
  continuous conversation, not fragments), a multi-day `coach_note` run (K1 item 2), a
  same-fact-two-styles run (K1 item 3), and #808's own compound scenario run start-to-finish with
  real writes, not derived guesses. This is the only track that can answer "what actually gets
  saved."

### Track B results so far (`test:coach-chat-manual`, real repo, scratch branch)

- **CRITICAL — E1's `coaching_style` gate re-triggers full FSP for an established athlete
  (2026-09-04, flash, `coach-skanda`, scratch branch `test/manual-2026-09-04T12-52-14-684Z`).**
  `isAthleteProfileComplete` (`coachChatFiles.ts:330-332`) requires a real `coaching_style` enum
  value. `coach-skanda`'s `memory.json` predates E1 and has none set. A real ordinary message
  ("Feeling okay, elbow is fine today.") to this 67-session athlete got the full First Session
  introduction back - "let me introduce myself properly... I'm Coach Phelps... what is your date
  of birth?" - mid-conversation, unprompted, plus the coaching-style intake question. Commit
  mechanics themselves are solid: the same turn's `injury_event` correctly updated an existing
  flag by its real `flag_id` (`inj_right_elbow_golfer_s_elbow_medial_epicon`), real observed diff
  landed clean (`chat_history.json`/`coach_log.json`/`injuries.json`, commit `e72f7c7`). The bug is
  purely the FSP re-trigger. F1's LLD already tracks `coaching_style` backfill as a needed step for
  all 5 real athlete repos (`ccr-f1-repo-migration-lld.md` Step 3, item 1) - so this is a known,
  planned gap, not a surprise. But it means **F1 is a hard blocker before this ships to any real
  athlete**, not just a nice-to-have follow-up: shipping E1's gate live without the backfill would
  reset every existing athlete's onboarding on their next message. Also found in passing: F1's own
  cached table says `coach-skanda-2003`'s `profile.json` was `{}` as of 2026-09-01 - it is not
  empty now (`name`/`dob`/`timezone`/`height_cm`/`weight_kg` all real, confirmed directly). F1's own
  "re-confirm at Step 0" caveat already anticipates this kind of drift; flagging for whoever
  executes F1, not fixed here.
- **The FSP re-trigger above also re-asked for data it already had.** Answering the coaching-style
  question on the same branch (`coaching_style_update: 'accountability'` fired correctly, clean
  real diff to `memory.json`) got a reply that also asked for date of birth and city, both already
  real values in `profile.json`. `renderCoachContext`'s `profileSection`
  (`coachContext.ts:60-73`) does render the real age-derived-from-dob and timezone into every
  turn's context regardless of `firstSession` - the data reaches the model. `coachPromptText.ts`'s
  `firstSession` branch (`:98+`) never instructs it to check that context and skip fields already
  answered - the canned intake script reads as written for a genuinely blank profile. Distinct
  from the `coaching_style` gate bug above: this would surface for *any* athlete who ever gets
  bumped back into FSP with a partially-known profile, not just the one missing field. Not fixed
  here - noted for the same coordinated pass.

### Track A results (`eval:coach-chat`, flash, new transcripts `#37`-`#40`)

4/4 passed on the first fresh run each: `memory_update` (`#37`), `sports_update` (`#38`),
returning-athlete `coaching_style_update` (`#39`). Also the dynamic-enum guard (`#40` - 3
similarly-named real `flag_id`s in context, athlete describes an update by body part only). The
model correctly matched `inj_right_knee`, no hallucinated or wrong-sibling id.

- **NEW, systemic — returning-athlete turns spontaneously invent unrelated optional action
  fields.** `#39`'s full output (a turn that only asked to change coaching style) also fired a
  duplicate `season_start` for a goal already stated in `stateMd`, plus a fully fabricated 7-day
  `week_plan`. Nothing in the athlete's message asked for either. This isn't isolated to `#39`:
  the same shape of noise (`template_edit`/`week_plan`/`session_plan` appearing unprompted) showed
  up repeatedly across `#808`'s own testing (`#10`, `#30`, `#35`, `#36` runs, this session). Every
  action field being unconditionally available on every returning-athlete turn (C1) means nothing
  in the schema or prompt currently constrains the model to only set what *this turn* actually
  established. Cross-cutting, not specific to any one field - likely needs its own prompt-level
  "only set a field when this turn gave you a real reason to" reinforcement. Or investigation into
  whether it's isolated to when many optional fields are simultaneously available. Not fixed here.

### Track B continued — real observed evidence for #808 and coach_note (2026-09-04, flash)

- **`coach_note` day-keying confirmed correct, real diff.** Two turns sent same real day on the
  same scratch branch. `coach_log.json` stayed at 68 rows both times (not 69) - the second turn's
  fact merged into the existing 2026-09-04 row (`ts` bumped, text appended), not duplicated.
  Genuinely crossing a real calendar-day boundary can't be tested synchronously in one sitting
  without either waiting a real day or a date-injection hook that doesn't exist today - flagging
  that limitation honestly rather than faking it. Same-day update-in-place is the part actually
  verified here.
- **#808 reproduced live, ground truth, on real production-shaped data.** A real turn - "kick off
  a new season... also want to start a daily habit of 10 mins of mobility work every morning" -
  got `season_start` fired correctly (`main_quest` in `quests.json` updated to the real new goal,
  confirmed via direct read) and `quest_create` silently absent. The reply and `coach_note` both
  explicitly claimed the habit was created ("Created daily 10-minute morning mobility habit").
  Confirmed via direct read of the committed `quests.json`: still only the same 4 pre-existing
  quests, the mobility habit never landed. This is the first `"observed"` (not `"derived"`)
  confirmation of #808 - matches every eval-level finding above, on a real athlete's real repo,
  with Coach actively lying about the save in both surfaces the athlete would see.
  `template_edit: { template_id: '' }` fired as spurious noise on the same turn, same pattern as
  the systemic finding above.
- **K1 item 3 (coaching-style tone) - PASS, first real confirmation ever.** Two scratch branches,
  `coaching_style` set to `accountability` and `encouragement` respectively, then the identical
  fact stated on both ("Missed my strength session again this week, third time in a row.").
  `accountability`: "Look, three in a row isn't bad luck. That's a pattern... let's be straight
  about it" - names the gap immediately, minimal cushioning. `encouragement`: "Look, you got
  through the cellulitis, kept your foundation intact, and you are showing up here telling me the
  truth. That honesty matters. But here is the real talk..." - leads with real progress before the
  hard truth. Matches `A_identity.md`'s spec for both styles exactly. E1's own "part that matters
  most" is confirmed working live, for the first time.
- **Same FSP-reask-ignores-known-context bug reproduced on the fresh `encouragement` branch too**,
  same shape as before (asked for date of birth despite it being real data), confirming it's not
  branch-specific noise - same root cause as the finding above.

### Scope clarifications from the athlete (2026-09-04)

- **Finding 3 (FSP re-ask ignores known context) is not a real product bug.** iOS onboarding
  already supplies name/sports as real context before FSP ever runs on the phone - the manual
  harness's scratch-branch scenario artificially triggered FSP mid-conversation via the
  `coaching_style` gate, a shape the real app doesn't hit the same way. Already fixed once before,
  differently. Not pursued further here.
- **Finding 2 (`coaching_style` gate re-triggers FSP) is not a code bug either** - it resolves once
  F1's backfill runs. No code fix pending on it.
- **Findings 1 (#808) and 4 (spurious unrelated fields) are the two real problems**, confirmed by
  the athlete, and the only two this pass is fixing.

### #808 — structural fix implemented and live-tested (2026-09-04, flash only)

Implemented exactly as designed above: `new_habits` added as a **required** array inside
`season_start`'s own schema object (`coachReplySchema.ts`). `applySeasonStart` appends it through a
`buildNewQuests` helper shared with `applyQuestCreate` (`coachIntents.ts`). Both prompt branches
and `B_engine.md`'s `s5b1`/`s10_first_session_finish` point habits-with-a-season-change at
`new_habits` instead of the separate `quest_create` field. Transcripts `27`/`30`/`35` updated to
expect `season_start.new_habits`, `eval-coach-chat.ts`'s `isSet` extended for one dot-path level.
All 635 unit tests pass, including a new dedicated `coachIntents.test.ts` case.

Live-tested, flash only (5 fresh runs each): **FSP: 5/5 pass** (one run hit an unrelated JSON-parse
infra error, cleanly re-run). **Returning: 4/5 pass**, and the one failure's `new_habits` still
fired correctly - the only thing wrong was finding 4's spurious `template_edit`/`week_plan` noise,
unrelated to #808. **#808 is 10/10 on the actual habit-capture question across both branches on
flash** - a complete fix, where wording (Track 1) and field reordering (Track 2) both plateaued.
The required-field structural guarantee, the same mechanism that already made `main_quest`
reliable, is what actually closed this. Not yet tested on `pro-latest`.

**Real-data confirmation, `coach-skanda-testing` (2026-09-04, flash).** Reset a scratch branch
(`test/fresh-fsp-k1`) to genuine skeleton-init state via `carve-skeleton.mjs --dry-run` (no
placeholder data - `main_quest: null`, `current_season_id: null`, matching K1 item 5's own bar).
Ran a real First Session through the manual harness end to end: greet, name/sports intake, profile
completion. Then one turn stating both the goal ("finish a half-Ironman by next June") and a daily
habit ("stretching for 15 minutes every morning") together - the exact compound scenario #808 was
filed against. `season_start.new_habits` fired with the real habit. Confirmed via direct read of
the committed `quests.json`: `main_quest` ("Finish Half-Ironman") and the habit quest ("Morning
stretch (15m)") both landed in the same real commit. First `"observed"` (not `"derived"`)
confirmation of the fix, on a genuinely fresh athlete, closing the loop this issue started from.
Bonus: D1's self-correcting reprompt fired live on this same run (a first attempt without
`coach_note` got a system-note retry and succeeded) - first live confirmation of that mechanism
too, not something this pass set out to test but worth recording.

### #807 — RESOLVED, was a stale-fixture false negative, not a live model bug (2026-09-04, flash)

Re-tested `#19` (`plan-edit-vs-template-edit-disambiguation.json`), the transcript #807 was filed
against. Initial 5 runs: 0/5, reply text was "you don't have a session scheduled tomorrow" every
time. Not #807's originally reported shape (Gemini agreeing in prose but dropping the field) - the
model was actually reasoning correctly against broken input. The fixture's session date was
hardcoded to `2026-08-19`, long in the past relative to the real date this ran against - "tomorrow"
genuinely matched nothing. Fixed the date to be realistically one day ahead; **5/5 pass** once
corrected, `plan_edit` and `coach_note` both fire correctly, real `session_id` and `template_id`
referenced. **#807 is resolved** - whatever originally caused it (likely fixed incidentally by D1's
reprompt work or general prompt hardening since G1) is gone, and the transcript had been silently
reporting a false failure for some unknown period. **Systemic risk worth flagging:** any eval
transcript with a hardcoded absolute session/plan date will rot the same way and misreport a live
regression that isn't real. No transcript-freshness check exists today. Not fixed here (would need
either relative-date templating in the harness or a periodic freshness audit) - noted as a real gap
for a future pass, out of this pass's two-problem scope.

### Finding 4 — Phase 1 (prompt restraint) implemented and live-tested (2026-09-04, flash only)

Added an explicit restraint instruction to `coachPromptText.ts`'s returning branch. Only set an
action field when the turn gave a real, stated reason. Never fire `season_start`, `week_plan`,
`template_edit`, `session_plan`, or `session_reconcile` speculatively - an invented field can
overwrite real data. Not added to the FSP branch - `FSP_ACTIONS` structurally excludes those 5
fields already, so there was nothing to guard there.

Live-tested, flash, on the 3 transcripts that showed this noise before: `#10` (2/5 fail on
`coachNoteReported`, since fixed - see below), `#35` (4/5 clean, 1/5 had noise), `#39` (5/5 pass).
**The noise wasn't fully
eliminated, but its severity changed completely.** Before this fix, `#39` fired a duplicate
`season_start` with a real name/dates plus a fully fabricated 7-day `week_plan` - content real
enough to pass `buildCurrentWeekWrite`'s guard and actually corrupt `current_week.json`. After the
fix, every remaining instance is an empty stub (`{template_id: ''}`,
`{headline: '', body: '', days: []}`) - checked directly against `#35`'s one remaining failure's
full output. Every existing write-path guard (`buildTemplateEditWrite`, `buildSessionPlanWrite`,
`buildCurrentWeekWrite`) already no-ops on exactly this shape. **The real corruption risk this
finding was raised over is gone; a cosmetic eval-assertion mismatch remains** - Phase 2 (hardening
the write-guards further) is not needed on safety grounds. Whether to also silence the cosmetic
noise (tighten the prompt further, or loosen these transcripts' strict `actionFieldsAbsent` checks
to allow an empty stub) is a smaller, non-blocking follow-up, not pursued in this pass.

### #10's `coachNoteReported` flakiness — root-caused and fixed (2026-09-04, flash)

Investigated per the athlete's direct ask. `quest_event` fired correctly in all 5 runs, 2 of which
also lacked `coach_note`. Checked `coachTurn.ts`: `quest_event` is in `ACTIONS_REQUIRING_COACH_NOTE`
(`:316-324`). A real production turn shaped exactly like this gets caught and corrected by the C2
reprompt - the same mechanism observed firing live earlier in this pass (`coach-skanda-testing`'s
FSP run). `coachTurn-reprompt.test.ts` already covers this deterministically
with mocked Gemini calls. `eval-coach-chat.ts` calls `askGemini()` directly, single-shot, and
structurally never exercises that reprompt - a failure here was never evidence of a real bug.
`#12`'s transcript already established this exact precedent (same root cause, same fix, its own
description explains it) - `#10` had simply never been updated to match. Removed
`coachNoteReported: true` from `#10`'s `expect`, matching `#12`. **5/5 pass** once fixed. Not a
model or prompt bug - a stale test assertion testing something outside this harness's coverage.

Every result — pass, fail, or gap closed — gets recorded here before any further code change.

### Workouts/current-week fields — observe only, per the athlete's explicit instruction (2026-09-04)

The athlete is planning to redesign `current_week`/workouts separately and asked this pass to test
and log gaps there without fixing anything. Two new transcripts, flash:

- **`week_plan` (`#41`, Weekly Kick-off Ritual) - real reliability gap, not touched.** When the
  athlete's ask was ambiguous (loose trip timing, no exact dates), the model correctly asked
  clarifying questions instead of committing - that's the prompt's own instruction working as
  designed, not a bug. With an unambiguous "just build my normal week" ask: **2 clean passes, 3
  JSON-malformation errors out of 5** (`Unterminated string`, `Expected double-quoted property
  name`). When it does commit, the content is correct - the schema is large (7 days, each with a
  sessions array) and flash appears prone to truncating or malforming output at that size. A real,
  distinct reliability finding, separate from #808/#4 - not pursued given the redesign is coming.
- **`session_reconcile` (`#42`) - solid, no gap found.** 5/5 clean passes, athlete reports skipping
  a planned run and substituting a swim. `status: "done"` (not `"skipped"`) with `actual` describing
  the substitution is the correct shape per the 2-value enum (`done`/`skipped` - "done" means
  something happened, `actual` says what). Bonus: `injury_flag` correctly co-fired for the knee
  discomfort mentioned in the same message.
- **`template_edit`/`plan_edit` (`#19`)** - already covered above under #807's resolution, 5/5 clean.
- **`session_plan`** - still has zero dedicated live coverage. Not tested this pass (time-boxed);
  flag for whenever the workouts redesign lands, since its shape will likely change anyway.

## What this deliberately does not do

Re-review already-reviewed PRs' code. This is a live-behavior pass, not a second code review —
Tech Lead review already happened per PR, per `AGENTS.md`.

## Tests

Not applicable in the usual sense — this milestone *is* the test pass. Its own artifacts (eval
run logs under `tests/<date>/eval/`, scratch-repo commit links) are the evidence.

## Done when

Every item above has a real run attached — a log file, a commit link, or an issue number — not a
checkbox with nothing behind it. Any remaining known failure is filed as its own issue and
explicitly accepted here, never silently dropped. Only then does this redesign merge to `main` —
and per `AGENTS.md`'s plan-delete-on-last-PR rule, this K1 PR is the one that deletes
`docs/plans/chat-commit-redesign.md` and every `ccr-*-lld.md` file, folding anything durable into
the relevant `docs/eng-docs/*` page first. H1 no longer does this — K1 runs after it.
