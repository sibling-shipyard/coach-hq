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

  // A2b: the object form always wants `true` (there's no honest way to seed a repo back to
  // false) and surfaces its seedMessages back on an unmet result, so run-simulation-suite.ts
  // knows there's a real recipe to try before falling back to a skip.
  describe("A2b seed recipes", () => {
    it("surfaces currentWeekHasSessions's seedMessages when unmet", () => {
      const { met, reason, seedMessages } = checkPreconditions(profile(), {
        currentWeekHasSessions: { seedMessages: ["lay out my week"] },
      });
      expect(met).toBe(false);
      expect(reason).toContain("currentWeekHasSessions");
      expect(seedMessages).toEqual(["lay out my week"]);
    });

    it("passes the object form once the week has a real session, same as the plain boolean", () => {
      const p = profile({ currentWeek: { dataStatus: "live", sessionCount: 1 } });
      expect(
        checkPreconditions(p, { currentWeekHasSessions: { seedMessages: ["lay out my week"] } }),
      ).toEqual({ met: true });
    });

    it("surfaces hasHabitQuest's seedMessages when unmet", () => {
      const { seedMessages } = checkPreconditions(profile(), {
        hasHabitQuest: { seedMessages: ["start a new habit quest"] },
      });
      expect(seedMessages).toEqual(["start a new habit quest"]);
    });

    it("surfaces hasTemplate's seedMessages when unmet", () => {
      const { seedMessages } = checkPreconditions(profile(), {
        hasTemplate: { seedMessages: ["build me a workout"] },
      });
      expect(seedMessages).toEqual(["build me a workout"]);
    });

    it("surfaces injuryFlags's seedMessages when unmet via the { need, seedMessages } form", () => {
      const { met, reason, seedMessages } = checkPreconditions(profile(), {
        injuryFlags: { need: "any", seedMessages: ["my knee's been sore for a few days"] },
      });
      expect(met).toBe(false);
      expect(reason).toContain("injuryFlags");
      expect(seedMessages).toEqual(["my knee's been sore for a few days"]);
    });

    it("passes the { need, seedMessages } injuryFlags form once a real flag is active", () => {
      const p = profile({ injuries: { activeCount: 1, resolvedCount: 0 } });
      expect(
        checkPreconditions(p, { injuryFlags: { need: "any", seedMessages: ["sore knee"] } }),
      ).toEqual({ met: true });
    });

    it("reports no seedMessages for a plain boolean/string precondition - the skip fallback stays the only option", () => {
      const { seedMessages: boolSeed } = checkPreconditions(profile(), {
        hasTemplate: true,
      });
      expect(boolSeed).toBeUndefined();
      const { seedMessages: injurySeed } = checkPreconditions(profile(), { injuryFlags: "any" });
      expect(injurySeed).toBeUndefined();
    });
  });
});
