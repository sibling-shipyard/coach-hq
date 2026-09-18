# `_lib/decide/` — the decision layer

This is the middle stage of coach-chat's turn flow (see the diagram in
[`../../README.md`](../../README.md)): Gemini has already returned its structured reply, and
everything here turns that reply into validated, ready-to-write file content. No network call and
no git commit happen in this folder — those are `llm/` (the Gemini boundary) and `commit/`
(the atomic write path) respectively.

"Decide" means: given a parsed `LlmReply` and the athlete's current files, work out exactly
what changed and produce the next JSON for each affected file. The appliers here stay pure
(current state in, next state out); `turnWrites/` wraps them with the actual file reads and
`FileEntry` assembly `commitFilesAtomic` needs.

| File                            | Responsibility                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| `coachChatFiles.ts`             | Read bundled SOUL and athlete context files; in-flight/60-second cache                     |
| `coachMemoryFiles.ts`           | Paths and types for profile, memory, injuries, and coach log                               |
| `coachQuestFiles.ts`            | Paths and types for seasons, quests, progress, and progressions                            |
| `coachContext.ts`               | Render the athlete/season/quest/milestone prompt sections                                  |
| `coachDay.ts`                   | Timezone dates, thread offsets, and `coach_since` day-number math                          |
| `coachFirstSessionBenchmark.ts` | First Session benchmark data handling                                                      |
| `coachProfileIntents.ts`        | Apply profile, memory, coaching-style, availability, sports, and coach-log actions         |
| `coachInjuryIntents.ts`         | Apply injury flag/event actions                                                            |
| `coachSeasonQuestIntents.ts`    | Apply season-start, quest-create, and quest-event actions                                  |
| `coachWeekFiles.ts`             | Validate and apply full week plans, session reconciliation, dated edits                    |
| `coachWorkoutFiles.ts`          | Select/generate templates; validate template edits and today's modified session            |
| `coachSinceStamp.ts`            | Stamp `coach_since` once when First Session completes                                      |
| `activitySync.ts`               | Activity-sync batch id, hist lookup, and attachment rows                                   |
| `onboardingWrites.ts`           | Normalize native onboarding hints, suppress duplicate greet commits                        |
| `firstWeekCompile.ts`           | Compile the First Session's initial week plan                                              |
| `todayActivityNotes.ts`         | Today's activity notes for prompt context                                                  |
| `workoutSchema.ts`              | Structural runtime validation for workout/template JSON                                    |
| `turnWrites/`                   | One write-builder per `LlmReply` action field — see its own [README](turnWrites/README.md) |

Full turn lifecycle: [`coach-chat-flow.md`](../../../../../docs/eng-docs/coach-chat-flow.md).
