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
a `profile_update` immediately for any athlete. It doesn't: `fspIncrementalWrites` (`fspWrites.ts`)
only lets an ordinary turn commit writes while the athlete's profile was still incomplete going
in - once complete, an ordinary turn commits nothing at all, and a `profile_update` only lands on
the next close. This is exactly the kind of gap unit tests in isolation can miss (each
`turnWrites/*` builder looked correct on its own) that only shows up once the layers run wired
together - see the `coach-chat-testing-layers.md` plan's "How the mocked layers stay trustworthy"
section on why the integration test exists at all.
