# turnWrites/

One file per Gemini reply action field (or tight group of fields that land in the same JSON
file). Each file exports a `build*Write` function that takes the relevant slice of a turn's
reply plus repo/token/timezone/traceId, and returns a `FileEntry | undefined` - undefined when
the reply didn't touch that concern.

These wrap the pure appliers in `coachIntents.ts`, `coachWorkoutFiles.ts`, and `coachWeekFiles.ts`
with the I/O (`getFileRaw`) and path/`resolve` wiring `commitFilesAtomic` needs. The appliers stay
pure; this layer is where fetch-then-apply happens.

| File                | Reply field(s)                                | Target file                                              |
| ------------------- | --------------------------------------------- | -------------------------------------------------------- |
| `chatWrite.ts`      | every turn                                    | `chat_history.json`                                      |
| `coachNoteWrite.ts` | `coach_note`                                  | `coach_log.json`                                         |
| `memoryWrite.ts`    | `memory_update`, `sports_update`              | `memory.json`                                            |
| `injuryWrite.ts`    | `injury_flag`, `injury_event`                 | `injuries.json`                                          |
| `questWrite.ts`     | `quest_event`, `quest_create`                 | `progress.json`, `quests.json`                           |
| `seasonWrite.ts`    | `season_start`                                | `seasons.json`                                           |
| `profileWrite.ts`   | `profile_update`                              | `profile.json`, plus the profile-completeness projection |
| `workoutWrite.ts`   | `template_edit`, `session_plan`               | template / session snapshot files                        |
| `weekWrite.ts`      | `week_plan`, `session_reconcile`, `plan_edit` | `current_week.json`                                      |

`coachTurn.ts`'s `buildTurnWrites` calls these in sequence and assembles the results - it owns
turn-level bookkeeping (thread merge, the `profile_update`/`coach_since` resolver merge,
`fspCandidates`/`optionalWrites` assembly), not any single write's content.

New action field on `GeminiReply`? Add a file here, not a branch in `buildTurnWrites`.
