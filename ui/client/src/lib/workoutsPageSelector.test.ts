import { describe, it, expect } from "vitest";
import { selectWorkoutsPage } from "./workoutsPageSelector";
import type {
  CurrentWeek,
  CurrentWeekAvailability,
  CurrentWeekRuntime,
  CurrentWeekSession,
} from "@/lib/currentWeek";
import type { Activity } from "@/lib/activities";
import type { Workout, WorkoutsData } from "@/lib/workouts";

function activity(overrides: Partial<Activity>): Activity {
  return {
    id: overrides.id ?? "act-1",
    name: overrides.name ?? "Evening ride",
    sport_type: overrides.sport_type ?? "Ride",
    start_date_local: overrides.start_date_local ?? "2026-08-03T18:00:00",
    elapsed_time: overrides.elapsed_time ?? 3600,
    moving_time: overrides.moving_time ?? 3600,
    calories: overrides.calories ?? 500,
    distance: overrides.distance ?? 20000,
    total_elevation_gain: overrides.total_elevation_gain ?? 100,
    average_heartrate: overrides.average_heartrate ?? 140,
    max_heartrate: overrides.max_heartrate ?? 160,
    has_heartrate: overrides.has_heartrate ?? true,
    hr_zones: overrides.hr_zones ?? null,
    description: overrides.description ?? null,
    max_speed: overrides.max_speed ?? 10,
    device_name: overrides.device_name ?? "Garmin",
  };
}

function session(overrides: Partial<CurrentWeekSession>): CurrentWeekSession {
  return {
    id: overrides.id ?? "session-1",
    origin: overrides.origin ?? "planned",
    discipline: overrides.discipline ?? "strength",
    kind: overrides.kind ?? "strength",
    title: overrides.title ?? "A day",
    priority: overrides.priority ?? "anchor",
    status: overrides.status ?? "planned",
    planned_duration_min: overrides.planned_duration_min ?? 45,
    template_id: overrides.template_id ?? null,
    session_file: overrides.session_file ?? null,
    coach_note: overrides.coach_note ?? null,
    original_date: overrides.original_date ?? null,
    completion_activity_ids: overrides.completion_activity_ids ?? [],
  };
}

const WEEK_DATES = [
  "2026-08-03",
  "2026-08-04",
  "2026-08-05",
  "2026-08-06",
  "2026-08-07",
  "2026-08-08",
  "2026-08-09",
];

function livePlan(sessionsByDate: Record<string, CurrentWeekSession[]>): CurrentWeek {
  return {
    schema_version: 1,
    data_status: "live",
    timezone: "UTC",
    week: {
      id: "2026-w32",
      start_date: "2026-08-03",
      end_date: "2026-08-09",
      focus: "Build baseline fitness",
      guardrails: [],
    },
    coach_read: {
      headline: "Steady week",
      body: "Hold the line.",
      valid_from: "2026-08-03",
      valid_until: "2026-08-09",
    },
    updated_at: "2026-08-03T00:00:00Z",
    updated_by: "coach",
    trace_id: "trace-test",
    days: WEEK_DATES.map((date) => ({
      date,
      intent: "train",
      coach_note: null,
      sessions: sessionsByDate[date] ?? [],
    })),
  };
}

function runtimeFor(
  plan: CurrentWeek,
  status: CurrentWeekAvailability["status"] = "current",
): CurrentWeekRuntime {
  const available = status === "current" || status === "grace";
  return {
    data: plan,
    availability: { status, available, reason: "test" },
    coachRead: plan.coach_read,
    issues: [],
  };
}

const MISSING_WEEK: CurrentWeekRuntime = {
  data: null,
  availability: { status: "invalid", available: false, reason: "no data" },
  coachRead: null,
  issues: [],
};

function template(id: string, extra: Partial<Workout> = {}): Workout {
  return {
    id,
    title: "A Day",
    subtitle: "Full body",
    workout_type: "strength",
    estimated_duration_mins: 45,
    location: "home",
    equipment: [],
    coaching_note: "",
    phases: [],
    ...extra,
  };
}

const EMPTY_WORKOUTS: WorkoutsData = { templates: [], sessions: [] };

