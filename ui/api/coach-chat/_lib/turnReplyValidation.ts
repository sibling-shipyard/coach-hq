import type { LlmReply } from "./llm/coachReplySchema.js";
import type { TurnState } from "./turnRequest.js";
import { WEEKDAYS, type Weekday } from "./decide/coachMemoryFiles.js";
import {
  COACH_LOG_TEXT_CAP,
  MEMORY_NOTE_TEXT_CAP,
  INJURY_FLAG_TEXT_CAP,
} from "./_generated/text-caps.bundle.js";
import { hasConfirmationCue, questNameReferencedIn } from "./decide/turnWrites/validateActions.js";
import { isFullWeekKickoff } from "./decide/coachWeekFiles.js";
import { exerciseTypeFieldViolation, computeUnackedInjuryFlags } from "./decide/workoutSchema.js";

// Layer 2 of the text-caps design (issue #462): the Gemini schema's maxLength (layer 1) and the
// prompt's stated caps (layer 0) are both requests, not guarantees - Gemini can still overshoot.
// This checks the parsed reply against the same three caps and reports the first violation found;
// layer 3 (capText in turnWrites/*) is the deterministic backstop if this and the reprompt below
// both fail.
export function findOversizedTextField(
  reply: LlmReply,
): { field: string; length: number; cap: number } | null {
  if (reply.coach_note && reply.coach_note.length > COACH_LOG_TEXT_CAP) {
    return { field: "coach_note", length: reply.coach_note.length, cap: COACH_LOG_TEXT_CAP };
  }
  if (reply.memory_update?.text && reply.memory_update.text.length > MEMORY_NOTE_TEXT_CAP) {
    return {
      field: "memory_update.text",
      length: reply.memory_update.text.length,
      cap: MEMORY_NOTE_TEXT_CAP,
    };
  }
  const oversizedNewInjury = (reply.injury_flag ?? []).find(
    (flag) => flag.text != null && flag.text.length > INJURY_FLAG_TEXT_CAP,
  );
  if (oversizedNewInjury) {
    return {
      field: "injury_flag[].text",
      length: oversizedNewInjury.text!.length,
      cap: INJURY_FLAG_TEXT_CAP,
    };
  }
  const oversizedInjury = (reply.injury_event ?? []).find(
    (event) => event.text != null && event.text.length > INJURY_FLAG_TEXT_CAP,
  );
  if (oversizedInjury) {
    return {
      field: "injury_event[].text",
      length: oversizedInjury.text!.length,
      cap: INJURY_FLAG_TEXT_CAP,
    };
  }
  return null;
}

// C2's enforcement rule: coach_note is required whenever the same reply also produced another
// structured write, since that's exactly the case where something happened worth remembering and
// Gemini doesn't get to silently skip recording it (JSON schema can't express "required only if
// another field is present," so this is a post-hoc check, same as findOversizedTextField above).
// A turn with none of these other fields (small talk, a check-in with nothing to report) leaves
// coach_note genuinely optional.
const ACTIONS_REQUIRING_COACH_NOTE = [
  "profile_update",
  "memory_update",
  "injury_flag",
  "injury_event",
  "quest_event",
  "quest_create",
  "season_start",
] as const satisfies readonly (keyof LlmReply)[];

export function missingRequiredCoachNote(reply: LlmReply): boolean {
  if (reply.coach_note && reply.coach_note.trim()) return false;
  return ACTIONS_REQUIRING_COACH_NOTE.some((field) => {
    const value = reply[field];
    return Array.isArray(value) ? value.length > 0 : value != null;
  });
}

// Finding D (OpenRouter K1 retest) mitigation: a self-audit signal, not a text heuristic. A dense
// first message (a goal plus multiple injuries and habits in one turn) was found to make the
// model narrate every fact in reply/coach_note while dropping almost all the matching action
// fields - not a validation drop, the fields were simply never in the model's JSON. A keyword
// heuristic (scan reply/coach_note text for injury/goal/habit words, compare to which fields
// fired) was considered and rejected: it can't tell "mentioned a new injury" from "referenced an
// injury already on file," and dense messages use varied enough wording that a fixed keyword list
// would both over- and under-fire. Instead the model self-reports via unrecorded_facts
// (coachReplySchema.ts) - it already has full context on what it just wrote and what it actually
// committed, in the same generation pass, so it's better positioned to catch its own
// inconsistency than an external heuristic reverse-engineering intent from prose. Same "request,
// not guarantee" caveat as every other field here - the self-audit call could itself be
// unreliable - but it's the strongest single signal available without a second full extraction
// pass.
export function findUnrecordedFacts(reply: LlmReply): string[] | null {
  // Same null/type guard as findOversizedTextField's injury_flag/memory_update checks above -
  // the schema declares this as string[], but that's a request to Gemini, not a runtime
  // guarantee; a non-string element here must not throw and turn a usable reply into a false 500.
  const facts = (reply.unrecorded_facts ?? [])
    .filter((fact): fact is string => typeof fact === "string")
    .map((fact) => fact.trim())
    .filter(Boolean);
  return facts.length > 0 ? facts : null;
}

