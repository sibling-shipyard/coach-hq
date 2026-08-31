import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCurrentWeek, type CurrentWeek, type CurrentWeekSession } from "@/lib/currentWeek";
import type { Workout, WorkoutsData } from "@/lib/workouts";
import { selectWorkoutsPage, resolveDayHero } from "./workoutPage";

const STRENGTH: Workout = {
  id: "strength-a",
  title: "Strength A",
  subtitle: "Lower body",
  workout_type: "strength",
  estimated_duration_mins: 40,
  location: "Gym",
  equipment: ["Barbell"],
  coaching_note: "Bar speed over weight.",
  phases: [
    {
      name: "Main",
      duration: "30 min",
      default_rest_secs: 120,
      exercises: [
        {
          num: 1,
          name: "Back squat",
          type: "reps",
          reps: 5,
          sets: 4,
          form_cue: "Stay tall.",
          why: "Force.",
        },
      ],
    },
  ],
};

const EMPTY_WORKOUTS: WorkoutsData = { templates: [STRENGTH], sessions: [] };

function addDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isoWeekId(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const daysSinceYearStart = Math.floor((date.getTime() - yearStart.getTime()) / 86_400_000) + 1;
  const week = Math.ceil(daysSinceYearStart / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

function session(date: string, overrides: Partial<CurrentWeekSession> = {}): CurrentWeekSession {
  return {
    id: `sess_${date.replace(/-/g, "")}_1`,
    origin: "planned",
    discipline: "strength",
    kind: "strength",
    title: "Strength A",
    priority: "anchor",
    status: "planned",
    planned_duration_min: 40,
    planned_load: null,
    template_id: "strength-a",
    session_file: null,
    coach_note: null,
    original_date: null,
    completion_activity_ids: [],
    ...overrides,
  };
}

function liveWeek(opts: {
  timezone: string;
  monday: string;
  sessionsByOffset?: Record<number, CurrentWeekSession[]>;
}): CurrentWeek {
  const { timezone, monday, sessionsByOffset = {} } = opts;
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    return {
      date,
      intent: sessionsByOffset[i]?.length ? "train" : null,
      coach_note: null,
      sessions: sessionsByOffset[i] ?? [],
    };
  });
  const end = addDays(monday, 6);
  return {
    schema_version: 1,
    data_status: "live",
    timezone,
    week: {
      id: isoWeekId(monday),
      start_date: monday,
      end_date: end,
      focus: "Build the week.",
      guardrails: [],
    },
    coach_read: {
      headline: "Steady week ahead.",
      body: "Protect the work that is actually on the page.",
      valid_from: monday,
      valid_until: end,
    },
    days,
    coach_comments: [],
    updated_at: `${monday}T12:00:00Z`,
    updated_by: "test",
    trace_id: "test-workout-page",
  };
}

function assertLive(week: CurrentWeek) {
  const runtime = parseCurrentWeek(week);
  expect(runtime.issues, runtime.issues.join("; ")).toEqual([]);
  expect(runtime.availability.available).toBe(true);
}

