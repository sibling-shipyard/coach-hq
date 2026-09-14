# Coach chat — test scenario catalog

> Status: Current · Owner: vade-the-tester · Verified: 2026-09-14

## Context

The 2026-09-14 eval-audit pass reviewed all 23 eval transcripts and the simulation-suite
turns library. Numbering had drifted (01, 02, 10, 11, ... 42) from years of ad hoc adds/removes.
Several transcripts were redundant with each other, and most tested one dropped fact per turn
rather than the multi-fact conversations real check-ins actually are. 11 example turns files in
`ui/scripts/examples/` were unused by anything, too. This doc is the catalog of record for both
test libraries going forward — update it whenever a scenario is added, removed, or renumbered.

## Eval transcripts

`ui/api/coach-chat/_tests/coach-chat-eval/transcripts/` — run by `npm run eval:coach-chat`, see
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

**Cut (redundant/subset), not merged:**
- `28-fsp-new-injuries.json` — strict content subset of what's now `08` (same `injury_flag` assertion, `08` also covers the goal/habit case).
- `32-returning-season-change-with-goal.json` — strict content subset of what's now `10` (`10`'s absent-list is a superset that also covers `quest_create`).
- `34-coach-note-absent-filler.json` — its core assertion (`coach_note` optional on filler) duplicates `13`'s turn 3. The extra fields it also asserted absent (`quest_event`, `profile_update`, `memory_update`) aren't tested against any content that could trigger them, so nothing distinct was lost.

**Merged into 14/15/16 above:** `10-quest-event-array`, `11-injury-event-array`,
`33-coach-note-required-with-quest-event`, `37-memory-update-learned-pattern`,
`38-sports-update-new-sport`, `39-returning-coaching-style-explicit-change`,
`40-injury-event-real-id-among-several` — each was a single dropped-fact test. Real check-ins
report several things in one sitting, so these became the multi-turn conversations above instead
of seven separate one-fact files.

## Simulation scenarios

`ui/scripts/run-simulation-suite.ts`'s `SCENARIOS` array — real live-model, real-write runs
through `test:coach-chat-manual`'s pipeline. See `docs/eng-docs/coach-chat-testing.md`'s section on
the fourth test type for mechanics.

| id | file | turns | what it tests | expected files/behavior |
|---|---|---|---|---|
| `fsp-basic` | `manual-coach-chat-turns-fsp.json` | 6 (incl. greet) | full First Session Protocol — profile, goal, injury, training freq, wrap-up | turn 1: `user_data/coach/profile.json`; turn 3: `user_data/coach/injuries.json`; turn 5: PASS |
| `daily-basic` | `manual-coach-chat-turns-daily.json` | 5 (incl. greet) | ordinary daily check-in — weight, hip soreness, a finished run, wrap-up | turn 1: `profile.json`; turn 2: `injuries.json`; turns 3-4: PASS |
| `daily-sleep-skip` | `manual-coach-chat-turns-daily-2.json` | 5 (incl. greet) | ordinary daily check-in — poor sleep, a skipped session, tomorrow's commitment, wrap-up | turns 1-4: PASS |
| `ambiguous-contradiction` | `manual-coach-chat-turns-ambiguous-contradiction.json` | 5 (incl. greet) | new; athlete reports a planned session done, immediately contradicts it, then confirms the real one — checks the coach reconciles rather than double-writing | turn 1: `current_week.json` changed; turn 3: `current_week.json` changed (see the scenario's own code comment for what this can't verify) |

## What replaced what

23 eval transcripts → 16 (3 cut as redundant subsets, 7 merged into 3 realistic multi-turn
conversations, 3 new files added). See "Cut" and "Merged" notes above for the reasoning per file.
`ui/scripts/examples/` dropped 11 unused `-727-*` probe files from the #727 migration. The
original estimate was 2 named plus roughly 8 more; the real count, confirmed unreferenced
anywhere by grep before deletion, was 11. It also gained one new file
(`manual-coach-chat-turns-ambiguous-contradiction.json`).

This doc is the catalog of record going forward, replacing the ad hoc numbering that grew up
around individual issue fixes — update it on the next add/remove/renumber, don't let it drift
again. Cross-referenced from `docs/eng-docs/coach-chat-testing.md`.
