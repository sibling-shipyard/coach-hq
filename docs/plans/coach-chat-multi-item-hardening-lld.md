# Coach-chat multi-item hardening: evidence and execution detail

> Status: Proposal · Owner: Tech Lead · Created: 2026-09-14 · Issue: #1037
>
> Drill-down for [`coach-chat-multi-item-hardening.md`](coach-chat-multi-item-hardening.md).
> Every citation below was pulled from `core/1009-injury-event-hardening` at `c95489bc` (PR C's
> tip, post-#1009-round). Line numbers, quoted code, quoted schema shapes - nothing estimated.

## The shared failure shape

Every existing `findMissed*Language` detector in `coachTurn.ts` (profile/injury/habit/season/
removal/sports, ~lines 549-716) is boolean: it returns a single matched string or `null`, and every
one of them short-circuits the moment the target array/field is non-empty (`(reply.X ?? []).length
> 0 → return null`). That escape hatch is correct for "did the athlete's language get totally
ignored" but blind to "the athlete described 3 things, 1 landed." None of them count.

`findInvalidReference` (`coachTurn.ts:732-757`) has the same shape for a different purpose - `.find`
over `quest_event`/`injury_event`, returns the first bad id, not all of them.

## PR D: `quest_event`, `injury_flag`, `injury_event` partial-capture

### `quest_event` - no guard exists today

**Evidence:** `quest_event` has no `findMissed*` function anywhere in `coachTurn.ts` - confirmed by
grep, the only mechanism touching it is `findInvalidReference` (bad-id case) and
`synthesizeQuestEventFromUnrecordedFacts` (`validateActions.ts:346-373`):

```ts
export function synthesizeQuestEventFromUnrecordedFacts(
  unrecordedFacts: readonly string[] | null | undefined,
  activeQuests: readonly QuestForSynthesis[],
  alreadyHandledQuestIds: ReadonlySet<string>,
): QuestEvent | null {
  // ...
  const nameMatches = candidates.filter((quest) =>
    completionFacts.some((fact) => questNameReferencedIn(quest.name, fact)),
  );
  if (nameMatches.length !== 1) return null;   // <-- bails on 2+ matches
  return { quest_id: nameMatches[0].id, status: "completed" };
}
```

Called once per turn (`coachTurn.ts:1069`), returns a single `QuestEvent | null`, hardcodes
`status: "completed"`. Take "did my run and mobility, skipped strength" as an example. If the model
only partially captures that message, and 2+ of the dropped facts each cleanly match a distinct
quest, this function rescues **none** of them - the exact multi-drop case it should be rescuing.

**Mechanism - two parts, since detection and synthesis are different problems:**

1. **Detector** (new `findMissedQuestLanguage`, placed after `findMissedSeasonLanguage` per the
   established ordering): count distinct active-quest-name mentions in `turn.geminiMessage` that
   co-occur with completion/miss/excusal language, compare against `reply.quest_event.length`.
   ```ts
   // Reuses the same name-matching idea as questNameReferencedIn (validateActions.ts:335-343),
   // duplicated here rather than imported - coachTurn.ts doesn't currently import from
   // decide/turnWrites/, and this check needs turn.context.quests, not the synthesis inputs.
   const QUEST_STATUS_LANGUAGE_PATTERN =
     /\b(complet(?:ed|ing)|done|finish(?:ed)?|hit|nailed|crushed|missed|skip(?:ped)?|excused)\b/i;

   function findMissedQuestLanguage(turn: TurnState, reply: GeminiReply): string | null {
     const activeQuests = (turn.context.quests?.quests ?? []).filter((q) => q.status === "active");
     if (activeQuests.length === 0) return null;
     if (!QUEST_STATUS_LANGUAGE_PATTERN.test(turn.geminiMessage)) return null;
     const mentionedNames = activeQuests.filter((q) =>
       questNameReferencedIn(q.name, turn.geminiMessage),  // hoist/export this helper, see below
     );
     const capturedIds = new Set((reply.quest_event ?? []).map((e) => e.quest_id));
     const uncaptured = mentionedNames.filter((q) => !capturedIds.has(q.id));
     return uncaptured.length > 0 ? uncaptured.map((q) => q.name).join(", ") : null;
   }
   ```
   **This is a lower bound, not an exact count** - a quest name mentioned without status language
   nearby, or two quests with overlapping name words, can both misfire. Same risk class
   `GOAL_LANGUAGE_PATTERN` and `sports_update`'s pattern already carry; the LLD instruction from
   #1009 applies here too: run the full `api/coach-chat/` suite after wiring this in, narrow on any
   collision, never drop the check.
   **Action needed before implementing:** `questNameReferencedIn` (`validateActions.ts:335-343`) is
   currently unexported and private. Export it and import in `coachTurn.ts`, rather than
   duplicating the word-matching logic - avoids two copies drifting.

2. **Synthesis extension** (lower priority - only build this if live-testing the detector above
   shows real gaps remain). Change `synthesizeQuestEventFromUnrecordedFacts` to return
   `QuestEvent[]`. Drop the `nameMatches.length !== 1` bail. Instead synthesize one entry per
   unambiguous 1:1 name match, and skip any fact that matches 0 or 2+ quests. Attempt this only
   after the detector ships and its live-test results show the reprompt alone isn't sufficient.
   Don't build both at once - the reprompt is safer (it never guesses a wrong action) and should
   be measured first.

**Tests** (new `describe("requestCoachReply missed-quest-language reprompt (#1037)")`):
- Fires when 2 of 2 active quests are mentioned with status language but only 1 has a `quest_event`.
- Fires when 1 of 1 mentioned quest has no `quest_event` at all.
- Silent when the message has no quest-status language at all (ordinary chat).
- Silent when all mentioned quests already have a `quest_event` this turn.
- Silent when a quest name is mentioned with no status language nearby. Example: "my strength quest
  usually happens Tuesdays" is purely descriptive, not a completion/miss claim.
- **Partial-capture case** (the actual bug this fixes): 2 quests mentioned with status language,
  `reply.quest_event` has exactly 1 entry. Must still fire, naming the uncaptured one.

**Live test:** scratch branch with 2+ active quests, one message: "finished my long run and did my
mobility work, but skipped strength today" (3 quests, 3 statuses). Confirm all 3 land via
before/after diff on `progress.json`, not just the harness's PASS/FAIL.

### `injury_flag` - no returning-athlete coverage, boolean first-session coverage

**Evidence:** `coachTurn.ts:558-562`:
```ts
function findMissedInjuryLanguage(turn: TurnState, reply: GeminiReply): string | null {
  if (!turn.firstSession) return null;              // <-- returning athlete: zero coverage
  if (turn.validInjuryFlagIds.size > 0) return null; // <-- any pre-existing flag: zero coverage
  if ((reply.injury_flag ?? []).length > 0) return null; // <-- boolean, 1-of-2 suppresses
  return firstMatch(turn.geminiMessage, INJURY_LANGUAGE_PATTERN);
}
```

**Mechanism:** keep this function's first-session/zero-flags case as-is (it's the safest
disambiguator - "nothing on file, so any injury language must be new" - and changing its gate risks
false positives on ordinary returning-athlete chat). Add a second, narrower detector for the
returning-athlete case, count-based rather than a fresh boolean:

