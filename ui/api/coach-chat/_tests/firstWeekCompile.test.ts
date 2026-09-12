import { describe, it, expect } from "vitest";
import {
  compileFirstWeek,
  mondayOfWeekContaining,
  primaryDiscipline,
} from "../_lib/decide/firstWeekCompile.js";
import { applyWeekUpdate } from "../_lib/decide/coachWeekFiles.js";
import type { TrainingAvailability } from "../_lib/decide/coachMemoryFiles.js";

// A3 (#727): the first-week compile step. Builds a WeekUpdate and runs it through the real
// applyWeekUpdate (coachWeekFiles.ts) - the same machinery a real week_update kickoff uses - so
// these tests check the compiled week is actually commit-ready, not just shaped right.

const TODAY = "2026-09-07"; // a Monday - the earliest day of its own week, so every later
// training day this suite exercises (Tuesday, Wednesday, Friday) is still in the future relative
// to today. See the dedicated "today or later" describe block below for the case where a training
// day has already passed this week.

describe("mondayOfWeekContaining", () => {
  it("finds the Monday of the week containing a mid-week date", () => {
    expect(mondayOfWeekContaining("2026-09-12")).toBe("2026-09-07");
  });

  it("returns the date itself when it's already a Monday", () => {
    expect(mondayOfWeekContaining("2026-09-07")).toBe("2026-09-07");
  });
});

describe("primaryDiscipline", () => {
  it("matches a known sport case-insensitively", () => {
    expect(primaryDiscipline(["Badminton"])).toBe("badminton");
  });

  it("falls back to strength when nothing matches", () => {
    expect(primaryDiscipline(["Underwater basket weaving"])).toBe("strength");
  });
});

describe("compileFirstWeek", () => {
  const base = {
    today: TODAY,
    benchmarkRoutineId: "first_session_benchmark",
    benchmarkTitle: "First session benchmark",
    sports: ["Badminton"],
  };

  it("places sessions only on the athlete's stated training days", () => {
    const availability: TrainingAvailability = {
      days_per_week: 2,
      preferred_days: ["tuesday", "friday"],
    };
    const update = compileFirstWeek({ ...base, availability });
    const withSessions = update.days.filter((d) => (d.sessions?.length ?? 0) > 0);
    expect(withSessions.length).toBe(2);
    const dates = new Set(withSessions.map((d) => d.date));
    expect(dates.has("2026-09-08")).toBe(true); // Tuesday
    expect(dates.has("2026-09-11")).toBe(true); // Friday
  });

  it("puts the benchmark on the first stated training day, template_id included", () => {
    const availability: TrainingAvailability = {
      days_per_week: 2,
      preferred_days: ["tuesday", "friday"],
    };
    const update = compileFirstWeek({ ...base, availability });
    const tuesday = update.days.find((d) => d.date === "2026-09-08")!;
    expect(tuesday.sessions?.[0]?.template_id).toBe("first_session_benchmark");
    expect(tuesday.sessions?.[0]?.title).toBe("First session benchmark");
  });

  it("an athlete who stated zero days still gets a full, valid seven-day week", () => {
    const availability: TrainingAvailability = { days_per_week: 0, preferred_days: [] };
    const update = compileFirstWeek({ ...base, availability });
    expect(update.days.length).toBe(7);
    expect(update.days.every((d) => (d.sessions?.length ?? 0) === 0)).toBe(true);
    expect(update.headline?.trim()).toBeTruthy();
    expect(update.body?.trim()).toBeTruthy();

    // Not just shaped right - actually commit-ready through the real applier.
    const content = applyWeekUpdate(
      null,
      update,
      new Set(["first_session_benchmark"]),
      "Asia/Kolkata",
      "t1",
      new Date("2026-09-12T00:00:00Z"),
    );
    const parsed = JSON.parse(content);
    expect(parsed.days.length).toBe(7);
  });

  it("spreads an unnamed days_per_week evenly rather than bunching at the start of the week", () => {
    const availability: TrainingAvailability = { days_per_week: 3, preferred_days: [] };
    const update = compileFirstWeek({ ...base, availability });
    const withSessions = update.days.filter((d) => (d.sessions?.length ?? 0) > 0);
    expect(withSessions.length).toBe(3);
    // Not the first three consecutive days of the week.
    const dates = withSessions.map((d) => d.date).sort();
    expect(dates).not.toEqual(["2026-09-07", "2026-09-08", "2026-09-09"]);
  });

  it("compiles to a real commit-ready current_week.json end to end", () => {
    const availability: TrainingAvailability = {
      days_per_week: 3,
      preferred_days: ["monday", "wednesday", "friday"],
    };
    const update = compileFirstWeek({ ...base, availability });
    const content = applyWeekUpdate(
      null,
      update,
      new Set(["first_session_benchmark"]),
      "Asia/Kolkata",
      "t1",
      new Date("2026-09-12T00:00:00Z"),
    );
    const parsed = JSON.parse(content);
    expect(parsed.week.start_date).toBe("2026-09-07");
    expect(parsed.week.end_date).toBe("2026-09-13");
    const sessionDays = parsed.days.filter((d: { sessions: unknown[] }) => d.sessions.length > 0);
    expect(sessionDays.length).toBe(3);
  });

  describe("regression: a training day already passed this week", () => {
    const lateWeekToday = "2026-09-10"; // a Thursday, same week as TODAY (Monday 09-07)

    it("places nothing on a training day earlier in the week than today", () => {
      const availability: TrainingAvailability = {
        days_per_week: 2,
        preferred_days: ["monday", "tuesday"], // both already passed by Thursday
      };
      const update = compileFirstWeek({ ...base, today: lateWeekToday, availability });
      const withSessions = update.days.filter((d) => (d.sessions?.length ?? 0) > 0);
      expect(withSessions).toEqual([]);
    });

    it("still places the benchmark on a training day that's today or later, skipping only the passed ones", () => {
      const availability: TrainingAvailability = {
        days_per_week: 3,
        preferred_days: ["monday", "thursday", "friday"], // monday already passed
      };
      const update = compileFirstWeek({ ...base, today: lateWeekToday, availability });
      const thursday = update.days.find((d) => d.date === "2026-09-10")!;
      expect(thursday.sessions?.[0]?.template_id).toBe("first_session_benchmark");
      const monday = update.days.find((d) => d.date === "2026-09-07")!;
      expect(monday.sessions ?? []).toEqual([]);
    });
  });
});
