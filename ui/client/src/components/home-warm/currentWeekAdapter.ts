import { getTrainingCategory, parseLocal, type Activity } from "@/lib/activities";
import type {
  CurrentWeek as RuntimeCurrentWeek,
  CurrentWeekAvailability,
  CurrentWeekSession as RuntimeSession,
  CoachRead as RuntimeCoachRead,
} from "@/lib/currentWeek";
import type {
  CurrentWeekContract,
  CurrentWeekDataStatus,
  CurrentWeekDay,
  CurrentWeekSession,
  PlanIntent,
  SessionPriority,
  SessionStatus,
  WeekStatus,
} from "./currentWeek.fixture";
import { trainingCategoryToSessionDiscipline } from "./trainingMappings";

const DAY_MS = 24 * 60 * 60 * 1000;

const PLAN_INTENTS: readonly PlanIntent[] = ["train", "recovery", "open", "rest", "review"];

function mapDataStatus(status: RuntimeCurrentWeek["data_status"]): CurrentWeekDataStatus {
  return status;
}

function mapWeekStatus(availability: CurrentWeekAvailability["status"]): WeekStatus {
  if (availability === "current" || availability === "grace") return "active";
  if (availability === "upcoming" || availability === "placeholder") {
    return "draft";
  }
  return "complete";
}

function mapIntent(intent: string | null, hasSessions: boolean): PlanIntent {
  if (intent && (PLAN_INTENTS as readonly string[]).includes(intent)) {
    return intent as PlanIntent;
  }
  return hasSessions ? "train" : "open";
}

function mapPriority(priority: RuntimeSession["priority"]): SessionPriority {
  return priority ?? "support";
}

function mapStatus(session: RuntimeSession): SessionStatus {
  switch (session.status) {
    case "done":
      return "completed";
    case "skipped":
      return "skipped";
    default:
      return session.original_date ? "moved" : "planned";
  }
}

/** completion_activity_ids are qualified strings (`source:localId`); return the bare local ids for matching. */
function completionLocalIds(ids: string[]): string[] {
  return ids.map((id) => (id.includes(":") ? id.slice(id.lastIndexOf(":") + 1) : id));
}

function mapCoachRead(read: RuntimeCoachRead): CurrentWeekContract["coach_read"] {
  return {
    headline: read.headline,
    body: read.body,
    valid_from: read.valid_from,
    valid_until: read.valid_until,
  };
}

function mapPlannedSession(session: RuntimeSession): CurrentWeekSession {
  return {
    id: session.id,
    // ADR 0042: discipline is a closed enum end to end now, so the runtime value is already a
    // real SessionDiscipline member - no substring guessing needed to collapse it onto one.
    discipline: session.discipline,
    kind: session.kind,
    title: session.title,
    priority: mapPriority(session.priority),
    status: mapStatus(session),
    planned_duration_min: session.planned_duration_min,
    // ADR 0042 drops planned_load from the schema - no writer ever set it to a real value
    // (docs/plans/current-week-redesign-lld.md's consumer audit). The widget contract still
    // carries the field; hardcode null rather than widen the contract in this PR.
    planned_load: null,
    template_id: session.template_id,
    session_file: session.session_file,
    coach_note: session.coach_note,
    completion_activity_ids: completionLocalIds(session.completion_activity_ids),
  };
}

/** A synced activity that no planned session has claimed yet — a deviation or an unreconciled log. */
function overlaySession(activity: Activity): CurrentWeekSession {
  const category = getTrainingCategory(activity);
  return {
    id: `activity-${activity.id}`,
    discipline: trainingCategoryToSessionDiscipline(category),
    kind: category,
    title: activity.name,
    priority: "support",
    status: "completed",
    planned_duration_min: Math.round(activity.elapsed_time / 60),
    planned_load: null,
    template_id: null,
    session_file: null,
    coach_note: null,
    completion_activity_ids: [String(activity.id)],
  };
}

/**
 * Adapt the coach-authored `current_week.json` (schema v1) into the Warm Instrument
 * widget's `CurrentWeekContract`.
 *
 * The plan is the source of truth: session status/completion come straight from the
 * coach's reconciliation. On top of that we overlay any of this week's synced activities
 * that aren't yet linked to a planned session, so deviations and not-yet-reviewed logs
 * still surface immediately instead of waiting for the next coach check-in.
 */
export function adaptCurrentWeek(
  runtime: RuntimeCurrentWeek,
  availability: CurrentWeekAvailability,
  activities: Activity[],
): CurrentWeekContract {
  const claimedActivityIds = new Set<string>();
  for (const day of runtime.days) {
    for (const session of day.sessions) {
      for (const id of completionLocalIds(session.completion_activity_ids)) {
        claimedActivityIds.add(id);
      }
    }
  }

  const weekStart = new Date(`${runtime.week.start_date}T00:00:00`);
  const weekEndExclusive = new Date(weekStart.getTime() + 7 * DAY_MS);
  const unclaimedByDate = new Map<string, Activity[]>();
  for (const activity of activities) {
    if (claimedActivityIds.has(String(activity.id))) continue;
    const when = parseLocal(activity.start_date_local);
    if (when < weekStart || when >= weekEndExclusive) continue;
    const dateKey = activity.start_date_local.slice(0, 10);
    const bucket = unclaimedByDate.get(dateKey);
    if (bucket) bucket.push(activity);
    else unclaimedByDate.set(dateKey, [activity]);
  }

  const days: CurrentWeekDay[] = runtime.days.map((day) => {
    const date = new Date(`${day.date}T00:00:00`);
    const planned = day.sessions.map(mapPlannedSession);
    const overlays = (unclaimedByDate.get(day.date) ?? [])
      .sort(
        (left, right) =>
          parseLocal(left.start_date_local).getTime() -
          parseLocal(right.start_date_local).getTime(),
      )
      .map(overlaySession);
    const sessions = [...planned, ...overlays];
    return {
      date: day.date,
      day: date.toLocaleDateString("en-GB", { weekday: "long" }),
      intent: mapIntent(day.intent, sessions.length > 0),
      coach_note: day.coach_note,
      sessions,
    };
  });

  return {
    schema_version: 1,
    data_status: mapDataStatus(runtime.data_status),
    week: {
      id: runtime.week.id,
      start_date: runtime.week.start_date,
      end_date: runtime.week.end_date,
      status: mapWeekStatus(availability.status),
      focus: runtime.week.focus ?? "",
      guardrails: runtime.week.guardrails,
    },
    coach_read: runtime.coach_read
      ? mapCoachRead(runtime.coach_read)
      : {
          headline: runtime.week.focus ?? "Current week",
          body: "",
          valid_from: runtime.week.start_date,
          valid_until: runtime.week.end_date,
        },
    days,
    // ADR 0042 drops coach_comments from the schema - Gemini never populated it (see the
    // consumer audit). Hardcode empty rather than widen the widget contract in this PR.
    coach_comments: [],
    updated_at: runtime.updated_at,
    updated_by: runtime.updated_by,
    trace_id: runtime.trace_id,
  };
}