// Live-verified (#727 review): reproduced twice in 5 real OpenRouter runs - a "reps"-type
// exercise with no reps field at all (not a wrong type, just omitted). Gemini's structured-output
// mode has no conditional-required support (a field required only when a sibling field has a
// given value isn't representable in this schema shape - see workout_create's own schema
// comment), so nothing stops the model from skipping it. The write path already refuses to commit
// this (never commit invalid data) - this is a pre-emptive structural check on the raw reply, one
// reprompt attempt before that refusal ever has to fire, same class of fix as
// findOversizedTextField above for a text cap. Checks only the two fields the live failure
// actually hit; the full invariant set (progression id, dose cap, injury ack) still gets its own
// enforcement at the write path regardless; this only catches what a reprompt can plausibly fix
// with a second, cheap generation.
// #1037 PR F: used to return on the first bad exercise found (string | null), so a second bad
// exercise surviving the reprompt tripped applyWorkoutCreate's all-or-nothing throw and dropped
// the whole routine - the reprompt only ever named one of the two problems. Collects every
// violation across every phase/exercise instead, same idea as workout_create.injury_ack's
// existing all-violations check (applyWorkoutCreate above, "active injury flag(s) not
// acknowledged" - already the one place in this codebase that reports every violation at once).
export function findMalformedWorkoutCreateExercises(reply: LlmReply): string[] | null {
  const spec = reply.workout_create;
  if (!spec) return null;
  const violations: string[] = [];
  for (const phase of spec.phases ?? []) {
    for (const ex of phase.exercises ?? []) {
      // Review finding (P2, #727 hardening): this used to hand-check reps/duration_secs presence
      // itself, duplicating workoutSchema.ts's validateExercise - real risk of the two drifting
      // apart, since that file is meant to be the one place this shape is defined. Reuses its
      // exported exerciseTypeFieldViolation instead; only the wording changed slightly (this
      // note's caller prefixes it with the exercise name either way).
      const violation = exerciseTypeFieldViolation(ex);
      if (violation) violations.push(`"${ex.name}" ${violation}`);
    }
  }
  return violations.length > 0 ? violations : null;
}

// #1071: invariant 7 (coachReplySchema.ts, workoutCreate.injury_ack) already makes injury_ack
// structurally required whenever the athlete has an active injury flag, and applyWorkoutCreate
// (coachWorkoutFiles.ts) throws on any unacked flag, which buildTurnWrites turns into a dropped
// action with a same-turn correction note - so nothing is silently lost. But the model's own
// prose already claims the routine was built and locked in before that correction note
// contradicts it in the same reply, which reads as a mid-reply self-contradiction rather than a
// clean "didn't save" (reproduced live on coach-akash-suresh and coach-skanda-2003, both with
// active injury flags). Same reprompt-before-finalizing pattern as every findMissed*Language
// check above - give the model one chance to add the missing injury_ack before the applier ever
// sees (and has to drop) the write, instead of narrating success and getting silently corrected
// after the fact.
export function findMissingWorkoutCreateInjuryAck(turn: TurnState, reply: LlmReply): string | null {
  const activeFlags = turn.activeInjuryFlagIds ?? new Set();
  if (activeFlags.size === 0) return null;
  if (!reply.workout_create) return null;
  const unacked = computeUnackedInjuryFlags(reply.workout_create.injury_ack, activeFlags);
  return unacked.length > 0 ? unacked.join(", ") : null;
}

// Live-verified (#727 review, 2026-09-13): the Weekly Kick-off Ritual intermittently narrates a
// full 7-day plan in reply text (a day-by-day bulleted breakdown) without ever setting
// week_update - the athlete reads a plan that was never saved. A generic "did the reply describe
// something without the matching action" heuristic was rejected elsewhere in this file for real
// false-positive risk against ordinary conversation (see the rejected gap-2a discussion this PR's
// history references), but this specific shape isn't that: a reply naming 5+ distinct weekday
// names is not something ordinary coaching chat produces by accident, only a real day-by-day
// week narration does. Scoped to non-firstSession turns only, since a first-session athlete never
// gets week_update at all (see the firstSession prompt branch above). Reuses WEEKDAYS
// (coachMemoryFiles.ts) rather than a third hand-copied weekday list - coachFirstSessionBenchmark.ts
// already has its own WEEKDAY_PATTERN for a different purpose (P2, #727 review).
const PROSE_ONLY_WEEK_PLAN_WEEKDAY_THRESHOLD = 5;

// #1075: found live on coach-akash-suresh - the model narrated a full week with the 3-letter
// abbreviation ("Mon (Sep 14)", "Tue (Sep 15)", ...) plus exactly one full name in prose
// ("Monday court is already in the bag"). That's 1 match against WEEKDAYS alone, so the detector
// above never fired and the unsaved plan reached the athlete with no reprompt.
//
// A bare-word abbreviation match is NOT safe on its own - "sat" ("I sat down"), "sun" ("the sun
// was out"), and "wed" ("we wed last spring") are real English words a normal coaching reply can
// say without describing a week at all, and re-introducing that risk is exactly what this
// detector's own header comment (above) rejected a generic keyword match for. The real narrated-
// week shape always pairs the abbreviation with the day-by-day list markup around it - every
// live-reproduced case has the abbreviation immediately followed by a date/label separator
// (`Mon (Sep 14)`, `Tue:`, `Wed -`). Requiring that trailing punctuation keeps the false-positive
// risk at the same "not something ordinary conversation produces by accident" bar the full-name
// check already meets, while still catching this real shape.
const WEEKDAY_ABBREVIATIONS: Record<Weekday, string> = {
  monday: "mon",
  tuesday: "tue",
  wednesday: "wed",
  thursday: "thu",
  friday: "fri",
  saturday: "sat",
  sunday: "sun",
};

