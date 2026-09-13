# Coach-chat action-field hardening: evidence and execution detail

> Status: Proposal · Owner: Tech Lead · Created: 2026-09-13 · Issue: #1009
>
> Drill-down for [`coach-chat-action-field-hardening.md`](coach-chat-action-field-hardening.md).
> Every fact below was pulled directly from `main` at `c5ecc36a` (the post-#999-merge tip) -
> line numbers, quoted prompt text, quoted schema shapes, quoted existing detectors. Nothing here
> is estimated.

## The existing pattern this plan extends

`ui/api/coach-chat/_lib/coachTurn.ts`'s `requestCoachReply` (~line 685-979) has one reprompt
mechanism, reused by every fix in this plan:

- **Detector calls** before the OR-list, e.g. `const missedX = findMissedXLanguage(turn, reply);`
- **OR-list** (~line 757-765) deciding whether to fire the one-shot reprompt.
- **`notes.push(...)`** blocks (~line 778-846) building the correction message sent back to
  Gemini, one block per detector, combined into a single reprompt if several fire at once.
- **"Still" block** (~line 868-908): re-runs every detector after the reprompt, logs
  (`console.warn`) if still unresolved. This is log-only - there is no second reprompt attempt.

Three existing detectors share one shape and are the direct template for this plan's new ones:

```ts
// coachTurn.ts:545-559
const INJURY_LANGUAGE_PATTERN =
  /\b(strain(?:ed)?|sprain(?:ed)?|tweak(?:ed)?|sore(?:ness)?|(?:head|back|stomach|tooth)?ach(?:e|ing)|pain(?:ful)?|hurt(?:s|ing)?|injur(?:y|ed)|discomfort|tender(?:ness)?|pulled|niggle|twinge|flare(?:d)?)\b/i;

function firstMatch(text: string, pattern: RegExp): string | null {
  return text.match(pattern)?.[0] ?? null;
}

function findMissedInjuryLanguage(turn: TurnState, reply: GeminiReply): string | null {
  if (!turn.firstSession) return null;
  if (turn.validInjuryFlagIds.size > 0) return null;
  if ((reply.injury_flag ?? []).length > 0) return null;
  return firstMatch(turn.geminiMessage, INJURY_LANGUAGE_PATTERN);
}
```

```ts
// coachTurn.ts:572-581
const HABIT_LANGUAGE_PATTERN =
  /\b(every ?day|daily|habit|routine|track(?:ing)?|log(?:ging)?|streak)\b/i;

function findMissedHabitLanguage(turn: TurnState, reply: GeminiReply): string | null {
  if (!turn.firstSession) return null;
  if (turn.validQuestIds.size > 0) return null;
  if ((reply.season_start?.new_habits ?? []).length > 0) return null;
  if ((reply.quest_create?.quests ?? []).length > 0) return null;
  return firstMatch(turn.geminiMessage, HABIT_LANGUAGE_PATTERN);
}
```

```ts
// coachTurn.ts:596-603
const GOAL_LANGUAGE_PATTERN =
  /\b(my goal|the goal is|want to (?:be|get|reach|run|hit|lift|lose|gain|become)|by (?:the )?end of)\b/i;

function findMissedSeasonLanguage(turn: TurnState, reply: GeminiReply): string | null {
  if (!turn.firstSession) return null;
  if (reply.season_start) return null;
  return firstMatch(turn.geminiMessage, GOAL_LANGUAGE_PATTERN);
}
```

**The load-bearing property all three share:** they key on `turn.geminiMessage` (the athlete's
own raw text), never on `reply.reply`/`reply.coach_note` (the model's own phrasing) - which is
what makes them safe against the model's narration style drifting. And each has a structural
"this must be new" disambiguator (zero existing flags, zero existing quests, no `season_start`
this turn) that removes the ambiguity a bare keyword match would otherwise carry.

**Test pattern** (`ui/api/coach-chat/_tests/integration/coachTurn-reprompt.test.ts:419-522`, the
`missed-habit-language` block) - five tests per field: fires and reprompts once; doesn't reprompt
twice, just logs; doesn't fire on the wrong turn type; doesn't fire when the field's already
covered; doesn't fire on unrelated language. Every new field below gets its own `describe` block
in this same file, same five-test shape.

**Applier-level tests** for all six target fields already exist (not reprompt tests - structural
validation tests): `profile_update`, `injury_event`, `coaching_style_update`, `sports_update`,
`quest_create` in `ui/api/coach-chat/_tests/layer2-fields/coachIntents.test.ts`; `workout_remove`
in `ui/api/coach-chat/_tests/layer2-fields/coachWorkoutCreate.test.ts`. Nothing to add there -
this plan's new tests are exclusively in `coachTurn-reprompt.test.ts`.

## `TurnState` fields available for every detector (no extra I/O)

`interface TurnState extends TurnRequest`, `coachTurn.ts:132-165`:

- `context.profile: ProfileJson | null`, `context.memory: MemoryJson | null`,
  `context.injuries: InjuriesJson | null`, `context.seasons`, `context.quests` - current state,
  fetched fresh every turn.
- `validQuestIds`, `validInjuryFlagIds`, `activeInjuryFlagIds: ReadonlySet<string>` - precomputed
  id sets (D1 layer 1).
- `firstSession: boolean`, `geminiMessage: string` - what every existing check regexes against.

**Not** on `TurnState`: template/manifest content (`existingRoutineIds`) - only on `RepliedTurn`,
fetched lazily and only for non-first-session turns. `workout_remove`'s detector below doesn't
need it (checks the athlete's phrasing only, not id validity - that's the applier's job).

---

## PR A (Batch 1): `profile_update` + two prompt-only fields

### `profile_update`

**Prompt reinforcement**, `coachPromptText.ts`:
- First-session branch (~line 118-120, after "Use profile_update for name, date of birth,
  timezone, height, and weight"): add "Never describe a stated age, height, weight, or timezone
  as saved without setting profile_update in the same turn."
- Returning-athlete branch (~line 160-161, after "set profile_update with one entry per field
  changed"): same sentence.

**Schema** (`coachReplySchema.ts:40-44`):
```ts
profile_update?: { field: "name" | "dob" | "timezone" | "height_cm" | "weight_kg"; value: string }[];
```

**New detector**, `coachTurn.ts`, placed after `findMissedSeasonLanguage` (~line 603):
```ts
const AGE_LANGUAGE_PATTERN = /\b\d{1,2}\s*(?:years?\s*old|yo)\b|\bborn\b/i;
const BODY_METRIC_PATTERN = /\b\d{2,3}\s*(?:cm|kg|lbs?|ft|feet|inches)\b/i;
const TIMEZONE_LANGUAGE_PATTERN = /\bbased in\b|\btime ?zone\b|\bIST\b|\bGMT\b|\bUTC\b/i;

function findMissedProfileLanguage(turn: TurnState, reply: GeminiReply): string | null {
  if (!turn.firstSession) return null;
  const updatedFields = new Set((reply.profile_update ?? []).map((u) => u.field));
  const profile = turn.context.profile;
  if (!profile?.dob && !updatedFields.has("dob")) {
    const hit = firstMatch(turn.geminiMessage, AGE_LANGUAGE_PATTERN);
    if (hit) return hit;
  }
  if ((!profile?.height_cm || !profile?.weight_kg) &&
      !updatedFields.has("height_cm") && !updatedFields.has("weight_kg")) {
    const hit = firstMatch(turn.geminiMessage, BODY_METRIC_PATTERN);
    if (hit) return hit;
  }
  if (!profile?.timezone && !updatedFields.has("timezone")) {
    const hit = firstMatch(turn.geminiMessage, TIMEZONE_LANGUAGE_PATTERN);
    if (hit) return hit;
  }
  return null;
}
```
(Illustrative - tune per the narrowing pass every new pattern in this plan needs, same as
`GOAL_LANGUAGE_PATTERN`'s own history: its first draft included `target`/`targeting`/`training
for`/`aim for` and two *existing* unit tests caught it colliding with ordinary chat. Budget for
the same here - run the full `api/coach-chat/` suite after wiring this in, before writing new
tests, and fix any existing-test collision by narrowing the pattern, not by weakening the check.)

Wire into `requestCoachReply`'s OR-list, `notes.push`, and "still" block exactly like the three
existing checks - add `missedProfileLanguage` alongside `missedSeasonLanguage` at every one of
the four wiring points (detector call, OR-list, `console.warn` object, `notes.push`).

**No write-time guard** - `applyProfileUpdate` (`coachIntents.ts:465-519`) already throws on an
invalid field or a blank value, which is the correct layer for a "saved wrong" failure. This
field's only gap is "saved nothing," which the reprompt above closes.

**Tests:** `describe("requestCoachReply missed-profile-language reprompt", ...)` in
`coachTurn-reprompt.test.ts`, five tests per the pattern above, one sub-case each for
age/height-weight/timezone.

**Live test:** reuse `test/727-fsp-transition-a`'s exact approach from the #999 round - null one
profile field on a scratch branch, state it in a dense first message, confirm `profile_update`
lands and (separately, may need several attempts per the #727 round's own experience) confirm the
reprompt fires when a first attempt holds it back.

### `coaching_style_update` - prompt only

**Why no reprompt:** the field's own prompt text (`coachPromptText.ts:169-172`) already requires
"an explicit request to change this... never infer it from mood or a single tough session." There
is no phrasing narrow enough to key a detector on that wouldn't also match an athlete venting
("push me harder today") without meaning a permanent style change - the same class of risk gap 2a
was rejected for in the #727 review.

**Prompt reinforcement only:** add "Never describe a coaching-style change as applied without
setting coaching_style_update" next to the existing instruction, both branches (~line 121-122
first-session, ~line 169-172 returning-athlete).

### Standalone `quest_create` (returning athlete) - prompt only

**Why no reprompt:** `findMissedHabitLanguage` already covers the first-session case (checks
`quest_create` as an OR-alternative to `season_start.new_habits`, gated `firstSession &&
validQuestIds.size === 0`). Extending `HABIT_LANGUAGE_PATTERN`
(`every ?day|daily|habit|routine|track(?:ing)?|log(?:ging)?|streak`) to returning turns has no
equivalent "nothing on file yet" disambiguator - an established athlete says "routine" and "track"
constantly about existing training, not a new habit quest. Same conclusion as
`coaching_style_update`.

**Prompt reinforcement only:** add "Never describe a new daily habit as tracked without setting
quest_create" to the returning-athlete branch (~line 192-194).

---

## PR B (Batch 2): `workout_remove`, `sports_update`

### `workout_remove`

**Prompt** (`coachPromptText.ts:220-221`, returning-athlete only - the field is never available
on first session per line 140): add "Never describe a routine as removed without setting
workout_remove in the same turn."

**Schema** (`coachReplySchema.ts:89-91`): `workout_remove?: { routine_id: string };`

**New detector**, `coachTurn.ts`:
```ts
const REMOVAL_LANGUAGE_PATTERN =
  /\b(delete|remove|get rid of|don'?t want)\b.{0,20}\b(routine|workout|template)\b/i;

function findMissedRemovalLanguage(turn: TurnState, reply: GeminiReply): string | null {
  if (turn.firstSession) return null;
  if (reply.workout_remove) return null;
  return firstMatch(turn.geminiMessage, REMOVAL_LANGUAGE_PATTERN);
}
```
No id-set check needed for the trigger itself - `applyWorkoutRemove`
(`decide/coachWorkoutFiles.ts:485-491`) already throws if the model invents an id not in the real
manifest, which is the correct layer for that failure shape. This detector only asks "did the
athlete describe removing something that the model never acted on."

**Tests + live test:** same five-test shape; live-test with a real existing routine on a scratch
branch, ask to remove it, confirm `workout_remove` lands.

### `sports_update`

**Prompt** (`coachPromptText.ts:161-162`): add "Never describe a new or changed sport as saved
without setting sports_update to the full list."

**Schema** (`coachReplySchema.ts:30`): `sports_update?: string[];`

**New detector** - narrower than the others on purpose, since a bare sport name risks matching an
ordinary session report ("badminton was rough today") with no update intent at all:
```ts
const NEW_ACTIVITY_LANGUAGE_PATTERN =
  /\b(started|new sport|picked up|also (?:play|do|doing))\b/i;

function findMissedSportsLanguage(turn: TurnState, reply: GeminiReply): string | null {
  if ((reply.sports_update ?? []).length > 0) return null;
  const hit = firstMatch(turn.geminiMessage, NEW_ACTIVITY_LANGUAGE_PATTERN);
  if (!hit) return null;
  // Only a real signal if the message also isn't just re-describing an existing sport - full
  // narrowing (checking the named activity against turn.context.memory?.sports) needs the same
  // build-then-narrow pass profile_update and season_start both needed; do not skip this step.
  return hit;
}
```
**Explicitly flagged for extra care during implementation:** this is the one new pattern in this
plan most likely to need a real narrowing pass against the existing test suite, the same way
`GOAL_LANGUAGE_PATTERN`'s first draft did. Do not ship it without running the full
`api/coach-chat/` suite first and fixing any collision by narrowing, not by dropping the check.

**Tests + live test:** same shape, plus an explicit test confirming it does NOT fire on an
ordinary session report mentioning an existing sport by name.

---

## PR C (Batch 3): `injury_event`

**Why this one needs its own scoping, not a copy of `findMissedInjuryLanguage`:**
`INJURY_LANGUAGE_PATTERN` is proven safe only under that function's specific gate -
`turn.validInjuryFlagIds.size === 0` ("nothing to reference yet, so it must be new"). `injury_event`
is the opposite case: flags already exist, which is exactly what makes plain injury language
ambiguous - is the athlete updating a known flag, reporting a new one (should be `injury_flag`),
or describing ordinary training discomfort that isn't flag-worthy at all?

**The narrow, safe version:** only fire when exactly one active flag exists - "which injury" stops
being ambiguous.

**Prompt** (`coachPromptText.ts:165-167`, both branches): add "Never describe an injury update as
recorded without setting injury_event (or injury_flag for a genuinely new one)."

**Schema** (`coachReplySchema.ts:34-37`):
```ts
injury_event?: { status: "active" | "resolved"; text?: string; flag_id: string }[];
```

**New detector**, `coachTurn.ts`, reusing the existing `INJURY_LANGUAGE_PATTERN`:
```ts
function findMissedInjuryUpdateLanguage(turn: TurnState, reply: GeminiReply): string | null {
  if (turn.activeInjuryFlagIds.size !== 1) return null;
  if ((reply.injury_event ?? []).length > 0) return null;
  if ((reply.injury_flag ?? []).length > 0) return null;
  return firstMatch(turn.geminiMessage, INJURY_LANGUAGE_PATTERN);
}
```
Deliberately **not** scoped to `firstSession` - injury updates are a returning-athlete-dominant
flow. The single-active-flag condition is what makes this safe instead, replacing the
first-session/zero-flags disambiguator the sibling function uses.

**Tests:** same five-test shape, **plus an explicit test that it does NOT fire with 2+ active
flags** - name this in the test comment as a deliberate scope boundary (the same way
`newSessionMayDuplicatePlan`'s own known tradeoff is documented in its code comment), not an
oversight to fix later.

**Also check during this batch, per the parent doc's note:** whether `injury_event`'s "updated the
wrong flag" failure shape (as opposed to "updated no flag") is better served by a
`validateActions.ts`-style write-time guard than a reprompt - live-test both athletes-with-one-flag
and athletes-with-two-flags scenarios before deciding definitively either way.

**Live test:** seed a scratch branch with exactly one active injury flag, describe it changing
("my knee's better now"), confirm `injury_event` lands. Separately seed two active flags, confirm
the detector stays silent (may commit an unrelated but plausible outcome - that's fine, it's not
this detector's job to fix a 2-flag ambiguity).

---

## Final step, PR C only

Per `docs/eng-docs/README.md`'s plan-delete-on-last-PR rule: fold the final coverage table state
into `gemini-flow.md`, then delete this file and its HLD in the same PR. Git history is the
archive - do not leave a stale copy behind "for reference."
