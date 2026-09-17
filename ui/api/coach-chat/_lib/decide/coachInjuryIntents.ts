/** Pure server-owned appliers for injury actions reported by Gemini. */

import { type InjuryFlag } from "./coachMemoryFiles.js";
import { parseJsonOrNull } from "./coachChatFiles.js";
import { slugify } from "../../../_lib/slugify.js";

// injury_flag { text }[]: a brand-new injury the athlete has never mentioned before. Server
// owns id/opened_at/resolved_at entirely (gemini-flow.md's Action-field design rule #1) -
// Gemini only ever supplies the semantic text, never an id. Split from injury_event (#693):
// letting Gemini optionally supply a flag_id for "new vs update" made it invent one for new
// injuries every time, which injury_event's existing-match-or-throw guard then rejected.
export interface InjuryFlagInput {
  text: string;
}

// Word-overlap check backing applyInjuryFlag's dedup below. A plain case-insensitive-trim
// compare isn't enough on its own - the fixture eval suite's own real duplicate came back
// reworded ("Left hip soreness persisting for 3 days" vs "Left hip soreness for the past 3
// days, noticed during runs"), not just re-cased or re-padded. This counts words shared between
// the two texts as a fraction of the *shorter* text's distinct word count, so a short restated
// injury that's fully contained in a longer, more detailed one still matches; two different real
// injuries that happen to share one body-part word (e.g. "hip") stay well under threshold. Not a
// general fuzzy-match library on purpose (per the athlete's own steer, don't over-engineer this) -
// just enough to catch a same-turn-class restatement.
// Laterality words name genuinely different injuries no matter how much of the rest of the
// sentence overlaps ("Left hip pain" vs "Right hip pain" share "hip"/"pain", 2 of 3 words each,
// clearing the 0.5 threshold below on body-part overlap alone) - checked first, before the
// word-overlap ratio ever runs, so a short/generic-word text can't dilute this contradiction away.
const LATERALITY_WORDS = ["left", "right"] as const;

function injuryTextsLikelySame(a: string, b: string): boolean {
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  const sideOf = (text: string) => LATERALITY_WORDS.find((word) => text.includes(word));
  const sideA = sideOf(lowerA);
  const sideB = sideOf(lowerB);
  if (sideA && sideB && sideA !== sideB) return false;

  const wordsOf = (text: string) =>
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(Boolean),
    );
  const wordsA = wordsOf(a);
  const wordsB = wordsOf(b);
  if (wordsA.size === 0 || wordsB.size === 0) return false;
  let shared = 0;
  for (const word of wordsA) if (wordsB.has(word)) shared++;
  return shared / Math.min(wordsA.size, wordsB.size) >= 0.5;
}

// Applied in order against an accumulating flags array, same repeat-safety story as
// applyInjuryEvent below - a turn reporting several new injuries captures all of them.
//
// Dedup against existing *active* flags (K1 fixture eval, incremental-injury-disclosure): a pure
// filler turn with zero new information re-fired injury_flag for an injury already logged the
// turn before, which would otherwise mint a second, genuinely duplicate active flag for the same
// real injury - a later injury_event by flag_id would then only ever reach one of the two. A
// resolved flag never blocks a new one: the athlete can always re-report something that already
// healed and reopened.
export function applyInjuryFlag(
  content: string | null,
  newInjuries: InjuryFlagInput[],
  today: string,
  updatedAt: string,
  traceId: string,
): string {
  const parsed = parseJsonOrNull<{ flags?: InjuryFlag[] }>(content);
  let flags: InjuryFlag[] = Array.isArray(parsed?.flags) ? parsed.flags : [];

  for (const injury of newInjuries) {
    const trimmedText = injury.text.trim();
    const alreadyActive = flags.some(
      (flag) => flag.status === "active" && injuryTextsLikelySame(flag.text, trimmedText),
    );
    if (alreadyActive) continue;

    const slug = slugify(injury.text, "_", 24);
    const id = `inj_${today.replace(/-/g, "")}_${slug || Math.random().toString(36).slice(2, 6)}`;
    const newFlag: InjuryFlag = {
      id,
      text: trimmedText,
      status: "active",
      opened_at: today,
      resolved_at: null,
    };
    flags = [...flags, newFlag];
  }

  // Every sibling writer (profile, memory, quests, seasons) re-stamps version/_meta fresh on
  // every write - this one used to just emit {flags}, silently dropping both whenever they
  // existed (found live, 2026-09-10 pro baseline: a real athlete repo's injuries.json lost its
  // version/_meta on every touch). Matches the established pattern now instead of being the one
  // exception to it.
  return JSON.stringify(
    { version: 1, _meta: { updated_at: updatedAt, updated_by: "model", trace_id: traceId }, flags },
    null,
    2,
  );
}