function countMentionedWeekdays(replyText: string): number {
  return WEEKDAYS.filter((day) => {
    const abbrev = WEEKDAY_ABBREVIATIONS[day];
    const pattern = new RegExp(`\\b(${day}|${abbrev}\\s*[:\\-(])`, "i");
    return pattern.test(replyText);
  }).length;
}

export function isProseOnlyWeekPlan(reply: LlmReply, firstSession: boolean): boolean {
  if (firstSession || reply.week_update) return false;
  return countMentionedWeekdays(reply.reply) >= PROSE_ONLY_WEEK_PLAN_WEEKDAY_THRESHOLD;
}

// Direct-pro baseline (2026-09-10): the FSP dense-message scenario above still silently dropped
// injuries 3/8 times even with unrecorded_facts live - the same same-generation blind spot as
// everywhere else it's missed a real omission. A general keyword heuristic across every turn was
// rejected above for exactly the reason still true on a returning turn: it can't tell "a new
// injury" from "one already on file." That ambiguity doesn't exist here - scoped to a
// first-session turn with zero injury flags on record yet, there is nothing yet to be
// referencing, so any injury language in the raw message is necessarily new. A false positive
// (injury-sounding word, no real injury meant) costs one extra reprompt the model can answer
// "no injury, disregard" to - bounded downside, unlike the unbounded false-fire risk on every
// other turn shape that got this idea rejected the first time.
// The bare `ach(?:e|ing)` alternative only ever matches at the START of a word (\b requires a
// boundary immediately before it) - "headache"/"backache"/"stomachache"/"toothache" have no
// boundary there at all, since "ach" sits mid-word, so the whole match silently never fires on
// exactly the phrasing an athlete reporting a headache would use. Named compound forms are listed
// explicitly, each still properly `\b`-anchored at its own real word start.
const INJURY_LANGUAGE_PATTERN =
  /\b(strain(?:ed)?|sprain(?:ed)?|tweak(?:ed)?|sore(?:ness)?|(?:head|back|stomach|tooth)?ach(?:e|ing)|pain(?:ful)?|hurt(?:s|ing)?|injur(?:y|ed)|discomfort|tender(?:ness)?|pulled|niggle|twinge|flare(?:d)?)\b/i;

// Shared by every findMissed*Language check below - each one needs exactly this "return the
// matched keyword, or null" idiom against its own pattern.
function firstMatch(text: string, pattern: RegExp): string | null {
  return text.match(pattern)?.[0] ?? null;
}

export function findMissedInjuryLanguage(turn: TurnState, reply: LlmReply): string | null {
  if (!turn.firstSession) return null;
  if (turn.validInjuryFlagIds.size > 0) return null;
  if ((reply.injury_flag ?? []).length > 0) return null;
  return firstMatch(turn.athleteMessage, INJURY_LANGUAGE_PATTERN);
}

// Finding D (2026-09-10 pro baseline): findMissedInjuryLanguage above closes the dense-message
// omission gap for injuries specifically, but the same same-generation self-audit blind spot is
// real for every action type, not just injuries - this is the next highest-value domain. Same
// three-part scoping that makes the injury version safe (first-session, zero pre-existing
// referents, no matching field already set) transfers directly: on a first-session turn with zero
// existing quests, there is nothing yet to be "referencing," so any habit-shaped language is
// necessarily new. Habits arrive via either season_start.new_habits or a standalone quest_create -
// check both before concluding one was dropped. A distinct, narrower keyword set than the injury
// one on purpose - habits were separately observed to be honestly *deferred* by the model in
// nearly every dense-message trial rather than silently dropped, so this is closing a smaller
// residual risk, not the dominant failure mode for this domain.
const HABIT_LANGUAGE_PATTERN =
  /\b(every ?day|daily|habit|routine|track(?:ing)?|log(?:ging)?|streak)\b/i;

export function findMissedHabitLanguage(turn: TurnState, reply: LlmReply): string | null {
  if (!turn.firstSession) return null;
  if (turn.validQuestIds.size > 0) return null;
  if ((reply.season_start?.new_habits ?? []).length > 0) return null;
  if ((reply.quest_create?.quests ?? []).length > 0) return null;
  return firstMatch(turn.athleteMessage, HABIT_LANGUAGE_PATTERN);
}

