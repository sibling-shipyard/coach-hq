# Coach redesign review — Part 5: wiring everything into coach-chat

> Working doc for review, not a final eng-doc. Stub — this becomes the real plan once Parts 1-4
> are implemented and the new files (`profile.json`, `memory.json`, `injuries.json`,
> `sessions.json`, `seasons.json`, `quests.json`, `progress.json`, `progressions.json`) actually
> exist and are being written to. Per your call: no point deciding coach-chat wiring details on
> paper before the restructure is up and running — this doc is where those decisions get made for
> real, informed by what's actually built, not guessed at now.

## What this covers, once it's real

- Updating `coachPrompt.ts`'s `staticSystemText()`/`buildDynamicText()` (and SOUL itself) to read
  from the new files instead of `state.md`/`challenge_v2.json`.
- Defining exactly what each new file feeds in as input to a turn, and on what cadence (every
  turn, closing-only, on-demand) — this is where Part 7's layering/windowing research
  (`coach-redesign-part7-prompting.md`) actually gets decided, not before.
- Defining what Gemini can write back as output — `memory_update`, `quest_event`,
  `profile_update`, and whatever else Parts 1/2/5 need, each shipped one at a time per the
  existing "add one new field at a time" discipline.
- Wiring `current_week.json` into coach-chat for real (currently has zero read/write path in the
  backend — see Part 3) — including making it a genuine daily update, not the once-per-week
  pattern found in the real `coach-skanda` data.
- The testing plan for all of the above — eval harness coverage per new action/field, live
  verification against `test/close-verification` on `coach-skanda-2003` before anything ships.

## Known items already waiting here

- **`current_week.json` needs to become a genuine daily update, not a once-per-week write.**
  Confirmed via a real live file (`coach-skanda`, commit `a380c6e`) that today's actual practice is
  "written once at week kick-off" despite SOUL's Commit Protocol saying to reconcile it every
  session. Once this file is wired into coach-chat for real, it should update daily.

## Not started

Nothing else here is decided yet. Revisit once Parts 1-3/5 are implemented.
