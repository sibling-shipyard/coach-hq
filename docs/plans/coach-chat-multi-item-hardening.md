# Coach-chat multi-item hardening: round 2

> Status: Proposal · Owner: Tech Lead · Created: 2026-09-14 · Issue: #1037
>
> Execution detail, exact code citations, and mechanism sketches live in
> [`coach-chat-multi-item-hardening-lld.md`](coach-chat-multi-item-hardening-lld.md).

## Context

The athlete asked whether the just-shipped `injury_event` guard (#1009) handles two injuries
reported in one message. It doesn't: every reprompt-guard in `coachTurn.ts`, old and new, is a
boolean "did anything fire at all" check, never a count check. The athlete then asked for a full
audit of the same gap shape across the whole schema. Two Explore passes covered every action
field, applier, and detector; the highest-stakes claims were independently re-verified against
current code (not trusted from the summaries alone).

The finding: partial multi-item capture in one turn - 2-of-3 injuries, 2-of-3 quests, a partial
sports list - has almost no dedicated coverage, and one field (`sports_update`) has a real data-loss
design gap, not just a missing detector.

## Per-field findings

| Field | Gap | Proposed mechanism | Severity |
|---|---|---|---|
| `quest_event` | No dedicated guard at all. Its only backstop (`synthesizeQuestEventFromUnrecordedFacts`) rescues at most one completion, never a miss/excusal, and bails entirely once 2+ dropped facts each name-match a distinct quest - the exact case it should rescue. | Count-aware detector: count active-quest-name mentions with completion/miss/excusal language in `turn.geminiMessage`, compare against `reply.quest_event.length`; reprompt if fewer landed than named. | P1 |
| `injury_flag` | Returning-athlete turns have zero guard coverage (existing detector is first-session-only). First-session case is also a pure boolean - 1-of-2 captured suppresses it. | Extend `findMissedInjuryLanguage`'s gate to also allow returning-athlete turns (drop the `firstSession`-only restriction, keep the "zero pre-existing flags" disambiguator only for first-session; for returning athletes key on "message mentions injury language with no corresponding new flag or event this turn"). Add a lower-bound count check: number of distinct injury-keyword spans vs. `injury_flag.length + injury_event.length`. | P1 |
| `injury_event` | The #1009 guard is boolean/first-match: fires only when `injury_event` AND `injury_flag` are both totally empty. Also gated to exactly 1 active flag by design, so 2+ pre-existing flags get zero coverage today - not a partial-miss bug, a total absence. | Same lower-bound count check as `injury_flag` (they share `INJURY_LANGUAGE_PATTERN` matches); the exactly-one-flag gate stays for the *reference-picking* mechanism (still can't safely resolve *which* of 2+ flags a bare mention means) but the count check can still catch "message clearly describes 2 things, only 1 landed" even with 2+ flags, without needing to resolve which flag. | P1 |
| `sports_update` | `applySportsUpdate` (`coachIntents.ts:161-189`) fully replaces `memory.sports`, never merges. A partial list from Gemini is silent, permanent data loss. | Change the applier to union the new list with the existing one, never shrink it silently. An explicit removal needs its own signal (out of scope here - flag as a follow-up design question, not solved by this round). | P1 |
| `season_start.new_habits` / `quest_create.quests` | Boolean total-miss only, first-session-only. Returning athlete stating 2 habits at once: no guard. | Extend `findMissedHabitLanguage` to returning-athlete turns using the same "no nothing-on-file disambiguator" caveat #1009's LLD already flagged - needs its own narrower phrasing pass, not a blind copy. | P2 |
| `week_update` | `validateActions.ts`'s per-item drop (`:218-260`) and `coachWeekFiles.ts`'s all-or-nothing throw (`:380-393`) disagree on batch semantics - masked today since the validator always runs first, but a real inconsistency. `isProseOnlyWeekPlan` only catches total absence of `week_update`, not "some days landed, one didn't." | Align `applyWeekPatch`'s comment/behavior with the validator's actual per-item-drop semantics (the validator is the one that runs, so the applier's stricter throw is unreachable dead code today - either delete it or make the applier agree). Separately, no safe count mechanism exists yet for partial week/day drops (free text about a week is far less structured than injury/quest keyword counting) - documented as a harder problem, deferred to its own scoping pass. | P2 |
| `workout_create` exercises | `findMalformedWorkoutCreateExercise` reports only the first bad exercise; a second bad one surviving the retry trips the applier's all-or-nothing throw, dropping the whole routine. | Extend the detector to report ALL malformed exercises in the reprompt note (list every violation, not just the first), so a single reprompt round has full information instead of playing whack-a-mole. | P2 |
| `findInvalidReference` | Names only the first bad id across `quest_event`/`injury_event` combined. Not a correctness bug (layer 3 still drops each bad id individually) - a weaker correction message when 2+ ids are bad at once. | Extend to collect and report every bad id found, not just the first (`.filter` instead of `.find`). | P2 |

## Deferred

- **Quest retirement.** No schema field or applier path exists to retire a single habit quest
  mid-season - only a full `season_start` transition retires anything. Missing capability, not a
  reliability bug - needs its own product-shape decision, not proposed here.
- **`CHAT_MAX_OUTPUT_TOKENS` (8192).** Shared by thinking + JSON output; a sufficiently dense
  multi-fact turn could in principle truncate before the JSON finishes. No evidence yet that this
  has fired. Watch item, not a work item, unless live-testing surfaces an actual truncation.

`profile_update`'s existing #1009 guard is already more partial-capture-resistant than its
siblings by accident of design - it checks age/height-weight/timezone as three independently
gated branches inside one function, not one array-length escape hatch. No further work needed
there this round.

## Execution

Three stacked PRs, all `Refs: #1037` (`Fixes: #1037` on the last), same discipline as #1009: live
test every guard against `coach-skanda-2003` on a scratch branch, `check.sh --quiet` before every
push, update `gemini-flow.md`'s coverage table per PR.

| PR | milestone | outcome | final base | files | owner | parallel with | result |
|---|---|---|---|---|---|---|---|
| D | quest/injury partial-capture | count-aware guards for `quest_event`, `injury_flag`, `injury_event` | `core/1009-injury-event-hardening` | `coachTurn.ts`, `coachTurn-reprompt.test.ts` | Bob | - | pending |
| E | `sports_update` merge | union-not-replace applier fix | PR D | `coachIntents.ts`, `coachIntents.test.ts` | Bob | - | pending |
| F | remaining P2s | habit/quest_create returning-athlete coverage, `workout_create` full-violation reporting, `findInvalidReference` full-id reporting, `week_update` applier/validator seam alignment | PR E | `coachTurn.ts`, `coachWeekFiles.ts`, `coachTurn-reprompt.test.ts` | Bob | - | pending |

PR D touches quest_event/injury_flag/injury_event together because all three share the same
`INJURY_LANGUAGE_PATTERN`-style keyword-count machinery and the same `coachTurn.ts`
OR-list/still-block wiring - one detector-shape change, three call sites.

## Done when

- Both docs reviewed and their proposed mechanisms approved by the athlete before any PR starts.
- PR D/E/F each pass `check.sh --quiet`, live-test their guard against `coach-skanda-2003`, and
  land in order.
- `gemini-flow.md`'s coverage table reflects count-aware coverage, not just presence/absence, for
  the fields this round touches.
- Per `docs/eng-docs/README.md`'s plan-delete-on-last-PR rule: PR F folds anything durable into
  `gemini-flow.md` and deletes both this doc and its LLD.