// #1037 PR F: returning-athlete counterpart to findMissedHabitLanguage above. That check is safe
// because a first-session athlete with zero existing quests has nothing yet to be "referencing,"
// so the broad HABIT_LANGUAGE_PATTERN (every day/daily/habit/routine/track/log/streak) is safe to
// key on directly. That disambiguator doesn't hold once quests exist - an established athlete says
// "routine" and "track" constantly about existing training, not a new habit quest (#1009's own
// LLD flagged this exact false-positive risk when this gap was first scoped). So this doesn't
// reuse the broad pattern at all - it keys on explicit new-habit-starting phrasing only, language
// that implies *beginning* something rather than describing something already underway.
// Narrowed after a first draft ("going to start" plus any following word) was checked against
// ordinary training chat - "I'm going to start my long run tomorrow" matched it, which is exactly
// the false-positive class this needs to avoid. "going to start" now requires "new"/"habit" in the
// same phrase, same discipline every other keyed-language pattern in this file already follows.
const NEW_HABIT_LANGUAGE_PATTERN =
  /\b(start(?:ing)? a new habit|want to start (?:tracking|doing)|going to start (?:a )?new (?:daily )?habit|new daily habit)\b/i;

export function findMissedNewHabitLanguage(turn: TurnState, reply: LlmReply): string | null {
  if (turn.firstSession) return null; // covered by findMissedHabitLanguage above
  if ((reply.season_start?.new_habits ?? []).length > 0) return null;
  if ((reply.quest_create?.quests ?? []).length > 0) return null;
  return firstMatch(turn.athleteMessage, NEW_HABIT_LANGUAGE_PATTERN);
}

// Live-verified (#727 review, 2026-09-13): reproduced live twice - the athlete stated a goal
// (and often habits in the same message), the reply/coach_note narrated the season as "launched"
// or "locked in," but season_start was never actually set. Same three-part scoping as
// findMissedInjuryLanguage/findMissedHabitLanguage above, and same reason it's safe: checks the
// ATHLETE's own words for goal-declaring language, not the model's reply phrasing, so this can't
// misfire on the model's own narration style the way a reply-text keyword match could. Scoped to
// first-session only - a returning athlete's season_start moment is rarer and less dense
// (fewer competing facts in one message), and this exact failure was only observed there.
// Deliberately narrower than the habit/injury patterns above - an earlier draft included bare
// "target"/"targeting"/"aim(ing) for"/"training for" and two existing tests caught it colliding
// with ordinary first-session chat ("still reaching my weekly mileage target" isn't a season-start
// moment). Kept to phrasings specific enough that they essentially only show up when a real
// goal/season is being declared.
const GOAL_LANGUAGE_PATTERN =
  /\b(my goal|the goal is|want to (?:be|get|reach|run|hit|lift|lose|gain|become)|by (?:the )?end of)\b/i;

export function findMissedSeasonLanguage(turn: TurnState, reply: LlmReply): string | null {
  if (!turn.firstSession) return null;
  if (reply.season_start) return null;
  return firstMatch(turn.athleteMessage, GOAL_LANGUAGE_PATTERN);
}

// #1037 PR D: quest_event had no dedicated guard at all before this - its only backstop
// (synthesizeQuestEventFromUnrecordedFacts) rescues at most one completion and bails entirely
// once 2+ dropped facts each name-match a distinct quest, the exact multi-drop case that needs
// rescuing. Unlike the boolean findMissed*Language checks above, this one counts: it compares the
// number of active quests the athlete's own message names alongside completion/miss/excusal
// language against reply.quest_event.length, so "2 of 3 landed" still fires instead of being
// suppressed by the array being non-empty. Reuses questNameReferencedIn (validateActions.ts) for
// the actual name-matching rather than duplicating that logic.
// This is a LOWER BOUND, not an exact count - a quest name mentioned without status language
// nearby, or two quests with overlapping name words, can both misfire. Same risk class
// GOAL_LANGUAGE_PATTERN and sports_update's NEW_ACTIVITY_LANGUAGE_PATTERN already carry - run the
// full api/coach-chat/ suite after wiring this in and narrow on any collision, never drop the check.
const QUEST_STATUS_LANGUAGE_PATTERN =
  /\b(complet(?:ed|ing)|done|finish(?:ed)?|hit|nailed|crushed|missed|skip(?:ped)?|excused)\b/i;

export function findMissedQuestLanguage(turn: TurnState, reply: LlmReply): string | null {
  const activeQuests = (turn.context.quests?.quests ?? []).filter((q) => q.status === "active");
  if (activeQuests.length === 0) return null;
  if (!QUEST_STATUS_LANGUAGE_PATTERN.test(turn.athleteMessage)) return null;
  const mentionedNames = activeQuests.filter((q) =>
    questNameReferencedIn(q.name, turn.athleteMessage),
  );
  const capturedIds = new Set((reply.quest_event ?? []).map((e) => e.quest_id));
  const uncaptured = mentionedNames.filter((q) => !capturedIds.has(q.id));
  return uncaptured.length > 0 ? uncaptured.map((q) => q.name).join(", ") : null;
}

