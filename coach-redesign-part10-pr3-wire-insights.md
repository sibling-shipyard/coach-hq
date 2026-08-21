# Part 10 / PR 3 — wire athlete insights into coach-chat context

Stacked on `coach-redesign-part9-pr2-generators-and-insights.md`'s branch. Branch off that PR's
tip. Should be short and low-risk once PR 2's output shape (`gen/athlete_insights.json`) is
settled — this PR only reads it, it doesn't design it.

## Context

Confirmed via research this session: the hosted coach-chat app has **zero read path into activity
history today**. `loadCoachContext()` (`ui/api/coach-chat/_lib/coachChatFiles.ts`) fetches exactly
8 files in parallel — `profile.json`, `memory.json`, `injuries.json`, `coach_log.json`,
`seasons.json`, `quests.json`, `progress.json`, `progressions.json` — none of them activity
history. PR 2 produces `gen/athlete_insights.json`; this PR makes it the 9th fetch and renders it
into the prompt.

## Scope

1. **`coachChatFiles.ts`**: add a 9th parallel `getFileRaw` call for `gen/athlete_insights.json`
   alongside the existing 8, same pattern (`parseJsonOrNull`). A missing or malformed file (new
   athlete, first sync hasn't run yet, or an athlete with no activity history at all) must degrade
   to "no insights available" — never error the turn. Add the parsed result to whatever context
   object `loadCoachContext` currently returns (matching how `coachLog`/`seasons`/etc. are already
   threaded through).

2. **`coachContext.ts`**: add a new compact rendered section, same style as
   `recentSessionNotesSection()` — a few lines per sport, not a JSON dump. Something like:

   ```
   ## Fitness Snapshot (last 12 months)
   - Badminton: ~3x/week, no gap longer than 9 days, last session 2 days ago.
   - Running: sporadic, longest gap 6 weeks, last session 11 days ago.
   ```

   Wire it into `renderCoachContext()` alongside the existing sections. Omit the section entirely
   (not an empty header) when there are no sports in the insights file or the file is absent.

3. This unlocks two things that don't work today:
   - **Ordinary daily chat** can now reference real season-long consistency, not just what's in
     the last 5 `coach_log` rows (PR 1's window).
   - **FSP's "if history exists, reflect it back instead of asking cold" instruction** becomes
     real for hosted chat for the first time (it was always BYOB-only, since hosted chat had no
     activity-history read path). The actual prompt/SOUL wording update for this is PR 4's job —
     this PR only makes the data available to reference; don't touch `coachPrompt.ts`'s FSP
     branches or any SOUL file here.

## Verification

- Unit test: `loadCoachContext` degrades correctly when `gen/athlete_insights.json` is
  absent/malformed — confirm the turn still completes normally, no error surfaced to the athlete.
- Unit test: the new context section renders correctly for a populated insights file and is
  cleanly omitted (not blank/empty-header) when there's nothing to show.
- `cd ui && npx tsc --noEmit`, `npm test -- --run` clean.
- Live scratch-branch test: an athlete repo with `gen/athlete_insights.json` present (from PR 2's
  generator having run against real history) shows the snapshot section in a real rendered prompt
  context; a fresh/empty-history athlete gets no section, not a broken one. Follow the
  verification discipline in `coach-redesign-part4b-fsp-reliability.md` — check the real API
  response / actual context string, not just that code compiles.

## PR

Branch off PR 2's tip. Title something like `core: read athlete fitness insights into coach-chat
context`. Body: what's fetched, how it renders, and explicitly note that the FSP/SOUL wording
update using this data is deferred to the next (SOUL) PR in the stack. Leave open for review.
