import { parseCurrentWeek, type CurrentWeekSession } from "@/lib/currentWeek";
import type { Workout, WorkoutsData } from "@/lib/workouts";

export type TodayHero =
  | { kind: "runnable"; workout: Workout; from: "session" | "template"; done: boolean }
  | { kind: "mention"; title: string; durationMin: number | null }
  | { kind: "rest" }
  | { kind: "none" };

export type WeekDayTiming = "past" | "today" | "upcoming";
export type WeekDayPlanStatus = "done" | "planned" | "skipped";

export type WeekDay = {
  date: string;
  source: "plan" | "activity" | "empty";
  title: string | null;
  durationMin: number | null;
  /** Sport vein colour. Mapped from plan discipline or activity sport. */
  sport: string | null;
  isToday: boolean;
  timing: WeekDayTiming;
  /** From current_week session status when source is plan; null otherwise. */
  planStatus: WeekDayPlanStatus | null;
  templateId: string | null;
  sessionFile: string | null;
};

export type WorkoutPageActivity = {
  start: string;
  sport?: string;
  title?: string;
};

function isManifestId(id: string): boolean {
  return id === "_manifest" || id.endsWith("_manifest");
}

function templatesOf(workouts: WorkoutsData): Workout[] {
  return (workouts.templates ?? []).filter((t) => t.id && !isManifestId(t.id));
}

function sessionsOf(workouts: WorkoutsData): Workout[] {
  return workouts.sessions ?? [];
}

function formatDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function addDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mondayOfIsoWeek(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - (day - 1));
  return date.toISOString().slice(0, 10);
}

function peekTimezone(currentWeek: unknown): string | null {
  if (typeof currentWeek !== "object" || currentWeek === null) return null;
  const tz = (currentWeek as { timezone?: unknown }).timezone;
  return typeof tz === "string" && isValidTimeZone(tz) ? tz : null;
}

/**
 * Activity `start` is athlete-local (Strava-style, often with a fake trailing Z).
 * Take the calendar date; do not convert through the browser.
 */
