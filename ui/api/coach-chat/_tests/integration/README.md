# integration

Tests the full turn pipeline in `coachTurn.ts`, wiring layers 1-3 together.

**`fullTurnPipeline.test.ts`** is the one true end-to-end test in this suite: `fetchWithTimeout`
is the only mock, routed between the Gemini and GitHub endpoints. Real prompt building, real
schema-optional field handling, every real `turnWrites/*` builder, and a real
`commitFilesAtomic` blob->tree->commit->ref sequence all run against a fake in-memory GitHub
repo that actually applies committed content, so tests can assert on what really landed. Start
here to see the three layers wired together, and to see #609 (template_edit sentinel) reproduced
end to end.

**`coachTurn.test.ts`** and **`coachTurn-reprompt.test.ts`** mock `commitFilesAtomic` and
`askGemini` directly instead - they check `coachTurn.ts`'s own stage logic (which writes get
built, the text-cap reprompt) without needing a real backend behind them. Faster, but they don't
prove the layers hand off to each other correctly the way `fullTurnPipeline.test.ts` does.

**`activitySyncTurn.test.ts`** covers the separate `activity_sync` action path
(`activitySyncTurn.ts`), same commitFilesAtomic/askGemini mocking style as `coachTurn.test.ts`.

## A real finding from writing this file

`fullTurnPipeline.test.ts`'s first version wrongly assumed an ordinary (non-closing) turn commits
a `profile_update` immediately for any athlete. At the time it didn't: `fspIncrementalWrites`
(`fspWrites.ts`) discarded every ordinary-turn write once the athlete's profile was already
complete going in. Filed as issue #616 (p0) and fixed in A1 of the coach-chat commit redesign -
an ordinary turn now commits its action writes for every athlete, profile complete or not. This
was exactly the kind of gap unit tests in isolation can miss (each `turnWrites/*` builder looked
correct on its own) that only showed up once the layers ran wired together - see
`docs/eng-docs/coach-chat-testing.md`'s "Two different questions" section on why the integration
test exists at all.
