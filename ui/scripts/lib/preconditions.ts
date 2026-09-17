/**
 * preconditions.ts - the #1105 safety net. A scenario's `expect` block only checks which files
 * changed, never whether the target repo could actually produce the behavior being tested (see
 * docs/plans/coach-chat-test-harness-hardening.md's A2 section for the real false positive that
 * motivated this - `ambiguous-contradiction` "passed" a generic check while testing nothing, since
 * no real repo had a planned session to contradict).
 *
 * This looks at a RepoDataProfile snapshot (A1, repoDataProfile.ts) and says whether a scenario's
 * preconditions hold. A2 (#1105) started this as a bare presence/absence check with no way to fix
 * an unmet one. A2b extends each field to optionally carry a `seedMessages` recipe: a short real
 * conversation that produces the missing state honestly, run by run-manual-simulation-suite.ts through
 * the same real turn-sending path the scenario itself uses, before re-checking. I return the
 * recipe (not run it myself - this file stays a pure check, no child processes, no real turns) so
 * the caller knows whether an unmet precondition is worth seeding or should just skip.
 */
import type { RepoDataProfile } from "./repoDataProfile.js";

// A plain boolean means "check for this value, no way to fix it if unmet" (A2's original shape -
// still accepted everywhere so existing scenarios never have to change). The object form always
// means "I want this to be true, and here's a real conversation that can make it true" - there's
// no honest way to seed a *false*, e.g. un-injure someone or delete a real template, so the object
// form never carries its own desired boolean.
export type BoolPrecondition = boolean | { seedMessages: string[] };

// injuryFlags keeps its own shape since "any"/"none" isn't a boolean - the object form still only
// ever seeds toward "any" in every recipe I've written so far, but `need` is spelled out
// explicitly rather than assumed the way BoolPrecondition assumes `true`, since a "none" seed
// recipe (e.g. a resolve-the-flag message) is at least plausible even though nothing here uses
// it yet.
export type InjuryPrecondition = "any" | "none" | { need: "any" | "none"; seedMessages?: string[] };

export interface Preconditions {
  currentWeekHasSessions?: BoolPrecondition;
  injuryFlags?: InjuryPrecondition;
  hasHabitQuest?: BoolPrecondition;
  hasTemplate?: BoolPrecondition;
}

function boolWant(spec: BoolPrecondition): boolean {
  return typeof spec === "boolean" ? spec : true;
}

function boolSeedMessages(spec: BoolPrecondition): string[] | undefined {
  return typeof spec === "boolean" ? undefined : spec.seedMessages;
}

/**
 * Checks one profile against one set of preconditions. Returns the first unmet field's reason,
 * plus that field's seedMessages recipe when it has one - the caller (run-manual-simulation-suite.ts)
 * decides what to do with it (seed and re-check, or skip). No seedMessages on the result means
 * this field has no recipe: skip is the only honest fallback A2b left for it.
 */
export function checkPreconditions(
  profile: RepoDataProfile,
  preconditions: Preconditions,
): { met: boolean; reason?: string; seedMessages?: string[] } {
  if (preconditions.currentWeekHasSessions !== undefined) {
    const spec = preconditions.currentWeekHasSessions;
    const want = boolWant(spec);
    const has = profile.currentWeek.sessionCount > 0;
    if (has !== want) {
      return {
        met: false,
        reason: `currentWeekHasSessions: wanted ${want}, repo's current_week.json has ${profile.currentWeek.sessionCount} session(s)`,
        seedMessages: boolSeedMessages(spec),
      };
    }
  }

  if (preconditions.injuryFlags !== undefined) {
    const spec = preconditions.injuryFlags;
    const need = typeof spec === "string" ? spec : spec.need;
    const seedMessages = typeof spec === "string" ? undefined : spec.seedMessages;
    const hasAny = profile.injuries.activeCount > 0;
    const wantAny = need === "any";
    if (hasAny !== wantAny) {
      return {
        met: false,
        reason: `injuryFlags: wanted "${need}", repo has ${profile.injuries.activeCount} active injury flag(s)`,
        seedMessages,
      };
    }
  }

  if (preconditions.hasHabitQuest !== undefined) {
    const spec = preconditions.hasHabitQuest;
    const want = boolWant(spec);
    if (profile.quests.hasHabitQuest !== want) {
      return {
        met: false,
        reason: `hasHabitQuest: wanted ${want}, repo's quests.json hasHabitQuest is ${profile.quests.hasHabitQuest}`,
        seedMessages: boolSeedMessages(spec),
      };
    }
  }

  if (preconditions.hasTemplate !== undefined) {
    const spec = preconditions.hasTemplate;
    const want = boolWant(spec);
    const has = profile.templateCount > 0;
    if (has !== want) {
      return {
        met: false,
        reason: `hasTemplate: wanted ${want}, repo has ${profile.templateCount} template(s)`,
        seedMessages: boolSeedMessages(spec),
      };
    }
  }

  return { met: true };
}