// #1009 (profile_update hardening): same scoping as the checks above - first-session
// only, since that's the only turn type where a stated age/height/weight/timezone is reliably
// new rather than a restatement of something already on file. Four independent field checks
// (dob, height_cm, weight_kg, timezone), each gated on its own "is this actually missing" check
// (no value on file yet AND no matching profile_update entry this turn for that specific field) -
// a bare number or "based in" phrase means nothing on its own without that gate, and would
// otherwise collide constantly with ordinary first-session chat. height_cm and weight_kg share
// BODY_METRIC_PATTERN since one regex matches either unit, but they're checked separately so the
// model capturing one doesn't suppress a reprompt for the other still being missing. Keys on the
// athlete's own message, never the model's reply/coach_note phrasing, for the same reason
// findMissedInjuryLanguage/findMissedHabitLanguage/findMissedSeasonLanguage do.
const AGE_LANGUAGE_PATTERN = /\b\d{1,2}\s*(?:years?\s*old|yo)\b|\bborn\b/i;
const BODY_METRIC_PATTERN = /\b\d{2,3}\s*(?:cm|kg|lbs?|ft|feet|inches)\b/i;
const TIMEZONE_LANGUAGE_PATTERN = /\bbased in\b|\btime ?zone\b|\bIST\b|\bGMT\b|\bUTC\b/i;

export function findMissedProfileLanguage(turn: TurnState, reply: LlmReply): string | null {
  if (!turn.firstSession) return null;
  const updatedFields = new Set((reply.profile_update ?? []).map((u) => u.field));
  const profile = turn.context.profile;
  if (!profile?.dob && !updatedFields.has("dob")) {
    const hit = firstMatch(turn.athleteMessage, AGE_LANGUAGE_PATTERN);
    if (hit) return hit;
  }
  if (!profile?.height_cm && !updatedFields.has("height_cm")) {
    const hit = firstMatch(turn.athleteMessage, BODY_METRIC_PATTERN);
    if (hit) return hit;
  }
  if (!profile?.weight_kg && !updatedFields.has("weight_kg")) {
    const hit = firstMatch(turn.athleteMessage, BODY_METRIC_PATTERN);
    if (hit) return hit;
  }
  if (!profile?.timezone && !updatedFields.has("timezone")) {
    const hit = firstMatch(turn.athleteMessage, TIMEZONE_LANGUAGE_PATTERN);
    if (hit) return hit;
  }
  return null;
}

