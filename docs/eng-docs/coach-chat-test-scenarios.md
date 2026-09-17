# Coach chat - test scenario catalog

> Status: Current · Owner: vade-the-tester · Verified: 2026-09-17

## Context

The 2026-09-14 eval-audit pass reviewed all 23 eval transcripts and the simulation-suite
turns library. Numbering had drifted (01, 02, 10, 11, ... 42) from years of ad hoc adds/removes.
Several transcripts were redundant with each other, and most tested one dropped fact per turn
rather than the multi-fact conversations real check-ins actually are. 11 example turns files in
`ui/eval/examples/` were unused by anything, too. This doc is the catalog of record for both
test libraries going forward - update it whenever a scenario is added, removed, or renumbered.

The 2026-09-15 coverage-audit pass (phase 1) cross-referenced every action field the code can
actually emit against this catalog. It closed every real gap it found except two, then a same-day
follow-up (issue #1066) closed those last two - see the Coverage matrix section below, which now
has zero open rows. The same pass also settled the coach-chat redesign's own last open items
(transcripts 19/20 and the `session-plan`/`week-kickoff-flash` scenarios below).

## Eval transcripts

`ui/eval/transcripts/` - run by `npm run eval:coach-chat`, see
`docs/eng-docs/coach-chat-testing.md`'s Type 2 section for mechanics.

| # | file | turns | what it tests | key expect assertions |
|---|---|---|---|---|
| 01 | `01-greeting.json` | 1 | coach speaks first, nothing fires | `actionFieldsAbsent`: every action field |
| 02 | `02-ordinary.json` | 1 | ordinary check-in commits immediately, no closing ritual | `coachNoteReported: true`, action fields absent |
| 03 | `03-activity-sync.json` | 1 | activity-sync turn stays observe-only, no invented cause | `actionFieldsAbsent`: every action field incl. `coach_note` |
| 04 | `04-profile-update.json` | 1 | a stated new weight fires `profile_update` | `actionFieldsPresent: ["profile_update"]` |
| 05 | `05-plan-edit-vs-template-edit-disambiguation.json` | 1 | "swap tomorrow's session" is a one-day `week_update`, never a permanent `template_edit` | `actionFieldsPresent: ["week_update"]`, `actionFieldsAbsent: ["template_edit"]` |
| 06 | `06-week-plan-kickoff-ritual.json` | 1 | explicit "plan my week" triggers the Weekly Kick-off Ritual | `actionFieldsPresent: ["week_update"]` |
| 07 | `07-session-reconcile-actual-differs.json` | 1 | reporting a different activity than planned reconciles the real session, doesn't just create a new one | `actionFieldsPresent: ["week_update"]` |
| 08 | `08-fsp-quest-create.json` | 1 | FSP goal + habits in one message fire `season_start` with `new_habits`, plus `injury_flag` for two new injuries | `actionFieldsPresent: ["season_start", "season_start.new_habits", "injury_flag"]`, `actionFieldsAbsent: ["quest_create"]` |
| 09 | `09-fsp-coaching-style.json` | 1 | FSP intake answer to the coaching-style question sets the enum | `actionFieldsPresent: ["coaching_style_update"]` |
| 10 | `10-returning-season-and-habit-same-turn.json` | 1 | returning athlete states a new season goal and a new habit together | `actionFieldsPresent: ["season_start", "season_start.new_habits"]`, `actionFieldsAbsent: ["quest_create", ...]` |
| 11 | `11-returning-standalone-habit-no-season-change.json` | 1 | a standalone new habit, no season change, fires `quest_create` on its own | `actionFieldsPresent: ["quest_create"]`, `actionFieldsAbsent: ["season_start", ...]` |
| 12 | `12-fsp-quest-create-after-profile-complete.json` | 2 | profile completes in turn 1, goal+habits land in turn 2 of the same FSP conversation | turn 1: `profile_update`; turn 2: `season_start`, `season_start.new_habits` |
| 13 | `13-incremental-injury-disclosure.json` | 3 | a vague "felt off" doesn't fire an injury field until named two turns later; filler doesn't re-fire it | turn 1: absent; turn 2: `injury_flag` present; turn 3: `coach_note`/`injury_flag` absent |
| 14 | `14-injury-resolve-by-bodypart-then-new-disclosure.json` | 3 | new; check-in resolves an existing flag by body part (disambiguating among 3 similar ones), then discloses a genuinely new injury | turn 2: `injury_event`; turn 3: `injury_flag`, `coachNoteReported: true` |
| 15 | `15-returning-pattern-style-then-new-sport.json` | 2 | new; a durable training pattern and an explicit coaching-style change stated together, then a new sport later in the same check-in | turn 1: `memory_update`, `coaching_style_update`; turn 2: `sports_update` |
| 16 | `16-quest-completions-across-two-checkins.json` | 2 | new; one quest completion needing a `coach_note`, then a later check-in reporting two completions at once (array-shaped) | turn 1: `quest_event`; turn 2: `quest_event` |
| 17 | `17-workout-create.json` | 1 | new (coverage-audit phase 1); a plain, unambiguous ask for a new routine fires `workout_create` | `actionFieldsPresent: ["workout_create"]` |
| 18 | `18-workout-remove.json` | 1 | new (coverage-audit phase 1); asking to delete a named existing routine fires `workout_remove` | `actionFieldsPresent: ["workout_remove"]` |
| 19 | `19-session-plan.json` | 1 | new (coverage-audit phase 1); a one-day-only adjustment to an existing routine fires `session_plan`, never a permanent `template_edit` | `actionFieldsPresent: ["session_plan"]`, `actionFieldsAbsent: ["template_edit"]` |
| 20 | `20-fsp-dense-intake-single-turn.json` | 1 | new (coverage-audit phase 1); settles the redesign-followups reliability question - profile, goal, and habit stated together in one dense FSP message still fires `season_start`/`season_start.new_habits` reliably | `actionFieldsPresent: ["profile_update", "season_start", "season_start.new_habits"]`, `actionFieldsAbsent: ["quest_create"]` |
| 21 | `21-template-edit-permanent-change.json` | 1 | new (coverage-audit phase 1 follow-up, #1066); a "permanent, going forward" ask fires `template_edit`, not the "just today" `session_plan` | `actionFieldsPresent: ["template_edit"]`, `actionFieldsAbsent: ["session_plan"]` |

**Cut (redundant/subset), not merged:**
- `28-fsp-new-injuries.json` - strict content subset of what's now `08` (same `injury_flag` assertion, `08` also covers the goal/habit case).
- `32-returning-season-change-with-goal.json` - strict content subset of what's now `10` (`10`'s absent-list is a superset that also covers `quest_create`).
- `34-coach-note-absent-filler.json` - its core assertion (`coach_note` optional on filler) duplicates `13`'s turn 3. The extra fields it also asserted absent (`quest_event`, `profile_update`, `memory_update`) aren't tested against any content that could trigger them, so nothing distinct was lost.

**Merged into 14/15/16 above:** `10-quest-event-array`, `11-injury-event-array`,
`33-coach-note-required-with-quest-event`, `37-memory-update-learned-pattern`,
`38-sports-update-new-sport`, `39-returning-coaching-style-explicit-change`,
`40-injury-event-real-id-among-several` - each was a single dropped-fact test. Real check-ins
report several things in one sitting, so these became the multi-turn conversations above instead
of seven separate one-fact files.

## Simulation scenarios

`ui/eval/run-manual-simulation-suite.ts`'s `SCENARIOS` array - real live-model, real-write runs
through `test:coach-chat-manual`'s pipeline. See `docs/eng-docs/coach-chat-testing.md`'s section on
the fourth test type for mechanics.

| id | file | turns | what it tests | expected files/behavior |
|---|---|---|---|---|
| `fsp-basic` | `manual-coach-chat-turns-fsp.json` | 6 (incl. greet) | full First Session Protocol - profile, goal, injury, training freq, wrap-up | turn 1: `user_data/coach/profile.json`; turn 3: `user_data/coach/injuries.json`; turn 5: PASS |
| `daily-basic` | `manual-coach-chat-turns-daily.json` | 5 (incl. greet) | ordinary daily check-in - weight, hip soreness, a finished run, wrap-up | turn 1: `profile.json`; turn 2: `injuries.json`; turns 3-4: PASS |
| `daily-sleep-skip` | `manual-coach-chat-turns-daily-2.json` | 5 (incl. greet) | ordinary daily check-in - poor sleep, a skipped session, tomorrow's commitment, wrap-up | turns 1-4: PASS |
| `ambiguous-contradiction` | `manual-coach-chat-turns-ambiguous-contradiction.json` | 5 (incl. greet) | new; athlete reports a planned session done, immediately contradicts it, then confirms the real one - checks the coach reconciles rather than double-writing | turn 1: `current_week.json` changed; turn 3: `current_week.json` changed (see the scenario's own code comment for what this can't verify) |
| `workout-lifecycle` | `manual-coach-chat-turns-workout-lifecycle.json` | 4 (incl. greet) | new (coverage-audit phase 1); `workout_create` then `workout_remove` in one conversation, real-write coverage for both | turn 1: `templates/_manifest.json` changed; turn 2: `templates/_manifest.json` changed; turn 3: PASS |
| `session-plan` | `manual-coach-chat-turns-session-plan.json` | 4 (incl. greet) | new (coverage-audit phase 1); creates a routine, then plans a one-day-only adjustment against it - real-write coverage for `session_plan`, previously zero of any kind | turn 1: `templates/_manifest.json` changed; turn 2: `workout_plans/sessions/` file changed; turn 3: PASS |
| `week-kickoff-flash` | `manual-coach-chat-turns-week-kickoff.json` | 2 (incl. greet) | new (coverage-audit phase 1); Weekly Kick-off Ritual malformation retest - run repeatedly under `LLM_PROVIDER=openrouter` to sample the real pass rate found in the redesign-followups doc (3/5 parse failures on Flash), not a one-shot happy-path check | turn 1: `current_week.json` changed |
| `injury-resolve-by-bodypart` | `manual-coach-chat-turns-injury-resolve-by-bodypart.json` | 5 (incl. greet) | new (coverage-audit phase 1); real-write companion to eval `14` - mints two flags, then resolves one by body part | turns 1-3: `injuries.json` changed; turn 4: PASS |
| `pattern-style-sport` | `manual-coach-chat-turns-pattern-style-sport.json` | 4 (incl. greet) | new (coverage-audit phase 1); real-write companion to eval `15` - `memory_update`, `coaching_style_update`, `sports_update` | turns 1-2: `memory.json` changed; turn 3: PASS |
| `season-transition` | `manual-coach-chat-turns-season-transition.json` | 3 (incl. greet) | new (coverage-audit phase 1); real-write companion to eval `10` - a returning athlete's `season_start` commits both `seasons.json` and `quests.json` | turn 1: `seasons.json` and `quests.json` changed; turn 2: PASS |
| `quest-event` | `manual-coach-chat-turns-quest-event.json` | 3 (incl. greet) | new (coverage-audit phase 1); real-write companion to eval `16` - a habit completion commits `progress.json`, previously never checked live | turn 1: `progress.json` changed; turn 2: PASS |
| `quest-create-standalone` | `manual-coach-chat-turns-quest-create-standalone.json` | 3 (incl. greet) | new (coverage-audit phase 1 follow-up, #1066); real-write companion to eval `11` - a standalone new habit with zero season/goal language commits `quests.json` | turn 1: `quests.json` changed; turn 2: PASS |
| `template-edit-permanent` | `manual-coach-chat-turns-template-edit.json` | 4 (incl. greet) | new (coverage-audit phase 1 follow-up, #1066); real-write companion to eval `21` - creates a routine, then permanently edits it ("going forward", not "just today") | turn 1: `templates/_manifest.json` changed; turn 2: `workout_plans/templates/` file changed; turn 3: PASS |
| `multi-field-success` | `manual-coach-chat-turns-multi-field-success.json` | 3 (incl. greet) | new (#1105 B2); one message asking for a permanent `template_edit` and a this-week-only `week_update` together - proves two real action fields can both land from one turn, not just fail together (`fullTurnPipeline.test.ts` only ever proved the failure case) | turn 1: `current_week.json` and `workout_plans/templates/` both changed; turn 2: PASS |
| `compound-narration-probe` | `manual-coach-chat-turns-compound-narration-probe.json` | 4 (incl. greet) | new (#1105 B3); reuses the compound-message shape that dropped `memory_update` (#1085), aimed at `template_edit` and `week_update` instead - not a known-good case, the `expect` block reports honestly whichever way each write goes | turn 1: `workout_plans/templates/` changed; turn 2: `current_week.json` changed; turn 3: PASS |

## What replaced what

23 eval transcripts → 16 (3 cut as redundant subsets, 7 merged into 3 realistic multi-turn
conversations, 3 new files added) as of the 2026-09-14 eval-audit pass. The 2026-09-15
coverage-audit pass added 5 more (`17`-`21`, the last one from the same-day #1066 follow-up), for
21 total today. See "Cut" and "Merged" notes above for the eval-audit's reasoning per file, and
the coverage matrix below for what each new one closes.

`ui/eval/examples/` dropped 11 unused `-727-*` probe files from the #727 migration in the
eval-audit pass. The original estimate was 2 named plus roughly 8 more; the real count, confirmed
unreferenced anywhere by grep before deletion, was 11. That same pass gained one new file
(`manual-coach-chat-turns-ambiguous-contradiction.json`). The coverage-audit pass and its #1066
follow-up together added 9 more turns files and 9 more `SCENARIOS` entries. The test-harness
hardening pass (#1105) added 2 more: `multi-field-success` and `compound-narration-probe`. It also
added a `seedMessages` precondition-seeding mechanism (B1, no new scenario) and an
`--all-repos`/`--repo` override for running the whole suite against any real athlete repo (A3) - see
`docs/eng-docs/coach-chat-testing.md`'s "fourth test type" section for both mechanics. 15
`SCENARIOS` entries total today.

## Coverage matrix (coverage-audit phase 1, 2026-09-15; closed out by #1066 same day)

Cross-references every action field `LlmReply` (`ui/api/coach-chat/_lib/llm/coachReplySchema.ts`)
can actually emit today against the schema file(s) it writes (`docs/eng-docs/coach-data-schema.md`)
and against this catalog's own eval/simulation tables above. "Gap → closed" means a fixture now
exists that exercises it. `pending_clarification`/`unrecorded_facts` aren't in this table - they're
self-audit fields, not writes (see the schema doc). Zero rows are left open as of #1066 - see the
note on `coach_note` below for the one row whose coverage is real but implicit rather than a
dedicated assertion.

| Action field | Writes to | Eval coverage | Simulation coverage | Status |
|---|---|---|---|---|
| `coach_note` | `coach_log.json` | `02`, `13`, `14`, most others | `daily-basic` turn 1 asserts `coach_log.json` changed (#1144) | Covered |
| `memory_update` | `memory.json` | `15` | `pattern-style-sport` | Gap → closed |
| `coaching_style_update` | `memory.json` | `09`, `15` | `pattern-style-sport` | Gap → closed |
| `sports_update` | `memory.json` | `15` | `pattern-style-sport` | Gap → closed |
| `injury_flag` | `injuries.json` | `08`, `13`, `14` | `fsp-basic`, `daily-basic`, `injury-resolve-by-bodypart` | Gap → closed |
| `injury_event` | `injuries.json` | `14` | `injury-resolve-by-bodypart` | Gap → closed |
| `quest_event` | `progress.json` | `16` | `quest-event` | Gap → closed |
| `profile_update` | `profile.json` | `04`, `12`, `20` | `fsp-basic`, `daily-basic` | Covered |
| `season_start` / `.new_habits` | `seasons.json`, `quests.json` | `08`, `10`, `12`, `20` | `season-transition` | Gap → closed |
| `quest_create` (standalone) | `quests.json` | `11` | `quest-create-standalone` (#1066) | Gap → closed |
| `template_edit` | template file | `21` (#1066; `05` covers the absence case) | `template-edit-permanent` (#1066) | Gap → closed |
| `session_plan` | session-snapshot file | `19` | `session-plan` | Gap → closed (was the redesign-followups doc's zero-coverage item) |
| `week_update` (kickoff) | `current_week.json` | `06` | `week-kickoff-flash` | Gap → closed (Flash malformation retest) |
| `week_update` (patch) | `current_week.json` | `05`, `07` | `ambiguous-contradiction` | Covered |
| `workout_create` | template file + manifest | `17` | `workout-lifecycle` | Gap → closed |
| `workout_remove` | manifest | `18` | `workout-lifecycle` | Gap → closed |

**Files with no Gemini-facing write action at all** - checked against every `turnWrites/*.ts` file
before assuming a gap, per this pass's own "not guessing" rule. `progressions.json` is read-only
from chat's side - it's dosed into a workout at compile time (`coachWorkoutFiles.ts`), never
written through an action field, so there is no write path here for a fixture to exercise.
`athlete_insights.json`, `latest_message.json`, and `chat_history.json`'s `synced_activity_list`
rows are all pipeline-generated, not chat-written, same reasoning.

**`quest_create` (standalone) - how the #1066 fixture resolved the concern raised in the first
pass.** The first pass worried that every real athlete repo already has an active season on file,
making the "no season change" branch hard to hit unambiguously. That precondition turned out to
be fine, not an obstacle. An active season on file is the normal, expected state for a returning
athlete. The disambiguating signal for `quest_create` vs `season_start` is the message itself
carrying zero season/goal language, not anything about the repo's existing state. Eval transcript
`11` already proved this live; `quest-create-standalone` adds the missing real-write check.

**`template_edit` - what actually distinguishes it from `session_plan`.** Both write similar
shapes through the same file (`coachWorkoutFiles.ts`). The fixture had to isolate the one real
signal that tells them apart: "permanent, going forward, every time" (`template_edit`) versus
"just for today" (`session_plan`, already covered). Transcript `21` and the `template-edit-
permanent` scenario both use that framing explicitly, the same way transcript `05` already
disambiguates `template_edit` from `week_update` on the time-scope axis.

**`coach_note`'s own file write has a dedicated simulation assertion.** `daily-basic`'s turn 1
checks `coach_log.json` alongside `profile.json`, closing the one gap this doc used to flag here -
every action field now has at least one scenario asserting its real write.

This doc is the catalog of record going forward, replacing the ad hoc numbering that grew up
around individual issue fixes - update it on the next add/remove/renumber, don't let it drift
again. Cross-referenced from `docs/eng-docs/coach-chat-testing.md`.
