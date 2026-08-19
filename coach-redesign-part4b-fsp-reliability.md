# First Session Protocol, take two: redesign for reliability (Part A) + End Conversation button (Part B)

> Not implemented yet. Written after PR #431 shipped and live testing found a real reliability
> gap. Review and implement when ready - stacks on top of #431 per the sequencing note below.

## Implementation progress — Part A (2026-08-19)

**Status:** built and unit-tested on `core/fsp-reliability-part-a`; full live FSP verification is
in progress. No commit or PR yet because the required live gate has not completed.

- [x] Branched Part A from `core/first-session-protocol-wiring` at `978cb0e`.
- [x] A1: native name, sports, and coaching style write directly on greet; goal removed from iOS
  onboarding and remains a chat question.
- [x] A2: ordinary FSP turns atomically persist profile, memory, injury, season, and quest actions;
  returning-athlete and transcript/workout writes remain close-only.
- [x] A3: completeness now requires full profile fields, sports, coaching style, and a matching
  current season; quests remain optional.
- [x] Added the iOS coaching-style step between Season and Sync.
- [x] Updated the chat-only FSP horcrux and docs. `platform/SOUL.claude.md` has zero diff.
- [x] Independent checks: `npx tsc --noEmit` clean; full Vitest suite 25 files / 320 tests passed
  before live-test fixes. Worker rerun after both fixes: 26 files / 324 tests passed.
- [x] Live testing found and fixed a stale-context bug: the next turn could reuse the pre-greet
  profile cache and re-ask native fields. Cache invalidation now has a regression test.
- [x] Live testing found and fixed retry duplication: Gemini overload retries created five
  identical onboarding commits on scratch branch `fsp-part-a-live-20260819`. Corrected branch
  `fsp-part-a-live-20260819-v2` created exactly one onboarding commit despite repeated retries.
- [x] First incremental ordinary turn verified through the GitHub API on the corrected branch:
  commit `733e305f006142c0a8d462b30534ec60d51b28f5` changed only `memory.json` and `quests.json`;
  fetched contents contain the stated fitness baseline, native sports/style, and Sub-25 5K quest.