// injury_event { status, text?, flag_id }: update or resolve a flag already on file. Server owns
// opened_at/resolved_at entirely (gemini-flow.md's Action-field design rule #1) - Gemini only
// ever supplies status/text/flag_id, and flag_id must be a real id already shown in the
// athlete's injuries context (activeInjuryFlagsSection in coachContext.ts). A brand-new injury
// goes through injury_flag instead - see applyInjuryFlag above. Two cases:
//   - status "active", text given -> update that flag's text in place; if it was already
//     resolved, reactivate it (clear resolved_at back to null)
//   - status "resolved" -> stamp resolved_at = today, leave text as-is unless a new one is given
export interface InjuryEvent {
  status: "active" | "resolved";
  text?: string;
  flag_id: string;
}

const INJURY_EVENT_STATUSES: readonly InjuryEvent["status"][] = ["active", "resolved"];

// Array (workout-backend-wiring live verification, same bug class issue #410 fixed for
// quest_event): a single object silently dropped every injury update past the first when an
// athlete reported more than one in the same message (e.g. two separate flags resolving) -
// found live, the reply claimed both were handled but only the first actually committed. Events
// are applied in order against an accumulating flags array, so a turn reporting several updates
// captures all of them.
export function applyInjuryEvent(
  content: string | null,
  events: InjuryEvent[],
  today: string,
  updatedAt: string,
  traceId: string,
): string {
  const parsed = parseJsonOrNull<{ flags?: InjuryFlag[] }>(content);
  let flags: InjuryFlag[] = Array.isArray(parsed?.flags) ? parsed.flags : [];

  for (const event of events) {
    // Applier-level double-check for the same enum -
    // coachReplySchema.ts's injury_event.status already constrains on the Gemini path - defense
    // in depth, same reasoning as applyProfileUpdate's PROFILE_UPDATE_FIELDS guard in
    // coachProfileIntents.ts.
    if (!INJURY_EVENT_STATUSES.includes(event.status)) {
      throw new Error(`injury_event: "${event.status}" is not a valid status`);
    }
    if (!flags.some((flag) => flag.id === event.flag_id)) {
      // Gemini reported a flag_id that doesn't exist in the current file - either it
      // hallucinated one or the flags list changed underneath it since its context was built.
      // Now that flag_id is required and every real id is shown in context (a new injury goes
      // through injury_flag instead), a mismatch here genuinely means a bad reference. Throwing
      // here (instead of silently returning the array unchanged) is deliberate: a caller that
      // commits this write should know the update didn't actually happen, not get a false
      // "success". Throws for the WHOLE batch, same all-or-nothing discipline as
      // applyWeekPlan's day-date validation - a batch with one bad id fails the whole call
      // rather than silently applying a partial patch.
      throw new Error(`injury_event: no flag with id "${event.flag_id}" in injuries.json`);
    }

    flags = flags.map((flag) => {
      if (flag.id !== event.flag_id) return flag;
      if (event.status === "resolved") {
        return {
          ...flag,
          text: event.text?.trim() ? event.text.trim() : flag.text,
          status: "resolved" as const,
          resolved_at: today,
        };
      }
      // status: "active" - either a text update on an already-active flag, or a reactivation of
      // an already-resolved one (resolved_at cleared back to null).
      return {
        ...flag,
        text: event.text?.trim() ? event.text.trim() : flag.text,
        status: "active" as const,
        resolved_at: null,
      };
    });
  }

  // Same version/_meta re-stamp as applyInjuryFlag above - see its comment.
  return JSON.stringify(
    { version: 1, _meta: { updated_at: updatedAt, updated_by: "model", trace_id: traceId }, flags },
    null,
    2,
  );
}