function activityDateKey(start: string): string | null {
  const match = start.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function sessionFileId(sessionFile: string): string {
  const base = sessionFile.split("/").pop() ?? sessionFile;
  return base.replace(/\.json$/i, "");
}

function resolveRunnable(
  templateId: string,
  sessionFile: string | null,
  today: string,
  workouts: WorkoutsData,
): { workout: Workout; from: "session" | "template" } | null {
  const sessions = sessionsOf(workouts);
  const fileId = sessionFile ? sessionFileId(sessionFile) : null;

  const session =
    (fileId ? sessions.find((s) => s.id === fileId && s.session_date === today) : undefined) ??
    sessions.find(
      (s) =>
        s.session_date === today && (s.id === templateId || s.based_on_template === templateId),
    );
  if (session) return { workout: session, from: "session" };

  const template = templatesOf(workouts).find((t) => t.id === templateId);
  if (template) return { workout: template, from: "template" };
  return null;
}

function heroFromSession(
  session: CurrentWeekSession,
  date: string,
  workouts: WorkoutsData,
): TodayHero {
  if (session.template_id) {
    const resolved = resolveRunnable(session.template_id, session.session_file, date, workouts);
    if (resolved) {
      return { kind: "runnable", ...resolved, done: session.status === "done" };
    }
  }
  return {
    kind: "mention",
    title: session.title,
    durationMin: session.planned_duration_min,
  };
}

function todayHeroFromSession(
  session: CurrentWeekSession,
  today: string,
  workouts: WorkoutsData,
): TodayHero {
  return heroFromSession(session, today, workouts);
}

/** Resolve the detail panel for a week row (runnable, mention, or rest). */
export function resolveDayHero(day: WeekDay, workouts: WorkoutsData): TodayHero {
  if (day.source === "empty") return { kind: "rest" };
  if (day.templateId) {
    const resolved = resolveRunnable(day.templateId, day.sessionFile, day.date, workouts);
    if (resolved) {
      return {
        kind: "runnable",
        ...resolved,
        done: day.planStatus === "done",
      };
    }
  }
  if (day.title) {
    return { kind: "mention", title: day.title, durationMin: day.durationMin };
  }
  return { kind: "rest" };
}

function dayTiming(date: string, today: string): WeekDayTiming {
  if (date === today) return "today";
  return date < today ? "past" : "upcoming";
}

function sevenDates(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

function emptyDay(date: string, today: string): WeekDay {
  return {
    date,
    source: "empty",
    title: null,
    durationMin: null,
    sport: null,
    isToday: date === today,
    timing: dayTiming(date, today),
    planStatus: null,
    templateId: null,
    sessionFile: null,
  };
}

function firstActivityByDate(activities: WorkoutPageActivity[]): Map<string, WorkoutPageActivity> {
  const map = new Map<string, WorkoutPageActivity>();
  for (const activity of activities) {
    const date = activityDateKey(activity.start);
    if (!date || map.has(date)) continue;
    map.set(date, activity);
  }
  return map;
}

function histWeekDays(dates: string[], today: string, activities: WorkoutPageActivity[]): WeekDay[] {
  const byDate = firstActivityByDate(activities);
  return dates.map((date) => {
    const activity = byDate.get(date);
    if (!activity) return emptyDay(date, today);
    return {
      date,
      source: "activity",
      title: activity.title ?? activity.sport ?? null,
      durationMin: null,
      sport: activity.sport ?? null,
      isToday: date === today,
      timing: dayTiming(date, today),
      planStatus: null,
      templateId: null,
      sessionFile: null,
    };
  });
}

/**
 * "today" from current_week.timezone when live, else athlete tz if known — never the browser.
 */
export function selectWorkoutsPage(
  workouts: WorkoutsData,
  currentWeek: unknown,
  activities: WorkoutPageActivity[],
  athleteTimezone?: string,
): { today: TodayHero; week: WeekDay[] | null } {
  const safeWorkouts: WorkoutsData = {
    templates: Array.isArray(workouts?.templates) ? workouts.templates : [],
    sessions: Array.isArray(workouts?.sessions) ? workouts.sessions : [],
  };
  const safeActivities = Array.isArray(activities) ? activities : [];

  let runtime;
  try {
    runtime = parseCurrentWeek(currentWeek);
  } catch {
    runtime = null;
  }

  const live = Boolean(runtime?.availability.available && runtime.data);
  const timezone =
    (live && runtime?.data?.timezone) ||
    runtime?.data?.timezone ||
    (athleteTimezone && isValidTimeZone(athleteTimezone) ? athleteTimezone : null) ||
    peekTimezone(currentWeek) ||
    "UTC";
  const today = formatDateInTimeZone(new Date(), timezone);

  if (live && runtime?.data) {
    const plan = runtime.data;
    const todayDay = plan.days.find((day) => day.date === today);
    const todaySession = todayDay?.sessions[0];
    const todayHero: TodayHero = todaySession
      ? todayHeroFromSession(todaySession, today, safeWorkouts)
      : { kind: "rest" };

    const week: WeekDay[] = sevenDates(plan.week.start_date).map((date, i) => {
      const day = plan.days[i];
      const session = day?.sessions[0];
      if (session) {
        return {
          date,
          source: "plan",
          title: session.title,
          durationMin: session.planned_duration_min,
          sport: session.discipline,
          isToday: date === today,
          timing: dayTiming(date, today),
          planStatus: session.status,
          templateId: session.template_id,
          sessionFile: session.session_file,
        };
      }
      return emptyDay(date, today);
    });

    return { today: todayHero, week };
  }

  const weekDates = sevenDates(mondayOfIsoWeek(today));
  const week = histWeekDays(weekDates, today, safeActivities);
  const hasHist = week.some((day) => day.source === "activity");
  return { today: { kind: "none" }, week: hasHist ? week : null };
}