- [x] Reviewer (independent pass, not from the builder's report): re-ran `tsc --noEmit` and the
  full suite, re-confirmed `SOUL.claude.md` zero-diff, read every diff line by line, ran a fresh
  live conversation on a new scratch branch (`core/verify-fsp-part-a` then `-v2`).
- [x] **Reviewer found and fixed a third real bug**, not caught by the builder's own testing:
  `injectCoachSinceIfNeeded` (`coachWrites.ts`) still targeted `user_data/ledger/challenge_v2.json`
  - the file Part 2's ledger split deleted months ago. `coach_since` actually lives in
  `profile.json` (the field already exists in `ProfileJson`) but was never migrated when that
  redesign landed. This transition was dead code until Part A made it reachable, so the wrong
  target never surfaced until live-tested here. Fixed `loadClosingFileContext`/
  `injectCoachSinceIfNeeded` to target `PROFILE_PATH`, and fixed a second-order collision it
  created: on the exact turn that completes the profile, `injectCoachSinceIfNeeded`'s stamp and
  `profileUpdateWrite` both target `profile.json` - folded the stamp into `profileUpdateWrite`'s
  own `resolve()`, applied after its transformation (not before, or the profile fields would be
  lost), instead of two separate `FileEntry` writes to the same path. Rewrote the pre-existing
  `coach-since.test.ts` describe block, which had been asserting the wrong (old) target the whole
  time. 26 files / 324 tests still pass; `SOUL.claude.md` still zero-diff.
- [x] Fresh live conversation through name → sports/style (greet) → fitness baseline/goal/season →
  dob/height/weight/timezone → close, verified via the GitHub API at every step on scratch branch
  `core/verify-fsp-part-a-v2`:
  - Greet commit: `profile.json.name` + `memory.json.sports`/`coaching_style` landed before any
    Gemini reply, zero LLM involvement (A1).
  - Ordinary turn: `memory.json.notes.fitness_baseline` + `seasons.json` (real season, real id,
    `current_season_id` set) landed on a `closed: false` response (A2 - incremental, not held for
    close).
  - The exact turn that completed the profile (`dob`/`height_cm`/`weight_kg`/`timezone`, all in
    one message) produced commit `ffc15c6a` containing `profile.json` with **all four fields AND
    `coach_since: "2026-08-19"` in the same write** - confirming the bug above is genuinely fixed,
    not just unit-tested.
  - Immediately followed by a second, separate commit (`1d6a3399`) with 7 real generated workout
    template files + `_manifest.json` - the post-completion template-generation hook (A3's
    transition) fired correctly too.
- [x] All independent checks green: `tsc --noEmit` clean, 324/324 tests, `SOUL.claude.md` zero-diff
  reconfirmed after the coach_since fix.
- [x] Committed and pushed to `core/fsp-reliability-part-a`, PR opened against
  `core/first-session-protocol-wiring` (#432).
- [x] Live-tested the remaining piece: habit quests (`quest_create`) and an actual close on the
  completed-profile athlete, on an isolated `git worktree` at #432's committed tip (not the
  shared working directory - Part B was already in progress there) against a fresh scratch data
  branch. Mixed result, reported honestly rather than marked fully passing:
  - **Close mechanism confirmed working.** Sent "...that's everything, let's wrap this up" on the
    completed-profile athlete: `session_closed: true` came back, a real commit landed
    (`9d1a8592`), `chat_history.json`/`coach_log.json` both updated. A redundant `profile_update`
    (Gemini re-sent `dob` with the same value already on file) correctly produced **no diff** in
    the commit - `applyProfileUpdate` output was byte-identical, git saw nothing to write, exactly
    right.
- [x] **`quest_create` gap root-caused and fixed - was a real code defect, not just prompt
  flakiness.** Two layered bugs, found by tracing why a focused closing-turn instruction still
  didn't fire in a live re-test:
  1. `buildDynamicText`'s ternary checked `mode === "closing"` before `firstSessionTurn`, so a
     turn that both closed and was mid-FSP got the fully generic ~15-paragraph closing block
     (covering irrelevant returning-athlete fields like `template_edit`/`week_plan`), with
     `quest_create` buried as one bullet among many. Fixed with a dedicated
     `mode === "closing" && firstSessionTurn` branch ahead of the generic one, with an explicit
     "LAST CHANCE" checklist calling out `quest_create` by name.
  2. Deeper bug: that new branch still didn't fire in re-testing, because `firstSessionTurn` was
     already `false` by the closing turn - `isAthleteProfileComplete()` (the sole gate behind
     `firstSessionContext()`) had already flipped `true` on the *previous* turn, the moment dob/
     height/weight/timezone landed, before quests were ever discussed. Quests are deliberately
     excluded from that completeness bar (A3), but that same bar was also the only signal
     deciding whether `<first_session>` prompt guidance kept showing at all - so it silently
     stopped the instant profile/sports/style/season were done, cutting off SOUL's own Step 4
     (quest setup) before it could run. Fixed with a new, narrower `isFirstSessionRitualDone()`
     (`coachChatFiles.ts`) used only at the two `firstSessionContext()` call sites in
     `coach-chat.ts` - identical to `isAthleteProfileComplete()` plus `quests?.main_quest` set.
     Bounded, not open-ended: `main_quest` is meant to be set exactly once per athlete, so this
     naturally resolves to `false` forever once it happens, same guarantee the other fields
     already have - an athlete who declines quests entirely isn't stuck in FSP mode permanently,
     they just see the reminder once on their close.
  - Live-verified end-to-end on a fresh scratch branch (`core/verify-questfix2`, deleted after):
    ran the exact previously-failing conversation (name/sports → dob/height/weight/timezone/
    style/season, completing the profile mid-conversation → goal + two habits + "let's wrap this
    up" on the same closing turn). Confirmed via the real GitHub commit, not reply text -
    `quests.json` now contains `main_quest` ("Reach tournament quarterfinals") plus both stated
    habit quests (daily stretching, bed by 10pm), all created on the same turn that closed the
    session.
  - Added unit coverage: `isFirstSessionRitualDone()` in `coachChatFiles.test.ts` (true only once
    both profile-complete and `main_quest` exist; false if either is missing), plus the existing
    focused-closing-checklist tests in `first-session-injection.test.ts`. 329/329 tests green,
    `tsc --noEmit` clean.

## Orientation, for whoever implements this (no prior context assumed)

**Branching - read this before creating anything.** Both PRs in this doc MUST stack on top of
PR #431 (`core/first-session-protocol-wiring`), not on `main`. Concretely:
```
git checkout core/first-session-protocol-wiring && git pull origin core/first-session-protocol-wiring
git checkout -b core/fsp-reliability-part-a   # Part A branches off #431's tip
# ... after Part A is built, tested, and its own PR opened against base core/first-session-protocol-wiring ...
git checkout -b core/fsp-end-conversation-part-b   # Part B branches off Part A's tip, not off #431 directly
```
Open Part A's PR with `--base core/first-session-protocol-wiring` (not `main`) via
`gh pr create --base core/first-session-protocol-wiring ...`. Open Part B's PR with
`--base core/fsp-reliability-part-a`. This repo is squash-merge only
(`gh api repos/sibling-shipyard/coach-hq --jq '.allow_squash_merge'` confirms) - after #431
eventually merges, GitHub auto-retargets Part A's base to `main`, but Part A's own history
predates that and needs `git rebase --onto <new-main-sha> <old-431-tip-sha>` at that point (only
replay the commits genuinely unique to Part A, not #431's whole history) - the exact recipe used
tonight for a very similar situation is in `.github/CONVENTIONS.md`'s "Stacked PRs" section,
rule 2. Don't worry about this until #431 actually merges.

**Repo conventions that matter for every commit:**
- First-person, plain prose commit messages, no em dashes (use a hyphen), explaining *why* not
  just what - read `git log --oneline -20` for tone before writing the first commit.
- Never add `Co-Authored-By: Claude` (or any AI attribution) to a commit or PR body.
- Run `cd ui && npx tsc --noEmit && npm test -- --run` clean before every commit - this repo has
  292+ passing tests as of #431 and treats a regression there as a real blocker, not a nitpick.
- Test files mirror existing patterns exactly - before adding a test, read a few existing
  `describe` blocks in the same file for the fixture/assertion style, don't invent a new style.

**Live-testing discipline - this is not optional, and it's what actually caught the bug this
whole doc exists to fix.** Never declare a change "done" from unit tests and typecheck alone.
Every claim about what a Gemini turn produces or what lands in a file must be verified against a
REAL commit on a REAL scratch branch of the athlete's actual data repo
(`skanda-2003/coach-skanda-2003`), fetched back via the GitHub API - never trust the HTTP
response's `reply` text or a `session_closed`/`closed` flag as proof something committed; check
the actual file content before and after. The exact working pattern used all of tonight:

1. Fork a scratch data branch off a real base: `gh api repos/skanda-2003/coach-skanda-2003/git/refs -f ref=refs/heads/<scratch-name> -f sha=<base-sha>`. For a true first-session test you need a
   branch with NO `profile.json`/`memory.json`/`seasons.json`/`quests.json`/`injuries.json` yet -
   confirmed as of tonight that real `main` on that repo is still in exactly that state, so forking
   directly off `main` gives a genuine cold-start athlete.
2. Start the local API server against the CODE branch under test (not the data branch):
   `cd ui && PORT=<free port> COACH_CHAT_BRANCH=<scratch-data-branch-name> npm run dev:api`
   (needs `GEMINI_API_KEY` in `ui/.env.local`, already present in this environment).
3. Send real turns via curl: `Authorization: Bearer $(gh auth token)` +
   `X-Coach-Repo: skanda-2003/coach-skanda-2003` headers, POST to
   `http://localhost:<port>/api/coach-chat` with `{messages, message}` (see
   `ui/api/coach-chat.ts`'s top-of-file comment for the exact request/response shape). Gemini has
   been heavily overloaded (frequent 503s) all night - retry with backoff (5-10 attempts, growing
   delay) INSIDE one shell command/tool call rather than ending your turn and expecting to be
   "resumed" - nothing resumes an agent faster than the agent just waiting itself.
4. After a turn that should have committed, verify via
   `gh api repos/skanda-2003/coach-skanda-2003/commits/<sha>` (`.files[].filename` for what
   actually changed) and `gh api repos/skanda-2003/coach-skanda-2003/contents/<path>?ref=<branch>`
   (base64-decode `.content`) for the real file content - compare against what the reply claimed.
   A mismatch between the two is exactly the class of bug this whole redesign exists to catch -
   report it plainly if found, don't paper over it.
5. Kill the local server when done (`lsof -ti:<port> | xargs -r kill`) and leave scratch data
   branches around for the reviewer to independently re-check rather than deleting them.

**Two known traps from tonight, specific to this codebase, worth internalizing before touching
anything:**
- `platform/soul/*.md` composes into TWO different runtime builds (`compose-soul.mjs`) -
  `SOUL.chat.md` (this task's target) and `SOUL.claude.md` (BYO Claude Code terminal builds - a
  completely different write mechanism, git-commit-based, not touched by this doc at all). After
  any SOUL edit + `node platform/scripts/compose-soul.mjs`, run `git diff --stat` and confirm
  `platform/SOUL.claude.md` shows **zero diff** before committing - if it shows a diff, something
  leaked into the wrong build target.
- The close-signal detection (`ui/api/coach-chat/_lib/closeSignal.ts`) is a plain regex, not an
  LLM judgment call, specifically because Gemini's own `session_closed: true` was observed
  claiming a close that the server then silently discarded when the regex didn't also agree - this
  exact bug (missing `"wrap this up"` phrasing) was found and fixed tonight
  (`ui/api/coach-chat/_tests/close-signal.test.ts` has the regression tests). Part B's whole
  purpose is giving athletes a way to bypass this regex being right at all.

## Context

PR #431 (branch `core/first-session-protocol-wiring`) wired FSP's missing write paths and fixed
the dead `profileComplete` transition, but live end-to-end testing found a deeper architectural
problem: because nothing commits until the closing turn, Gemini has to correctly restate *every*
fact gathered across a 5-6 turn conversation in one final structured reply - and in real testing
it didn't (only `sports_update` landed; name/dob/height/weight/coaching_style/season/quests were
all discussed but never committed, despite the reply claiming "everything is locked in").
Separately, the close-signal regex missed `"wrap this up"` (fixed and confirmed live already,
committed on the same branch) - but that whole class of bug (natural-language close detection) is
fragile by nature, which motivated the second idea below.

Two genuinely separate redesigns, per explicit direction to split them:

- **Part A**: make FSP resilient by writing facts as they're given, not saved up for one big
  final restatement - plus move every screen-collectible field (name, sports, coaching style) to
  a direct, deterministic write instead of routing through Gemini as a "hint" it has to remember
  and restate. Drop the goal field from the iOS screen added during #431; goal moves to chat.
  Expand what "profile complete" means now that the intake is richer.
- **Part B**: an explicit "End Conversation" button on both platforms that sets a deterministic
  server-trusted flag instead of relying on natural-language close-phrase detection at all for
  that path - permanently removes the regex-fragility class for anyone who uses the button, while
  typed close phrases keep working via the existing regex for anyone who doesn't.

---

## Part A: FSP reliability redesign

### A1. Screen-collected fields become direct, deterministic writes - not Gemini hints

Today `OnboardingHints` (name, sports, goal) are cached client-side and sent once on `greet()` as
*context* - Gemini is expected to reflect them back conversationally and then **restate them as
action fields on the eventual close** for them to actually commit. That restatement is exactly
what failed live tonight.

New design: anything the athlete already answered on a native screen gets written directly,
deterministically, server-side, the moment it's available - no LLM involvement, no waiting for a
close. Concretely:
- On the first request of a session where `onboardingHints` is present (currently only checked in
  `handleGreet`, `ui/api/coach-chat.ts:102`), if `name` and/or `sports` are present, call
  `applyProfileUpdate`/`applySportsUpdate` directly and commit immediately - a small, separate
  atomic commit, same pattern `injectCoachSinceIfNeeded`'s own commit already uses, but triggered
  by hint presence, not a close signal.
- SOUL's chat-only FSP text (`platform/horcruxes/first-session.md`, sourced from `B_engine.md`'s
  `s10_first_session_chat_*` keys) stops saying "skip asking if hints are present" and instead
  says these facts are **already recorded** - Coach can reference them warmly but must never
  re-ask or re-request confirmation via an action field (the field's already committed by the
  time Gemini sees the conversation).
- **Coaching style also becomes a screen field**, following the same direct-write path - a new
  native screen (3-way pick: accountability/encouragement/analysis) added to the onboarding flow,
  `OnboardingHints` gains a `coaching_style` field alongside name/sports, written directly via
  `applyCoachingStyleUpdate` the same way.
- **Drop the goal `TextField` added to `SeasonStepView` during #431** - revert that specific UI
  addition. Akash left it out of the original build for a reason; goal moves back to being purely
  a chat question, mapped to `quest_create`'s `main_quest` like the rest of the SOUL text already
  says.

Where the new coaching-style screen goes in the flow (after `SeasonStepView`, before
`SyncStepView`, matching the existing reveal-flow step pattern) and its exact visual treatment -
implementation detail for the iOS pass, not decided here.

**Coach still greets the athlete by name, without a same-request re-read of `profile.json`.** The
direct write and the greeting text are two different things - on the very first `greet()` call,
the commit that writes `profile.name` happens as its own atomic write, but Gemini's greeting-mode
call in that same request can't read back a file it hasn't finished committing yet. Fix:
`onboardingHintsContext()` (`ui/api/coach-chat/_lib/coachPrompt.ts:673`) already surfaces
sports/goal hints as prompt context for the opener - extend it to include `name` too, so Gemini's
very first message can genuinely say "Hey Skanda" instead of a generic "champ," sourced from the
hint directly, independent of whether the write has landed. Every later turn reads the real
committed `profile.json` normally via `loadCoachContext`, same as today - this is only about the
opening message in the same request as the first-ever write.

**Starting-state gap to fix as part of this, not a new discovery mid-build:** the backend
`OnboardingHints` interface (`coachPrompt.ts:668-670`) currently only declares `sports`/`goal` -
**no `name` field at all**, even though iOS is already sending `name` in the greet JSON body (a
separate change made earlier, before this doc). Adding `name?: string` to this interface and
surfacing it in `onboardingHintsContext()` is a prerequisite this section needs, not optional.

### A2. Incremental writes during the chat portion of FSP

Try the simple version first (same single Gemini call already generates the reply; ordinary turns
during FSP get permission to commit immediately using the existing action fields, instead of only
closing turns) - fall back to a dedicated small extraction call per turn only if live testing
shows the single-call version doesn't reliably produce action fields on ordinary (not just
closing) turns.

Per research done on `ui/api/coach-chat.ts` (verified against the actual file as of commit
`978cb0e`, the tip of `core/first-session-protocol-wiring` when this doc was written - re-check
line numbers if they've since drifted), this is real restructuring, not a small gate move:
- The early return is exactly:
  ```ts
  const closing = closeIntent && reply.session_closed === true;   // line 252
  if (!closing) {                                                  // line 254
    return Response.json({ reply: reply.reply, closed: false, repoSha: currentSha, stale });
  }                                                                 // line 264
  ```
  Every `optionalWrites` block (`memoryFileWrite` starts ~line 350, `profileUpdates` is computed
  at line 424, `sportsUpdate`/`hasSportsUpdate` at lines 325-326) currently sits below line 264 -
  all of it is unreached on an ordinary turn today.
- `memoryFileWrite`/`injuryEventWrite`/`questEventWrite`/`profileUpdateWrite` (the fields A1/A2
  actually need: `profile_update`, `sports_update`, `memory_update`, `coaching_style_update`,
  `injury_event`, `season_start`, `quest_create`) are each already self-contained closures not
  referencing close-only state - these four are close to reusable as-is once hoisted above the
  gate.
- `templateEditWrite`/`sessionPlanWrite`/`currentWeekWrite` depend on `validTemplateIds`/
  `currentWeekRaw`, currently lazily fetched only `if (closeIntent)` - **not needed for FSP at
  all**, leave these closing-only, don't touch their gating.
- `chatWrite` (the full committed thread) and the closing-thread-assembly logic are close-specific
  by design and should stay that way - an FSP ordinary-turn commit is a separate, smaller
  `commitFilesAtomic` call (just the FSP-relevant `optionalWrites`), not a relaxation of the
  existing close-turn commit.

Concrete shape: a new predicate, something like
`const fspWriteAllowed = !isAthleteProfileComplete(profile, memory)` (true only during first
session, false for every returning-athlete turn - daily chat keeps its existing
single-commit-on-close behavior unchanged). When true, build and fire a second, FSP-scoped
`commitFilesAtomic` call using just the profile/memory/injury/season/quest `optionalWrites`
blocks, on every turn (ordinary or closing) where any of those fields are present in Gemini's
reply - independent of whether this turn also happens to close the session.

Gemini's schema/prompt: confirm (via live testing) that Gemini already emits these fields on
ordinary-mode turns when relevant (the schema itself doesn't appear to be mode-gated per the
research), or add explicit prompt instruction if it's holding back because the "closing turns
only" language in a few field comments discourages it during FSP specifically.

### A3. Expand "profile complete"

Complete means `profile.json` fully filled (`name`, `dob`, `timezone`, `height_cm`, `weight_kg`
all non-null) + `memory.json.sports` non-empty + `memory.json.coaching_style` set (one of the
three real enum values, not `null`) + a current season exists in `seasons.json`
(`current_season_id` set, matching season present). Quests optional - `quests.json` having no
`main_quest` yet does NOT block completeness. Update `isAthleteProfileComplete()`
(`ui/api/coach-chat/_lib/coachChatFiles.ts:193-198`) to take `seasons: SeasonsJson | null` as a
third parameter and check all of the above; update both call sites (`coach-chat.ts:102,235`) and
the in-memory projection built for the fixed transition (`coach-chat.ts:593-619` as of #431) to
project `seasons` the same way `profile`/`memory` are already projected. Confirm with a live test
that a real first session now correctly stays "incomplete" until season is set, even if
name+sports+coaching_style landed early via A1's direct writes.

---

## Part B: End Conversation button (iOS + web)

Explicit flag, not a fake typed message - `endConversationRequested: true` in the POST body,
ORed into `closeIntent` (`coach-chat.ts:185`) alongside the existing
`isCloseSignal(trimmed) || wasCloseAttemptPending(priorMessages)` check. Everything downstream
(the actual close decision, `reply.session_closed`, Gemini's ability to ask a follow-up instead of
closing) stays exactly as it works today - the button only guarantees `closeIntent` is true
deterministically, it doesn't force a close outright.

**New UI on both platforms, placed directly next to the send button** - confirmed via research
that neither platform has any existing end-conversation affordance to repurpose (the one
candidate, iOS's `CoachChatAPIClient.setThreadStatus`/`PATCH`, is dead code - the server only
implements `GET`/`POST`, nothing calls it - remove it rather than leave it as a red herring):
- **Web**: in the composer (`CoachChatWidgets.tsx`, the send button is at lines 308-315) - a new
  "End Conversation" button sits immediately to the right of the existing send button, same
  size/height as it (mirror its exact padding/sizing classes so the pair reads as one control
  group, not two mismatched buttons). Threads a flag through `appendUserMessage`
  (`CoachChat.tsx:254`) into `sendMessage` (`coachChatModel.ts:229-257`), added to the POST body
  built at `coachChatModel.ts:240`.
- **iOS**: in the composer area, next to the existing send action (`CoachChatView.swift:306-309`)
  - same placement rule, immediately to the right, same size as the send button. Threads through
  `send(from:)` (`CoachChatView.swift:589-664`) into `CoachChatAPIClient.sendMessage`
  (`CoachChatAPIClient.swift:205-225`), added to the request body dict at line 211.

**Gating during FSP - decided, not deferred.** The button's enabled state binds to the expanded
`isAthleteProfileComplete` (A3) value, and both platforms need it kept live during the
conversation itself, not just at launch-time routing:
- Both platforms already fetch a `profileComplete` boolean once at launch via
  `GET coach-chat-profile-status`, used for routing (`shouldOpenChatFirst()` on iOS). That's the
  initial button state, but it goes stale the moment A2's incremental writes start landing
  mid-conversation - a launch-time value alone isn't enough.
- Fix: extend the ordinary-turn POST response shape (`coach-chat.ts:254-263`'s
  `{reply, closed:false, repoSha, stale}`) to also include a fresh `profileComplete` value,
  computed the same way the closing path already computes it (via the post-write projection A2's
  commits produce) - not just the closing response's shape. Both platforms update the button's
  enabled/disabled state from `profileComplete` on **every** response they receive (greet,
  ordinary, or closing), not only at initial launch. Starts disabled by default until the first
  real value arrives (matches "unavailable during FSP" - an athlete who hasn't even gotten a
  first response yet has nothing to end).
- Once `profileComplete` flips true in any response (which, with A1+A2, can now happen mid-FSP
  rather than only at a close), the button enables immediately without the athlete needing to
  send another message first.

---

## Sequencing

Stack these PRs with #431. Branch `core/first-session-protocol-wiring` (#431) is the base - Part A
branches directly off it (not off `main`), same `.github/CONVENTIONS.md` stacked-PR pattern the
rest of this redesign already used. Build and live-test Part A first (it's the one with an active
reliability bug found live). Part B branches off Part A's tip (needs A3's expanded
`isAthleteProfileComplete` and A2's ordinary-turn `profileComplete` response field for its gating
mechanism above) - so the real stack is #431 → Part A → Part B, merged bottom-up.

## Verification

- Part A: same live-testing discipline as the rest of this redesign - fresh scratch athlete
  branch, real Gemini calls, verify every claimed write against the actual GitHub commit, not the
  reply text. Repeat the exact conversation that failed live (name → sports → goal/season →
  injuries/style/dob → habits → close) and confirm profile.json/memory.json/seasons.json/
  quests.json all land correctly this time, incrementally, not just at the end.
- Part A: unit tests for the new `fspWriteAllowed` branch and the expanded
  `isAthleteProfileComplete` (all four profile fields + sports + coaching_style + season
  required; quests not required).
- Part B: unit test for `closeIntent`'s new OR condition and for the ordinary-turn response now
  carrying a fresh `profileComplete`; live test that pressing the button produces the same close
  behavior as typing a working close phrase does today, and that it stays disabled until
  `profileComplete` flips true mid-conversation (not just at launch).
- `cd ui && npx tsc --noEmit` and `npm test -- --run` clean throughout both parts.

## What gets checked in review, not just self-reported

Whoever implements this, expect every one of the following to be independently re-verified before
either PR is treated as done - not re-derived from your summary of what you did:

1. **Actual diffs read line by line**, not a trust-the-commit-message pass.
2. **`SOUL.claude.md` zero-diff, re-confirmed independently** after any `platform/soul/` edit -
   `git diff --stat` re-run by the reviewer, not just quoted from your own run.
3. **`tsc --noEmit` and the full test suite re-run by the reviewer**, not assumed green from your
   report.
4. **At least one full live FSP conversation, re-run independently on a fresh scratch branch**,
   checking real GitHub commits against what each turn's reply claimed - specifically checking
   that `profile.json`, `memory.json` (`sports` + `coaching_style`), and `seasons.json` all land
   *incrementally*, not bunched into the final closing commit the way the original bug did it.
   This is the one that matters most - a green test suite proves nothing about whether the actual
   reliability bug is fixed, only a real conversation does.
5. **For Part B specifically**: the button's actual on-screen position (immediately right of send,
   same size) checked against a real render/screenshot if at all possible, not just the JSX/SwiftUI
   read by eye - and the disabled-until-`profileComplete` behavior confirmed live, including that
   it flips to enabled mid-conversation without a page reload or app relaunch.
6. **PR base branches confirmed correct** (`gh pr view <n> --json baseRefName`) - Part A based on
   `core/first-session-protocol-wiring`, Part B based on Part A's branch, neither based on `main`.

If something doesn't hold up under this review, expect it back with specifics, the same way three
parallel subagents' work got reviewed and one real bug got caught and fixed during PR #431's own
build (see that PR's commit history for the tone/rigor this repo expects).