```ts
// Returning-athlete counterpart to findMissedInjuryLanguage. Not scoped to "zero flags" (that
// disambiguator doesn't apply once any flags exist) - scoped instead to "does the number of
// distinct injury-keyword spans in the message exceed the number of injury_flag + injury_event
// entries the model produced." A lower bound, not exact matching to a specific flag - resolving
// WHICH flag a bare mention means is findMissedInjuryUpdateLanguage's job (single-active-flag
// only), this only asks "did fewer things land than were described."
function findUncountedInjuryLanguage(turn: TurnState, reply: GeminiReply): string | null {
  if (turn.firstSession) return null; // covered by findMissedInjuryLanguage above
  const mentions = turn.geminiMessage.match(new RegExp(INJURY_LANGUAGE_PATTERN, "gi")) ?? [];
  if (mentions.length === 0) return null;
  const captured = (reply.injury_flag ?? []).length + (reply.injury_event ?? []).length;
  return mentions.length > captured ? mentions[captured] : null;
}
```

**Known limitation, be explicit about it in the PR:** `INJURY_LANGUAGE_PATTERN` matches keywords
like "sore," "hurt," "pain." A single injury described in 2 sentences ("my knee still hurts, it's
sore in the mornings") produces 2 keyword hits for 1 real injury. That would over-count and
false-positive a reprompt asking about an injury already captured once. **This needs a real
narrowing pass before shipping** - possibly collapse adjacent/co-referential matches (within N
words of each other) before counting, or count sentences/clauses containing injury language rather
than raw keyword hits. Do not ship the naive per-keyword count above without running it against the
existing test corpus and a batch of real transcripts first. Flag this explicitly as the part of
this PR most likely to need a design change once real data is in - the same caution #1009's own
LLD gave `sports_update`'s pattern.

**Tests:** same five-shape pattern, plus the partial-capture case (2 injuries named, 1
`injury_flag` entry, still fires) and an explicit false-positive guard test (1 injury described
across 2 sentences with 2 keyword hits, exactly 1 `injury_flag` entry - must NOT fire).

**Live test:** returning-athlete scratch branch, one message describing 2 new injuries ("tweaked my
ankle and my shoulder's been aching too") - confirm both land as separate flags via diff on
`injuries.json`.

### `injury_event` - boolean/first-match, no 2+-flag coverage at all

**Evidence:** `coachTurn.ts:686-691` (shipped this round, PR C):
```ts
function findMissedInjuryUpdateLanguage(turn: TurnState, reply: GeminiReply): string | null {
  if ((turn.activeInjuryFlagIds ?? new Set()).size !== 1) return null; // 2+ flags: zero coverage
  if ((reply.injury_event ?? []).length > 0) return null;              // boolean
  if ((reply.injury_flag ?? []).length > 0) return null;
  return firstMatch(turn.geminiMessage, INJURY_LANGUAGE_PATTERN);
}
```

**Mechanism:** the exactly-one-flag gate is correct and stays - it's the only safe way to resolve
*which* flag a bare mention means, and this LLD isn't proposing to touch that resolution problem.
What's missing is a count check that works even with 2+ flags, without needing to resolve which
flag each mention is about. Reuse the same `findUncountedInjuryLanguage` mechanism proposed for
`injury_flag` above - it already sums `injury_flag.length + injury_event.length` against total
keyword-span count, and doesn't care how many flags exist. **This means `findUncountedInjuryLanguage`
covers both `injury_flag`'s returning-athlete gap and `injury_event`'s 2+-flag gap in one function,**
so no separate detector is needed for `injury_event` specifically. Update the PR D file list
accordingly: one new detector, not two.

**Tests:** the athlete's own original scenario as a live-test case. Seed 2 pre-existing active
flags (shoulder, knee), then send a message stating knee resolving AND a new ankle injury. Confirm
`injury_event` (knee) + `injury_flag` (ankle) both land, or if the model drops one, confirm the
count detector fires and the reprompt fixes it.

## PR E: `sports_update` merge, not replace

**Evidence:** `coachIntents.ts:161-189`:
```ts
export function applySportsUpdate(
  content: string | null,
  sports: string[],
  updatedAt: string,
  traceId: string,
): string {
  const cleaned = sports.map((s) => s.trim()).filter((s) => s.length > 0);
  // ...
  const result: MemoryJson = {
    // ...
    sports: cleaned,   // <-- full replace, `parsed.sports` never consulted
    // ...
  };
  return JSON.stringify(result, null, 2);
}
```
`parsed` (the existing `MemoryJson`) is read for `coaching_style`/`training_availability`/`notes`
but never for `sports` - confirmed by reading the full function, no merge logic exists.

**Mechanism:**
```ts
export function applySportsUpdate(
  content: string | null,
  sports: string[],
  updatedAt: string,
  traceId: string,
): string {
  const cleaned = sports.map((s) => s.trim()).filter((s) => s.length > 0);
  if (cleaned.length === 0) {
    throw new Error(`sports_update: no non-blank sport in "${sports.join(", ")}"`);
  }
  const parsed = parseJsonOrNull<Partial<MemoryJson>>(content) ?? {};
  const existing = parsed.sports ?? [];
  // Case-insensitive union, preserving the NEW list's casing/order for anything it names, then
  // appending any existing sport the new list didn't mention - the prompt already tells Gemini
  // to send "the full list, not just what changed" (coachPromptText.ts), so this only protects
  // against the model failing that instruction, it doesn't change the intended behavior when the
  // model gets it right.
  const seen = new Set(cleaned.map((s) => s.toLowerCase()));
  const merged = [...cleaned, ...existing.filter((s) => !seen.has(s.toLowerCase()))];
  // ...
  const result: MemoryJson = { /* ... */ sports: merged, /* ... */ };
  return JSON.stringify(result, null, 2);
}
```
**Explicit removal is out of scope for this PR** - flagged in the HLD as a follow-up design
question (does removing a sport need its own signal, e.g. a `sports_remove` field, or should a
shrinking list ever be trusted). Don't build that here; this PR only stops the *accidental* loss
case, where the model just forgets to restate an existing sport.

**Tests** (`coachIntents.test.ts`, extend the existing `applySportsUpdate` describe block):
- New sport + existing sport both present in the list on file after a partial-list update.
- Case-insensitive: "Running" in the new list doesn't duplicate an existing "running".
- New list that already contains everything on file behaves identically to today. No duplicate,
  same order for named entries.
- Still throws on an all-blank list (existing behavior preserved).

**Live test:** scratch branch with 2 existing sports on file, message stating a 3rd new sport only
("started climbing this month") - confirm the file has all 3 after, not just the 1 new one, via
diff on `memory.json`.

## PR F: remaining P2s

### `season_start.new_habits` / `quest_create.quests` returning-athlete coverage

**Evidence:** `coachTurn.ts:579-585`:
```ts
function findMissedHabitLanguage(turn: TurnState, reply: GeminiReply): string | null {
  if (!turn.firstSession) return null;   // <-- returning athlete: zero coverage
  if (turn.validQuestIds.size > 0) return null;
  // ...
}
```
Same shape as `injury_flag`'s gap. #1009's own LLD already flagged why this is hard: an established
athlete says "routine" and "track" constantly about existing training, not a new habit quest.
**Mechanism:** narrow the returning-athlete trigger to an explicit-new-habit phrase set,
not the broad `HABIT_LANGUAGE_PATTERN` used for the zero-quests first-session case. Phrases like
"starting a new habit," "want to start tracking," or "going to floss every day" imply *beginning*
something, not describing an existing routine. This needs the same narrowing-pass discipline as
`sports_update`'s pattern did in #1009: draft it, run the full suite, narrow on any collision, and
never ship the broad pattern un-narrowed.

**Tests:** standard five-shape, plus an explicit non-firing test for "I've been doing my usual
strength routine" (existing-routine language, not a new-habit claim) on a returning-athlete turn.

### `workout_create` - report every malformed exercise, not just the first

**Evidence:** `coachTurn.ts:497-508` (exact body not re-quoted here, confirmed by direct read):
returns the first exercise-type violation found via an early return inside a nested phases/
exercises loop.

**Mechanism:** change the loop to collect every violation into an array, return `string[] | null`
instead of `string | null`, and update the one call site (`coachTurn.ts` OR-list/notes wiring) to
join all violations into the reprompt note instead of naming just one. Same idea as
`workout_create.injury_ack`'s existing all-violations check (`coachWorkoutFiles.ts:391-397`,
already the one place in the codebase that does this correctly - use it as the direct template.)

**Tests:** extend existing malformed-exercise tests with a 2-bad-exercises case, confirm both
appear in the reprompt note text.

### `findInvalidReference` - report every bad id, not just the first

**Evidence:** `coachTurn.ts:732-757`, `.find` over `quest_event` then `.find` over `injury_event`,
returns on the first hit.

**Mechanism:** change to `.filter`, return `{ field: string; badId: string; validIds: readonly
string[] }[]` (or `null` if none), update the reprompt note builder to list every bad reference
found across both fields, not just the first. Downstream, `validateActions.ts`'s per-entry drop
logic already handles multiple bad ids correctly at commit time regardless - this only makes the
reprompt message Gemini sees more complete, so its retry has full information instead of playing
whack-a-mole.

**Tests:** 2 bad `quest_id`s in one `quest_event` array - confirm the reprompt note names both, not
just the first.

### `week_update` applier/validator seam alignment

**Evidence:** `validateActions.ts:218-260` (`validateWeekUpdate`, per-item `.filter`) vs.
`coachWeekFiles.ts:380-393` (`applyWeekPatch`, "a batch with one bad reference fails the whole call
rather than silently applying a partial patch"). The validator runs first in the real pipeline, and
its output is what `applyWeekPatch` receives. So the applier's own stricter guard is unreachable in
practice - defense-in-depth that has never actually triggered. It still documents a design intent
("all-or-nothing") that disagrees with what actually ships (per-item drop).

**Mechanism:** this is a documentation/consistency fix, not a behavior change. Update
`applyWeekPatch`'s comment to state the real, current contract: validated upstream, so this is a
defense-in-depth backstop, not the primary discipline. Drop the misleading "same discipline as
`applyQuestEvent`'s id guards" claim - it's no longer accurate for how week_update actually behaves
end to end. **No safe count-based partial-capture detector is proposed for week_update in this
round.** Free text describing week changes is far less structured than injury/quest keyword
matching - no fixed vocabulary, and day names alone are ambiguous. Forcing one risks the same
false-positive class #727 already rejected once for this exact field (`isProseOnlyWeekPlan`'s
narrow weekday-count heuristic exists precisely because a broader one wasn't safe). Flagged as a
genuinely harder problem needing its own scoping pass, not solved here.

**Tests:** none new needed - this is a comment/doc fix, not a behavior change. If the athlete wants
the applier's guard actually removed (since it's unreachable dead code) rather than just
re-documented, that's a 1-line follow-up, flag it as a P2 in the PR body for a decision.
