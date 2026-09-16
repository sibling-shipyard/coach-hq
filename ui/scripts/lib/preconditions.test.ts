import { describe, expect, it } from "vitest";
import { checkPreconditions } from "./preconditions.js";
import type { RepoDataProfile } from "./repoDataProfile.js";

function profile(overrides: Partial<RepoDataProfile> = {}): RepoDataProfile {
  return {
    currentWeek: { dataStatus: "placeholder", sessionCount: 0 },
    injuries: { activeCount: 0, resolvedCount: 0 },
    quests: { count: 0, hasHabitQuest: false },
    coachingStyle: null,
    templateCount: 0,
    ...overrides,
  };
}

describe("checkPreconditions", () => {
  it("is met when no preconditions are given", () => {
    expect(checkPreconditions(profile(), {})).toEqual({ met: true });
  });

  it("catches the real ambiguous-contradiction false positive - an empty week fails currentWeekHasSessions", () => {
    const { met, reason } = checkPreconditions(profile(), { currentWeekHasSessions: true });
    expect(met).toBe(false);
    expect(reason).toContain("currentWeekHasSessions");
  });

  it("passes currentWeekHasSessions once the week has a real session", () => {
    const p = profile({ currentWeek: { dataStatus: "live", sessionCount: 1 } });
    expect(checkPreconditions(p, { currentWeekHasSessions: true })).toEqual({ met: true });
  });

  it("catches the real workout-lifecycle/template-edit-permanent gap - injuryFlags 'any' fails with no active flag", () => {
    const { met, reason } = checkPreconditions(profile(), { injuryFlags: "any" });
    expect(met).toBe(false);
    expect(reason).toContain("injuryFlags");
  });

  it("passes injuryFlags 'any' once a real flag is active", () => {
    const p = profile({ injuries: { activeCount: 1, resolvedCount: 0 } });
    expect(checkPreconditions(p, { injuryFlags: "any" })).toEqual({ met: true });
  });

  it("fails injuryFlags 'none' when a flag is active", () => {
    const p = profile({ injuries: { activeCount: 1, resolvedCount: 0 } });
    const { met, reason } = checkPreconditions(p, { injuryFlags: "none" });
    expect(met).toBe(false);
    expect(reason).toContain("injuryFlags");
  });

  it("catches the real quest-event gap - hasHabitQuest fails with no habit quest on file", () => {
    const { met, reason } = checkPreconditions(profile(), { hasHabitQuest: true });
    expect(met).toBe(false);
    expect(reason).toContain("hasHabitQuest");
  });

  it("passes hasHabitQuest once a real habit quest is active", () => {
    const p = profile({ quests: { count: 1, hasHabitQuest: true } });
    expect(checkPreconditions(p, { hasHabitQuest: true })).toEqual({ met: true });
  });

  it("checks hasTemplate against a real template count", () => {
    expect(checkPreconditions(profile(), { hasTemplate: true }).met).toBe(false);
    expect(checkPreconditions(profile({ templateCount: 1 }), { hasTemplate: true })).toEqual({
      met: true,
    });
  });

  it("checks every given field, not just the first", () => {
    const p = profile({ injuries: { activeCount: 1, resolvedCount: 0 } });
    // injuryFlags is met, currentWeekHasSessions is not - the unmet one must still be reported.
    const { met, reason } = checkPreconditions(p, {
      injuryFlags: "any",
      currentWeekHasSessions: true,
    });
    expect(met).toBe(false);
    expect(reason).toContain("currentWeekHasSessions");
  });
});
