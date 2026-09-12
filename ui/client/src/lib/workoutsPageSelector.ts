/**
 * Athlete OS — Workouts page selector.
 *
 * Pure functions that turn the same data Home already reads (current_week.json's parsed
 * runtime, synced activities, and the athlete's own workout library) into the three bands
 * the Workouts page renders: today, this week, library. No new storage, no state machine —
 * just picking which existing row applies.
 *
 * "This week" reuses the exact live-week contract Home falls back to (adaptCurrentWeek when
 * the plan is live, buildLiveWeekContract otherwise) rather than re-deriving day rows from
 * activities a second time.
 */
import { adaptCurrentWeek } from "@/components/home-warm/currentWeekAdapter";
import { buildLiveWeekContract } from "@/components/home-warm/liveWeekContract";
import type {
  CurrentWeekContract,
  CurrentWeekDay,
  SessionDiscipline,
} from "@/components/home-warm/currentWeek.fixture";
import type { Activity } from "@/lib/activities";
import type { CurrentWeek, CurrentWeekRuntime } from "@/lib/currentWeek";
import { Workout, WorkoutsData, validSessions, validTemplates } from "@/lib/workouts";

export type TodayBand =
  | { kind: "runnable"; workout: Workout; from: "session" | "template"; done: boolean }
  | { kind: "mention"; title: string; durationMin: number | null }
  | { kind: "rest" }
  | { kind: "none" };

export interface WeekRow {
  date: string;
  source: "filled" | "empty";
  title: string | null;
  durationMin: number | null;
  discipline: SessionDiscipline | null;
  isToday: boolean;
}

export interface WorkoutsPageSelection {
  today: TodayBand;
  /** null means the band hides entirely — no live plan and nothing logged this ISO week. */
  week: WeekRow[] | null;
}

export interface WorkoutsPageInput {
  workouts: WorkoutsData;
  currentWeek: CurrentWeekRuntime;
  activities: Activity[];
  /** The athlete's own known timezone (profile.timezone), used only when the week isn't live. */
  athleteTimezone?: string;
  now?: Date;
}

function isValidTimeZone(value: string | undefined): value is string {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
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

function sessionFileId(sessionFile: string): string {
  const base = sessionFile.split("/").pop() ?? sessionFile;
  return base.replace(/\.json$/i, "");
}

/** The coach-adjusted session file for today if one exists, otherwise the base template. */
function resolveRunnable(
  templateId: string,
  sessionFile: string | null,
  today: string,
  workouts: WorkoutsData,
): { workout: Workout; from: "session" | "template" } | null {
  const sessions = validSessions(workouts);
  const fileId = sessionFile ? sessionFileId(sessionFile) : null;

  const session =
    (fileId ? sessions.find((s) => s.id === fileId && s.session_date === today) : undefined) ??
    sessions.find(
      (s) =>
        s.session_date === today && (s.id === templateId || s.based_on_template === templateId),
    );
  if (session) return { workout: session, from: "session" };

  const template = validTemplates(workouts).find((t) => t.id === templateId);
  if (template) return { workout: template, from: "template" };
  return null;
}

/**
 * Live plus a session with a real routine is runnable (whether or not it's done). Live plus
 * a day with no routine, like a match or a hike, is a one-line mention — never "Rest." Live
 * with nothing scheduled today is Rest.
 */
function selectTodayBand(plan: CurrentWeek, today: string, workouts: WorkoutsData): TodayBand {
  const day = plan.days.find((d) => d.date === today);
  const session = day?.sessions[0];
  if (!session) return { kind: "rest" };

  if (session.template_id) {
    const resolved = resolveRunnable(session.template_id, session.session_file, today, workouts);
    if (resolved) {
      return {
        kind: "runnable",
        workout: resolved.workout,
        from: resolved.from,
        done: session.status === "done",
      };
    }
  }
  return { kind: "mention", title: session.title, durationMin: session.planned_duration_min };
}

/** Every day in the week list is either the plan's row, a logged activity, or blank. */
function rowFromDay(day: CurrentWeekDay, today: string): WeekRow {
  const session = day.sessions[0];
  const isToday = day.date === today;
  if (!session) {
    return {
      date: day.date,
      source: "empty",
      title: null,
      durationMin: null,
      discipline: null,
      isToday,
    };
  }
  return {
    date: day.date,
    source: "filled",
    title: session.title,
    durationMin: session.planned_duration_min,
    discipline: session.discipline,
    isToday,
  };
}

function weekRows(contract: CurrentWeekContract, live: boolean, today: string): WeekRow[] | null {
  const rows = contract.days.map((day) => rowFromDay(day, today));
  if (live) return rows;
  // Not live: hide the band entirely unless there's logged activity to show for the week.
  return rows.some((row) => row.source === "filled") ? rows : null;
}

/**
 * "Today" is always computed from the week's own timezone when live, or the athlete's known
 * timezone otherwise — never the browser's.
 */
export function selectWorkoutsPage(input: WorkoutsPageInput): WorkoutsPageSelection {
  const { workouts, currentWeek, activities, athleteTimezone, now = new Date() } = input;
  const live = currentWeek.availability.available && currentWeek.data != null;
  const plan = live ? currentWeek.data! : null;

  const timezone = plan
    ? plan.timezone
    : isValidTimeZone(athleteTimezone)
      ? athleteTimezone
      : "UTC";
  const today = formatDateInTimeZone(now, timezone);

  const contract = plan
    ? adaptCurrentWeek(plan, currentWeek.availability, activities)
    : buildLiveWeekContract(activities, undefined, now);

  return {
    today: plan ? selectTodayBand(plan, today, workouts) : { kind: "none" },
    week: weekRows(contract, live, today),
  };
}
