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
- The testing plan for all of the above — eval harness coverage per new action/field, live
  verification against `test/close-verification` on `coach-skanda-2003` before anything ships.

## Known items already waiting here

- **A pile of docs/scripts still describe the entirely-old pre-redesign layout.** Found while
  reorganizing `user_data/ledger/` vs `user_data/coach/`: `platform/soul/B_engine.md`,
  `platform/soul/C_athlete.md`, `platform/scripts/carve-skeleton.mjs`,
  `platform/scripts/provision-user.sh`, `ios/CoachHQ/CoachHQ/Services/GitHubAPIClient.swift`
  (`readChallengeV2()`), `README.md`, and `docs/ref-docs/current-week-contract.md` /
  `season-close.md` / `milestone-schema.md` all still reference `user_data/coach/state.md` /
  `user_data/coach/coach_notes.md` / `user_data/ledger/challenge_v2.json` - the layout Parts 1-3
  replaced. None were updated when those PRs shipped. Confirmed live: the real athlete repo's
  `main` is still on the old layout entirely (`state.md`, `coach_notes.md`, no `profile.json`/etc
  yet) - the Part 1-3 migration scripts have never actually been run against real `main`. A real
  follow-up, not fixed here.
- **`docs/eng-docs/coach-chat-flow.md` is broadly stale, beyond the one section fixed for FSP.**
  Found while wiring First Session Protocol: the whole doc still describes the pre-Parts-1-3
  "reliability-debug strip-down" state (`state.md`/`quest_log.md` throughout, "no file_updates/
  JSON writes beyond the coach_since stamp") - not just the "Completion signal" section (fixed
  here). Left the doc's `Verified:` date unbumped rather than falsely claim the whole thing is
  current - a real rewrite is a separate, larger pass.
- **`plan_edit` can't touch `week.guardrails[]`.** Found live (round-3 week-replanning test): an
  athlete asking to change a guardrail alongside a session swap has no structured field for it -
  `plan_edit` only edits one day's session content. Follow-up once real athlete asks surface how
  often this matters.
- **Free-form template/session edits beyond the structured shapes built for `template_edit`/
  `session_plan`.** Today those two action fields only support `skip_exercise_nums` (structured
  skip-by-number), no free-form insertion/reordering. Follow-up once the structured version is
  live and its real limits are visible.
- **Regenerating templates for existing athletes (`coach-skanda`, `coach-akash`).** The
  generic-library template pipeline only applies going forward — a possible future one-time
  backfill, not required for the pipeline itself to work.
- **Migration script for workout-backend-wiring's changes.** No migration script exists yet for
  the `_manifest.json`/schema additions this branch introduces — nothing here retrofits existing
  athlete data on its own (deliberate — new pipeline only, see above), but a Part 1/2/3-style
  script may still be worth writing so an existing athlete's real templates/`current_week.json`
  can adopt the new bookkeeping (`_manifest.json`, `trace_id`, etc.) without waiting on a live
  chat turn to trigger it.
- **Async closing — don't make the athlete wait on the commit.** Raised during workout-backend-
  wiring's live verification: today the athlete's HTTP request blocks on the full closing
  pipeline (Gemini call(s) + every write + the GitHub commit) before they see a reply at all —
  worse when an action field triggers a second Gemini call (`template_edit`'s content generation,
  `generateInitialTemplates`), since both calls have to succeed before anything returns. Proposed
  split: keep the reply synchronous (one Gemini call, same as today), but detach the actual
  write/commit/retry work to run in the background the moment that reply comes back — the athlete
  never sees "saving" or a failure, same as they'd never see it today if everything just worked.
  Vercel's `waitUntil` is the natural mechanism (extends execution past the returned response for
  a bounded time) — this pipeline's existing atomic-commit + upsert-by-id discipline (Parts 1-3
  onward) is a good sign it's safely retryable, not a rewrite. Open questions before building:
  `waitUntil`'s actual time cap vs. worst-case turn latency (a `template_edit` chain), and what
  happens on the rare case a background write still fails after every retry (silent forever, or
  does it need to surface next time the athlete opens the app).
- **`platform/scripts/carve-skeleton.mjs` regeneration.** The skeleton (`.skeleton-push/` →
  `coach-skeleton`) hasn't been re-run since workout-backend-wiring landed — it's a mechanical,
  low-risk regen, just needs doing once this branch's code is settled.

## Not started

Nothing else here is decided yet. Revisit once Parts 1-3/5 are implemented.
