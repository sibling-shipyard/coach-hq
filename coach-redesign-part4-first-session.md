# Coach redesign review — Part 4: First Session Protocol changes

> Working doc for review, not a final eng-doc. Stub — deferred, per your call. Parts 1-3 are
> reviewed on paper but not implemented yet, and SOUL itself (`platform/soul/*.md`) will need real
> changes once the restructure is actually running, not just this file's schema. Come back to this
> — and to Part 5 (wiring plan) and Part 7 (prompting) — once Parts 1-3 are implemented and
> working, not before.

## Why this is last

First Session Protocol is the one place that writes `profile.json` (and touches `memory.json`,
`sessions.json`) in full. Every field decision in parts 1-3 changes what FSP has to ask for,
validate, and write, and in what order. This doc exists to walk through that once the shape of
those files is settled, not before.

## To fill in once parts 1-3 are annotated

- What FSP asks the athlete for, mapped against the final `profile.json` fields (currently:
  `name`, `dob`, `timezone`, `coach_since` — pending part 1's other moves landing).
- What FSP writes to `memory.json` on completion (`sports`, `goal`, `timeline`, `coaching_style`
  per part 1's annotation, plus anything part 2's `quests.json`/`seasons.json` writes add).
- How `isAthleteProfileComplete()` / `REQUIRED_PROFILE_FIELDS` (the #362 fix) maps onto the new
  file split — which fields actually gate "is this athlete onboarded," now that profile.json is
  much smaller.
- Any changes Akash made to SOUL's First Session Protocol section that this doc needs to reconcile
  against.

## Questions raised while scoping this — answer when we come back

Mapped the real current FSP flow (SOUL `B_engine.md` §10) against Parts 1-2's settled shapes.
Most of it translates cleanly (name → `profile.json.name`, sports → `memory.json.sports`, goal →
`memory.json.goal`, injuries → `injuries.json.flags[]`, etc.) — four things need your call before
this doc gets written for real:

1. **Age/height/weight intake line.** SOUL asks "Age, height, and weight" today; `profile.json`
   now stores `dob`, not `age`. Ask for a real birthdate directly, or keep asking age and
   approximate a `dob` from it?
2. **`quests.json`'s `source` field** (`"model" | "athlete"`) — what value do FSP-created quests
   get? They're the athlete's stated goals, but Coach writes the file.
3. **Season/phase step.** SOUL says "Define the current Season **and phase**" — Part 2 dropped
   phase entirely. Does the intake question change, or just quietly stop writing a `phase` field?
4. **Commit step.** Today commits `state.md` + `challenge_v2.json` together. New version touches
   5 files (`profile.json`, `memory.json`, `injuries.json`, `seasons.json`, `quests.json`) —
   confirm still one atomic commit, all five, same pattern as today's two-file commit.
5. **BACKLOG.md #1 — `wasProfileComplete`/`profileComplete` transition is dead.** Both sides of
   the false→true check in `coach-chat.ts` (~line 366) are computed from the same pre-turn
   `profile`/`memory` objects, so the transition `injectCoachSinceIfNeeded` (and, as of
   `core/workout-backend-wiring`, the post-first-session template-generation hook) waits for can
   never actually fire. Needs `profileComplete` to be computed from the post-write state once FSP
   really writes `profile.json`/`memory.json` in this flow. `coach_since` has never once been
   auto-stamped in the current codebase because of this — fix it here when FSP gets wired for
   real, not before.

## Your annotations

(space for your changes)
