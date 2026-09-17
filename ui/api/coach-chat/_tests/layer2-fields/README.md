# layer2-fields

Tests decision -> file content: the pure appliers (`coachProfileIntents.ts`, `coachInjuryIntents.ts`,
`coachSeasonQuestIntents.ts`, `coachWeekFiles.ts`, `coachWorkoutFiles.ts`, `turnWrites/*.ts`) that take the current JSON plus a parsed action and
produce the next JSON. No network and no git here — these are the most unit-like tests in the
suite, one level below `layer1-gemini/` (the Gemini call itself) and `integration/` (the full
turn pipeline wiring everything together).

See [`../README.md`](../README.md) for how this fits the three-layer split and
[`docs/eng-docs/coach-chat-testing.md`](../../../../../docs/eng-docs/coach-chat-testing.md) for
the full design rationale, including why no prompt or SOUL content is ever built at this layer.
