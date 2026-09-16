/**
 * preconditions.ts - the #1105 safety net. A scenario's `expect` block only checks which files
 * changed, never whether the target repo could actually produce the behavior being tested (see
 * docs/plans/coach-chat-test-harness-hardening.md's A2 section for the real false positive that
 * motivated this - `ambiguous-contradiction` "passed" a generic check while testing nothing, since
 * no real repo had a planned session to contradict).
 *
 * This is the bare check only - it looks at a RepoDataProfile snapshot (A1, repoDataProfile.ts)
 * and says whether a scenario's preconditions hold, with no way yet to fix an unmet one. A2b
 * (docs/plans/coach-chat-test-harness-hardening.md) adds seed recipes on top of this for the
 * preconditions that can be honestly produced by a real scripted conversation first.
 */
import type { RepoDataProfile } from "./repoDataProfile.js";

export interface Preconditions {
  currentWeekHasSessions?: boolean;
  injuryFlags?: "any" | "none";
  hasHabitQuest?: boolean;
  hasTemplate?: boolean;
}

/** Checks one profile against one set of preconditions. Returns the first unmet field's reason. */
export function checkPreconditions(
  profile: RepoDataProfile,
  preconditions: Preconditions,
): { met: boolean; reason?: string } {
  if (preconditions.currentWeekHasSessions !== undefined) {
    const has = profile.currentWeek.sessionCount > 0;
    if (has !== preconditions.currentWeekHasSessions) {
      return {
        met: false,
        reason: `currentWeekHasSessions: wanted ${preconditions.currentWeekHasSessions}, repo's current_week.json has ${profile.currentWeek.sessionCount} session(s)`,
      };
    }
  }

  if (preconditions.injuryFlags !== undefined) {
    const hasAny = profile.injuries.activeCount > 0;
    const wantAny = preconditions.injuryFlags === "any";
    if (hasAny !== wantAny) {
      return {
        met: false,
        reason: `injuryFlags: wanted "${preconditions.injuryFlags}", repo has ${profile.injuries.activeCount} active injury flag(s)`,
      };
    }
  }

  if (
    preconditions.hasHabitQuest !== undefined &&
    profile.quests.hasHabitQuest !== preconditions.hasHabitQuest
  ) {
    return {
      met: false,
      reason: `hasHabitQuest: wanted ${preconditions.hasHabitQuest}, repo's quests.json hasHabitQuest is ${profile.quests.hasHabitQuest}`,
    };
  }

  if (preconditions.hasTemplate !== undefined) {
    const has = profile.templateCount > 0;
    if (has !== preconditions.hasTemplate) {
      return {
        met: false,
        reason: `hasTemplate: wanted ${preconditions.hasTemplate}, repo has ${profile.templateCount} template(s)`,
      };
    }
  }

  return { met: true };
}