describe("selectWorkoutsPage", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("live runnable: today's template_id resolves to the session file when present", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00Z"));
    const week = liveWeek({
      timezone: "UTC",
      monday: "2026-08-17",
      sessionsByOffset: {
        0: [session("2026-08-17", { session_file: "sessions/strength-a.json" })],
      },
    });
    assertLive(week);
    const todaysSession = {
      ...STRENGTH,
      session_date: "2026-08-17",
      based_on_template: "strength-a",
    };
    const result = selectWorkoutsPage(
      { templates: [STRENGTH], sessions: [todaysSession] },
      week,
      [],
    );
    expect(result.today).toMatchObject({ kind: "runnable", from: "session", done: false });
    if (result.today.kind === "runnable") {
      expect(result.today.workout.session_date).toBe("2026-08-17");
    }
    expect(result.week).toHaveLength(7);
    expect(result.week?.[0]).toMatchObject({
      date: "2026-08-17",
      source: "plan",
      title: "Strength A",
      durationMin: 40,
      isToday: true,
      timing: "today",
      planStatus: "planned",
    });
  });

  it("live runnable stays runnable when status is done, and falls back to the template", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00Z"));
    const week = liveWeek({
      timezone: "UTC",
      monday: "2026-08-17",
      sessionsByOffset: {
        0: [session("2026-08-17", { status: "done" })],
      },
    });
    assertLive(week);
    const result = selectWorkoutsPage(EMPTY_WORKOUTS, week, []);
    expect(result.today).toEqual({
      kind: "runnable",
      from: "template",
      done: true,
      workout: STRENGTH,
    });
  });

  it("live mention: template_id null is a line, not Rest (badminton)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T12:00:00Z"));
    const week = liveWeek({
      timezone: "UTC",
      monday: "2026-08-17",
      sessionsByOffset: {
        2: [
          session("2026-08-19", {
            discipline: "badminton",
            kind: "competitive",
            title: "Ranked court",
            template_id: null,
            planned_duration_min: 90,
          }),
        ],
      },
    });
    assertLive(week);
    const result = selectWorkoutsPage(EMPTY_WORKOUTS, week, []);
    expect(result.today).toEqual({
      kind: "mention",
      title: "Ranked court",
      durationMin: 90,
    });
    expect(result.week?.[2]).toMatchObject({
      source: "plan",
      title: "Ranked court",
      durationMin: 90,
      sport: "badminton",
    });
  });

  it("live rest: live plan and no session today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-18T12:00:00Z"));
    const week = liveWeek({
      timezone: "UTC",
      monday: "2026-08-17",
      sessionsByOffset: {
        0: [session("2026-08-17")],
      },
    });
    assertLive(week);
    const result = selectWorkoutsPage(EMPTY_WORKOUTS, week, []);
    expect(result.today).toEqual({ kind: "rest" });
    expect(result.week?.[1]).toMatchObject({ date: "2026-08-18", source: "empty", timing: "today", isToday: true });
  });

  it("no-plan with Mon strength + Wed badminton in hist: week visible, today none", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T12:00:00Z"));
    const result = selectWorkoutsPage(
      EMPTY_WORKOUTS,
      null,
      [
        { start: "2026-08-17T08:00:00Z", sport: "strength", title: "Strength A" },
        { start: "2026-08-19T18:00:00Z", sport: "badminton", title: "Ranked court" },
      ],
      "UTC",
    );
    expect(result.today).toEqual({ kind: "none" });
    expect(result.week).not.toBeNull();
    expect(result.week).toHaveLength(7);
    expect(result.week?.[0]).toMatchObject({
      date: "2026-08-17",
      source: "activity",
      title: "Strength A",
      sport: "strength",
    });
    expect(result.week?.[1]).toMatchObject({ date: "2026-08-18", source: "empty" });
    expect(result.week?.[2]).toMatchObject({
      date: "2026-08-19",
      source: "activity",
      title: "Ranked court",
      sport: "badminton",
    });
  });

  it("no-plan and no hist: week is null", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T12:00:00Z"));
    const result = selectWorkoutsPage(EMPTY_WORKOUTS, undefined, [], "UTC");
    expect(result.today).toEqual({ kind: "none" });
    expect(result.week).toBeNull();
  });

  it("timezone: UTC-8 browser and UTC+5:30 athlete resolve the same athlete-local day", () => {
    vi.useFakeTimers();
    // 20:00 UTC 15 Jan = 12:00 on the 15th in UTC-8, 01:30 on the 16th in Asia/Kolkata.
    vi.setSystemTime(new Date("2026-01-15T20:00:00.000Z"));
    const week = liveWeek({
      timezone: "Asia/Kolkata",
      monday: "2026-01-12",
      sessionsByOffset: {
        4: [session("2026-01-16")],
      },
    });
    assertLive(week);

    const dayIn = (timeZone: string) =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
        .formatToParts(new Date())
        .reduce<Record<string, string>>((acc, part) => {
          acc[part.type] = part.value;
          return acc;
        }, {});
    const utc8 = dayIn("Pacific/Pitcairn");
    const athlete = dayIn("Asia/Kolkata");
    expect(`${utc8.year}-${utc8.month}-${utc8.day}`).toBe("2026-01-15");
    expect(`${athlete.year}-${athlete.month}-${athlete.day}`).toBe("2026-01-16");

    const result = selectWorkoutsPage(EMPTY_WORKOUTS, week, []);
    expect(result.today.kind).toBe("runnable");
    if (result.today.kind === "runnable") {
      expect(result.today.workout.id).toBe("strength-a");
    }
    expect(result.week?.[4]).toMatchObject({ date: "2026-01-16", source: "plan" });
  });

  it("resolveDayHero: week row with template_id opens the workout", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00Z"));
    const week = liveWeek({
      timezone: "UTC",
      monday: "2026-08-17",
      sessionsByOffset: {
        0: [session("2026-08-17")],
      },
    });
    const result = selectWorkoutsPage(EMPTY_WORKOUTS, week, []);
    const monday = result.week?.[0];
    expect(monday).toBeDefined();
    const hero = resolveDayHero(monday!, EMPTY_WORKOUTS);
    expect(hero).toMatchObject({ kind: "runnable", from: "template" });
  });

  it("never crashes on garbage current_week, and skips _manifest templates", () => {
    const workouts: WorkoutsData = {
      templates: [STRENGTH, { ...STRENGTH, id: "_manifest", title: "Manifest" }],
      sessions: [],
    };
    expect(() =>
      selectWorkoutsPage(workouts, { nope: true }, "not-an-array" as never),
    ).not.toThrow();
    const result = selectWorkoutsPage(workouts, { nope: true }, []);
    expect(result.today).toEqual({ kind: "none" });
  });
});