// #1009 (workout_remove hardening): returning-athlete only - a first-session athlete has no
// existing routines yet (coachPromptText.ts explicitly withholds workout_remove on that branch),
// so there's nothing to remove and this check would never have anything real to key on. No
// id-set check here on purpose - applyWorkoutRemove (decide/coachWorkoutFiles.ts) already throws
// if the model invents an id not in the real manifest, which is the right layer for a "removed
// the wrong thing" failure. This detector only asks whether the athlete described removing
// something that the model never acted on at all.
const REMOVAL_LANGUAGE_PATTERN =
  /\b(delete|remove|get rid of|don'?t want)\b.{0,20}\b(routine|workout|template)\b/i;

export function findMissedRemovalLanguage(turn: TurnState, reply: LlmReply): string | null {
  if (turn.firstSession) return null;
  if (reply.workout_remove) return null;
  return firstMatch(turn.athleteMessage, REMOVAL_LANGUAGE_PATTERN);
}

// Round-2 live pass: "build me a new routine" got a reply claiming "the routine is built and saved"
// with no workout_create set, and the model's own unrecorded_facts stayed empty, so no other guard
// had anything to catch. Fires only when the athlete asked for a new routine AND the reply claims
// it was done AND no workout action landed. A clarifying question ("which days?") has no
// done-claim, so it never trips this.
const BUILD_ROUTINE_LANGUAGE_PATTERN =
  /\b(build|create|make|design|put together|set up)\b.{0,30}\b(routine|workout|template)\b/i;
const DONE_CLAIM_LANGUAGE_PATTERN = /\b(built|saved|created|added|locked in|set up|all set)\b/i;

export function findMissedWorkoutCreateLanguage(turn: TurnState, reply: LlmReply): string | null {
  if (turn.firstSession) return null;
  if (reply.workout_create || reply.template_edit || reply.session_plan || reply.week_update) {
    return null;
  }
  const asked = firstMatch(turn.athleteMessage, BUILD_ROUTINE_LANGUAGE_PATTERN);
  if (!asked) return null;
  return DONE_CLAIM_LANGUAGE_PATTERN.test(reply.reply) ? asked : null;
}

// #1009 (sports_update hardening): deliberately the narrowest pattern in this set. A bare sport
// name risks matching an ordinary session report with no update intent at all ("badminton was
// rough today" is not a sports_update moment), so this keys only on explicit new-activity
// phrasing, never a sport name alone. Runs on every turn, not gated to first-session or
// returning - a new/changed sport can arrive on either.
const NEW_ACTIVITY_LANGUAGE_PATTERN = /\b(started|new sport|picked up|also (?:play|do|doing))\b/i;

export function findMissedSportsLanguage(turn: TurnState, reply: LlmReply): string | null {
  if ((reply.sports_update ?? []).length > 0) return null;
  return firstMatch(turn.athleteMessage, NEW_ACTIVITY_LANGUAGE_PATTERN);
}

// #1009 (injury_event hardening): the opposite scoping problem from findMissedInjuryLanguage
// above. That check is safe because zero active flags means any injury language is necessarily
// new. Here flags already exist, which is exactly what makes plain injury language ambiguous - is
// the athlete updating a known flag, reporting a brand-new one (injury_flag), or just describing
// ordinary training discomfort that isn't flag-worthy at all? The narrow, safe version: only fire
// when EXACTLY ONE active flag exists, since "which injury" stops being ambiguous once there's
// only one candidate. Deliberately not scoped to firstSession like its sibling - injury updates
// are a returning-athlete-dominant flow, and the single-active-flag condition is what makes this
// safe instead of the first-session/zero-flags disambiguator the sibling uses. Reuses the existing
// INJURY_LANGUAGE_PATTERN rather than a new one - same phrasing, different gate.
// Known scope boundary, not an oversight: with 2+ active flags this stays silent even when the
// athlete clearly describes an injury changing, because there's no safe way to tell which flag
// they mean without risking a reprompt on an ordinary 1-of-many mention. See the dedicated test
// below confirming this is deliberate.
export function findMissedInjuryUpdateLanguage(turn: TurnState, reply: LlmReply): string | null {
  if ((turn.activeInjuryFlagIds ?? new Set()).size !== 1) return null;
  if ((reply.injury_event ?? []).length > 0) return null;
  if ((reply.injury_flag ?? []).length > 0) return null;
  return firstMatch(turn.athleteMessage, INJURY_LANGUAGE_PATTERN);
}

// #1037 PR D: returning-athlete counterpart to findMissedInjuryLanguage, and also the fix for
// findMissedInjuryUpdateLanguage's 2+-flag blind spot above - one function covers both gaps since
// they share INJURY_LANGUAGE_PATTERN and the same "did fewer things land than were described"
// question. Not scoped to "zero flags" (that disambiguator only makes sense pre-onboarding) and
// not scoped to exactly one flag either - resolving WHICH flag a bare mention means is
// findMissedInjuryUpdateLanguage's job (single-active-flag only); this only asks whether the
// count of things captured (injury_flag + injury_event entries) is lower than the count of real,
// distinct injury mentions in the message. A lower bound, not exact matching to a specific flag.
//
// INJURY_LANGUAGE_PATTERN matches keywords like "sore"/"hurt"/"pain" - a single injury described
// across two sentences ("my knee still hurts, it's sore in the mornings") produces 2 keyword hits
// for 1 real injury, which would over-count and false-positive a reprompt for an injury already
// captured once. Raw per-keyword counting isn't safe to ship as-is.
//
// I originally tried collapsing keyword hits purely by word-distance (hits within N words of the
// prior hit collapse together), on the theory that a real second injury needs its own
// location/context words first and so sits farther from the prior keyword than a restated hit on
// the same injury does. That doesn't hold up: "My ankle hurts, my knee hurts too, and my shoulder
// is sore" has three genuinely distinct injuries whose keyword hits are only ~5 words apart
// pairwise - well inside any window wide enough to also catch the restated-nearby case - so a
// pure word-distance heuristic collapses all three into one and silently drops two real injuries.
// Word distance alone can't tell "one injury restated nearby" from "several different injuries
// listed close together," because both patterns produce similar gaps between keyword hits.
//
// The actual distinguishing signal is body location. A real second injury almost always names its
// own body part ("my ankle... my knee... my shoulder"); a restated mention of the same injury
// usually either drops the location entirely (a pronoun or ellipsis - "it's still sore," "still
// hurts in the mornings") or repeats the same location word. So I match on the nearest named body
// part around each hit first, and only fall back to word-distance from the last counted hit when a
// hit has no location word nearby at all (a bare "it hurts" with nothing named) - which keeps the
// old, simpler behavior for that edge case. Verified in the test suite against: three distinct
// injuries close together (must all count, the case above), one injury restated nearby (must not
// double-count), and the plain word-distance fallback with no location word present.
const INJURY_MENTION_COLLAPSE_WINDOW_WORDS = 12;

// Common body-part/location vocabulary - the signal that lets countDistinctInjuryMentions tell a
// restated mention of the same injury apart from a second, genuinely different one. Not
// exhaustive, just the common set an athlete would actually say out loud when talking about a
// running/lifting injury. Deliberately leaves out "head"/"skull" - "head" gets used
// non-anatomically constantly in ordinary chat ("in my head," "ahead of," "get ahead") and the
// false-positive cost of that outweighs the rare real case of a head injury, which an athlete
// would almost always also name explicitly (concussion, headache) rather than relying on this
// detector.
//
// I considered replacing this fixed list with "match any noun phrase after 'my'" so new terms
// never need a manual add. Not doing that here - "my training," "my coach," "my week" aren't body
// parts, and that approach needs its own false-positive narrowing pass against the test corpus
// before it's safe to ship. Left as a future option, not built.
const BODY_LOCATION_WORDS = [
  "ankle",
  "ankles",
  "knee",
  "knees",
  "shoulder",
  "shoulders",
  "back",
  "hip",
  "hips",
  "wrist",
  "wrists",
  "elbow",
  "elbows",
  "foot",
  "feet",
  "calf",
  "calves",
  "hamstring",
  "hamstrings",
  "quad",
  "quads",
  "quadricep",
  "quadriceps",
  "groin",
  "neck",
  "shin",
  "shins",
  "achilles",
  "hand",
  "hands",
  "thigh",
  "thighs",
  "toe",
  "toes",
  "heel",
  "heels",
  "rib",
  "ribs",
  "glute",
  "glutes",
  "IT band",
  "iliotibial band",
  "tendon",
  "tendons",
  "tendinitis",
  "ligament",
  "ligaments",
  "cartilage",
  "meniscus",
  "rotator cuff",
  "labrum",
  "plantar fascia",
  "plantar fasciitis",
  "sciatic",
  "sciatica",
  "spine",
  "spinal",
  "chest",
  "pec",
  "pecs",
  "forearm",
  "forearms",
  "bicep",
  "biceps",
  "tricep",
  "triceps",
  "jaw",
  "abdomen",
  "abs",
  "core",
  "lat",
  "lats",
];
const LOCATION_PATTERN = new RegExp(`\\b(${BODY_LOCATION_WORDS.join("|")})\\b`, "i");

// Trailing "s" on a matched word almost always means a simple plural ("ankles" -> "ankle"), so
// stripping it collapses plural/singular phrasing of the same injury onto the same key. A few
// medical terms end in "s" without being plural at all - stripping those would mangle the key
// (e.g. "tendinitis" -> "tendiniti", "meniscus" -> "meniscu"). Those all end in "itis" or "us", so
// checking for those suffixes first is enough to spare them without hand-listing every term.
const LOCATION_FALSE_PLURAL_SUFFIXES = ["itis", "us"];

function normalizeLocationWord(word: string): string {
  const lower = word.toLowerCase();
  if (LOCATION_FALSE_PLURAL_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return lower;
  return lower.replace(/s$/, "");
}

// Looks for a body-location word in a small window of words around a hit rather than across the
// whole message, so a location word describing a different sentence/injury far away doesn't get
// wrongly attributed to this hit. Scans word-by-word and keeps the CLOSEST match by distance from
// the hit, not the first one the window happens to contain in reading order - two hits close
// together can have overlapping windows, and taking "first match in the joined window text" would
// attribute both to whichever location word appears earliest, even when a closer, different one
// exists for the second hit.
//
// Checks a 2-word phrase starting at each index before falling back to the single word there, so
// multi-word terms ("IT band," "rotator cuff," "plantar fasciitis") match - LOCATION_PATTERN can
// only match against whatever string it's handed, and a single word from the `words` array never
// contains a 2-word phrase on its own.
//
// Also checks for "left"/"right" immediately before the matched location word ("my left knee") and
// folds it into the returned key, so two mentions of the same body part on opposite sides count as
// distinct injuries instead of collapsing into one. Only checks directly-preceding words - rarer
// phrasing like "knee on my left side" isn't worth the added complexity here. Laterality is always
// optional: with no "left"/"right" nearby, the bare word comes back unchanged.
function nearestLocationWord(words: string[], hitWordIndex: number): string | null {
  const windowRadius = 5;
  const start = Math.max(0, hitWordIndex - windowRadius);
  const end = Math.min(words.length, hitWordIndex + windowRadius + 1);
  let closest: { word: string; distance: number; index: number } | null = null;
  for (let i = start; i < end; i++) {
    // Try the 2-word phrase starting here first, but only trust it if the match actually spans
    // both words (contains a space) - LOCATION_PATTERN also holds single-word alternatives, and
    // `${words[i]} ${words[i + 1]}`.match(...) can match just one of those inside the joined
    // string (e.g. "my glute" matching plain "glute"). Taking that as a hit here would credit the
    // match to index i (the first word) instead of where the word actually is, throwing off the
    // distance comparison against genuinely closer hits. Falling through to the single-word check
    // on words[i] keeps that case anchored at its real index.
    const twoWord = i + 1 < end ? `${words[i]} ${words[i + 1]}` : null;
    const twoWordMatch = twoWord ? twoWord.match(LOCATION_PATTERN) : null;
    const found =
      twoWordMatch && twoWordMatch[0].includes(" ")
        ? twoWordMatch
        : words[i].match(LOCATION_PATTERN);
    if (!found) continue;
    const distance = Math.abs(i - hitWordIndex);
    if (!closest || distance < closest.distance) {
      closest = { word: normalizeLocationWord(found[0]), distance, index: i };
    }
  }
  if (!closest) return null;
  const precedingWords = words
    .slice(Math.max(0, closest.index - 2), closest.index)
    .join(" ")
    .toLowerCase();
  const laterality = /\b(left|right)\b/.exec(precedingWords)?.[1];
  return laterality ? `${laterality} ${closest.word}` : closest.word;
}

function countDistinctInjuryMentions(text: string): string[] {
  const pattern = new RegExp(INJURY_LANGUAGE_PATTERN, "gi");
  const words = text.split(/\s+/).filter(Boolean);
  const hits: { keyword: string; wordIndex: number; location: string | null }[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const wordIndex = text.slice(0, match.index).split(/\s+/).filter(Boolean).length;
    hits.push({ keyword: match[0], wordIndex, location: nearestLocationWord(words, wordIndex) });
  }
  const distinct: { keyword: string; wordIndex: number; location: string | null }[] = [];
  for (const hit of hits) {
    // Same named body part as an already-counted mention - same real injury, collapse it.
    if (hit.location !== null && distinct.some((counted) => counted.location === hit.location)) {
      continue;
    }
    // No location word nearby at all - fall back to word-distance from the last counted hit
    // (comparing to the last DISTINCT hit here, not the last raw hit, unlike the old version).
    const lastCounted = distinct[distinct.length - 1];
    if (
      hit.location === null &&
      lastCounted &&
      hit.wordIndex - lastCounted.wordIndex <= INJURY_MENTION_COLLAPSE_WINDOW_WORDS
    ) {
      continue;
    }
    distinct.push(hit);
  }
  return distinct.map((counted) => counted.keyword);
}

export function findUncountedInjuryLanguage(turn: TurnState, reply: LlmReply): string | null {
  if (turn.firstSession) return null; // covered by findMissedInjuryLanguage above
  const mentions = countDistinctInjuryMentions(turn.athleteMessage);
  if (mentions.length === 0) return null;
  const captured = (reply.injury_flag ?? []).length + (reply.injury_event ?? []).length;
  return mentions.length > captured ? mentions[captured] : null;
}

// Single source of truth for "which fields count as schedule-changing" - both this function and
// buildTurnWrites's blockedFields computation need the exact same list, and drift between two
// separately-maintained copies would silently change what gets reprompted vs. what gets blocked.
// Named fields, not just a boolean, since buildTurnWrites also needs to report which ones it held
// back.
export function scheduleChangingFieldNames(reply: LlmReply): string[] {
  return [
    reply.template_edit != null && "template_edit",
    reply.session_plan != null && "session_plan",
    // A full-week-kickoff-shaped week_update rewrites the whole week, not one disputed session,
    // so it's deliberately not gated here. A patch-shaped week_update references existing
    // sessions and is gated.
    reply.week_update != null && !isFullWeekKickoff(reply.week_update) && "week_update",
  ].filter((field): field is string => Boolean(field));
}

// Bug 3 Primary (2026-09-10 pro baseline): the reprompt-side enforcement of pending_clarification
// tracking - see parsePendingClarification (read side) and LlmReply.pending_clarification's
// comment for the full story. If last turn left a real question open, and this turn's reply
// touches a schedule-changing field at all, and the athlete's raw message this turn carries no
// affirmative confirmation cue, treat the pending question as still unanswered - deliberately not
// trying to track *which* session the question was about (that would need parsing free text into
// structured intent, itself an unreliable step); any schedule-changing write while a real question
// sits unanswered is worth a reprompt. If the reprompt doesn't resolve it either,
// buildTurnWrites's own layer (see the "still" check below) leaves it to layer 3's defense-in-depth
// content-diff guard (validateActions.ts) as the final backstop.
export function findUnconfirmedAssumption(turn: TurnState, reply: LlmReply): string | null {
  if (!turn.pendingClarification) return null;
  if (scheduleChangingFieldNames(reply).length === 0) return null;
  if (hasConfirmationCue(turn.athleteMessage)) return null;
  return turn.pendingClarification;
}

// D1 layer 2 (#736): schema constraints (layer 1) are strong but not formally airtight - this
// codebase's own experience already shows maxLength is "a real constraint Gemini receives, not a
// guarantee it honors" (docs/eng-docs/gemini-flow.md:154-155). Same shape as
// findOversizedTextField above: detect the specific bad reference, name the actual valid ids in
// one corrective reprompt, use the corrected result. A stale/hallucinated id that survives even
// this is layer 3's job (buildTurnWrites) - drop just that action, never the whole turn.
// #1037 PR F: used to `.find` and return on the first bad id across quest_event/injury_event -
// a second bad id in the same reply got no mention in the reprompt at all, so the corrective call
// could fix one and leave the other for layer 3 to silently drop. Not a correctness bug -
// validateActions.ts's per-entry drop logic already handles multiple bad ids at commit time
// regardless of what the reprompt says - this only makes the reprompt message Gemini sees more
// complete, so its retry has full information instead of playing whack-a-mole one id at a time.
export function findInvalidReferences(
  reply: LlmReply,
  validQuestIds: ReadonlySet<string>,
  validInjuryFlagIds: ReadonlySet<string>,
): { field: string; badId: string; validIds: readonly string[] }[] | null {
  const badQuestEvents = (reply.quest_event ?? [])
    .filter((event) => event.quest_id != null && !validQuestIds.has(event.quest_id))
    .map((event) => ({
      field: "quest_event",
      badId: event.quest_id,
      validIds: [...validQuestIds],
    }));
  const badInjuryEvents = (reply.injury_event ?? [])
    .filter((event) => event.flag_id != null && !validInjuryFlagIds.has(event.flag_id))
    .map((event) => ({
      field: "injury_event",
      badId: event.flag_id,
      validIds: [...validInjuryFlagIds],
    }));
  const all = [...badQuestEvents, ...badInjuryEvents];
  return all.length > 0 ? all : null;
}

// D1 (#736): a Gemini-call failure ("Coach never got to reply") gets its own honest, consistent
// shape distinct from a commit failure ("Coach replied but I couldn't save it") - the raw
// upstream error text (e.g. "Gemini request failed (503): ...") is not something a non-technical
// athlete should see verbatim.
export function friendlyLlmErrorMessage(status: number): string {
  if (status === 429) return "Coach is getting a lot of requests right now - try again shortly.";
  if (status === 503 || status === 504) {
    return "Coach couldn't respond in time - try again in a moment.";
  }
  if (status >= 500) return "Something went wrong on our end - try again shortly.";
  return "Coach couldn't reply to that - try rephrasing or try again.";
}