describe("selectWorkoutsPage — today band", () => {
  it("is runnable when today's session resolves to a template, and not done", () => {
    const plan = livePlan({ "2026-08-03": [session({ template_id: "template-a" })] });
    const workouts: WorkoutsData = { templates: [template("template-a")], sessions: [] };

    const result = selectWorkoutsPage({
      workouts,
      currentWeek: runtimeFor(plan),
      activities: [],
      now: new Date("2026-08-03T12:00:00Z"),
    });

    expect(result.today).toEqual({
      kind: "runnable",
      workout: workouts.templates[0],
      from: "template",
      done: false,
    });
  });

  it("prefers a coach-adjusted session file over the base template, and reports done", () => {
    const adjusted = template("template-a", { id: "session-file-1", title: "Adjusted" });
    const plan = livePlan({
      "2026-08-03": [
        session({
          template_id: "template-a",
          session_file: "sessions/2026-08-03/session-file-1.json",
          status: "done",
        }),
      ],
    });
    const workouts: WorkoutsData = {
      templates: [template("template-a")],
      sessions: [{ ...adjusted, session_date: "2026-08-03" }],
    };

    const result = selectWorkoutsPage({
      workouts,
      currentWeek: runtimeFor(plan),
      activities: [],
      now: new Date("2026-08-03T12:00:00Z"),
    });

    expect(result.today).toMatchObject({ kind: "runnable", from: "session", done: true });
    if (result.today.kind === "runnable") {
      expect(result.today.workout.id).toBe("session-file-1");
    }
  });

  it("is a one-line mention, never a Rest label, when today's plan has no routine", () => {
    const plan = livePlan({
      "2026-08-03": [
        session({ template_id: null, title: "Badminton match", planned_duration_min: 90 }),
      ],
    });

    const result = selectWorkoutsPage({
      workouts: EMPTY_WORKOUTS,
      currentWeek: runtimeFor(plan),
      activities: [],
      now: new Date("2026-08-03T12:00:00Z"),
    });

    expect(result.today).toEqual({ kind: "mention", title: "Badminton match", durationMin: 90 });
  });

  it("falls back to a mention when the referenced template no longer exists", () => {
    const plan = livePlan({
      "2026-08-03": [session({ template_id: "gone", title: "Leg day", planned_duration_min: 40 })],
    });

    const result = selectWorkoutsPage({
      workouts: EMPTY_WORKOUTS,
      currentWeek: runtimeFor(plan),
      activities: [],
      now: new Date("2026-08-03T12:00:00Z"),
    });

    expect(result.today).toEqual({ kind: "mention", title: "Leg day", durationMin: 40 });
  });

  it("is Rest when live and nothing is scheduled today", () => {
    const plan = livePlan({});

    const result = selectWorkoutsPage({
      workouts: EMPTY_WORKOUTS,
      currentWeek: runtimeFor(plan),
      activities: [],
      now: new Date("2026-08-03T12:00:00Z"),
    });

    expect(result.today).toEqual({ kind: "rest" });
  });

  it("has no hero at all when there is no live plan", () => {
    const result = selectWorkoutsPage({
      workouts: EMPTY_WORKOUTS,
      currentWeek: MISSING_WEEK,
      activities: [],
      now: new Date("2026-08-03T12:00:00Z"),
    });

    expect(result.today).toEqual({ kind: "none" });
  });

  it("computes today from the plan's own timezone, not the browser's", () => {
    // 2026-08-04T02:00:00Z is 2026-08-03 in America/Los_Angeles (UTC-7 in August).
    const plan: CurrentWeek = {
      ...livePlan({ "2026-08-03": [session({ template_id: null, title: "Hike" })] }),
      timezone: "America/Los_Angeles",
    };

    const result = selectWorkoutsPage({
      workouts: EMPTY_WORKOUTS,
      currentWeek: runtimeFor(plan),
      activities: [],
      now: new Date("2026-08-04T02:00:00Z"),
    });

    expect(result.today).toEqual({ kind: "mention", title: "Hike", durationMin: 45 });
  });
});

describe("selectWorkoutsPage — this week band", () => {
  it("shows every day of a live plan even when some days are blank", () => {
    const plan = livePlan({ "2026-08-03": [session({ title: "A day" })] });

    const result = selectWorkoutsPage({
      workouts: EMPTY_WORKOUTS,
      currentWeek: runtimeFor(plan),
      activities: [],
      now: new Date("2026-08-03T12:00:00Z"),
    });

    expect(result.week).toHaveLength(7);
    expect(result.week?.[0]).toMatchObject({
      date: "2026-08-03",
      source: "filled",
      title: "A day",
    });
    expect(result.week?.[1]).toMatchObject({ date: "2026-08-04", source: "empty", title: null });
  });

  it("never hides the week band when the plan is live, even with no sessions at all", () => {
    const plan = livePlan({});

    const result = selectWorkoutsPage({
      workouts: EMPTY_WORKOUTS,
      currentWeek: runtimeFor(plan),
      activities: [],
      now: new Date("2026-08-03T12:00:00Z"),
    });

    expect(result.week).not.toBeNull();
    expect(result.week).toHaveLength(7);
  });

  it("shows only logged activity for the ISO week when not live", () => {
    const result = selectWorkoutsPage({
      workouts: EMPTY_WORKOUTS,
      currentWeek: MISSING_WEEK,
      activities: [activity({ start_date_local: "2026-08-04T18:00:00", name: "Evening ride" })],
      now: new Date("2026-08-04T12:00:00Z"),
    });

    expect(result.week).not.toBeNull();
    const filled = result.week?.filter((row) => row.source === "filled") ?? [];
    expect(filled).toHaveLength(1);
    expect(filled[0].title).toBe("Evening ride");
  });

  it("hides the week band entirely when not live and nothing was logged this week", () => {
    const result = selectWorkoutsPage({
      workouts: EMPTY_WORKOUTS,
      currentWeek: MISSING_WEEK,
      activities: [],
      now: new Date("2026-08-04T12:00:00Z"),
    });

    expect(result.week).toBeNull();
  });

  it("uses the athlete's known timezone, not the browser's, to mark today when not live", () => {
    const result = selectWorkoutsPage({
      workouts: EMPTY_WORKOUTS,
      currentWeek: MISSING_WEEK,
      activities: [activity({ start_date_local: "2026-08-03T18:00:00" })],
      athleteTimezone: "America/Los_Angeles",
      // 2026-08-04T02:00:00Z is still 2026-08-03 in America/Los_Angeles.
      now: new Date("2026-08-04T02:00:00Z"),
    });

    const todayRow = result.week?.find((row) => row.date === "2026-08-03");
    expect(todayRow?.isToday).toBe(true);
  });
});
