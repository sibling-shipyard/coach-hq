import type { ChallengeV2 } from "@/lib/challenge";
import {
  getTrainingCategory,
  parseLocal,
  type Activity,
  type TrainingCategory,
} from "@/lib/activities";
import type {
  CurrentWeekContract,
  CurrentWeekDay,
  PlanIntent,
  SessionDiscipline,
} from "./currentWeek.fixture";

const DAY_MS = 24 * 60 * 60 * 1000;

function getMonday(date = new Date()) {
  const monday = new Date(date);
  const day = monday.getDay();
  monday.setDate(monday.getDate() - day + (day === 0 ? -6 : 1));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function localDateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function disciplineFor(category: TrainingCategory): SessionDiscipline {
  const cat = (category || "").toUpperCase();
  if (["RNK", "FRN", "CAS", "LGE", "BADMINTON"].includes(cat) || category.startsWith("badminton")) return "badminton";
  if (cat === "CAL" || category === "calisthenics") return "calisthenics";
  if (cat === "RDE" || category === "ride") return "cycling";
  if (cat === "FDN" || category === "foundation") return "foundation";
  if (["REC", "RLN", "RECOVERY", "REALIGN"].includes(cat)) return "recovery";
  if (["LNG", "SPR", "EZR", "RUN"].includes(cat) || category === "run") return "run";
  if (cat === "STR" || category === "strength") return "strength";
  if (cat === "WGT" || category === "weight_training") return "weight_training";
  if (cat === "HIK" || category === "hike") return "hike";
  if (cat === "WLK" || category === "walk") return "walk";
  if (cat === "CRK" || category === "cricket") return "cricket";
  if (cat === "FBL" || category === "football") return "football";
  if (cat === "WKT" || category === "workout") return "workout";
  if (cat === "SWM" || category === "swim") return "swim";
  return "other";
}

function intentFor(categories: TrainingCategory[]): PlanIntent {
  if (categories.length === 0) return "open";
  if (categories.every((category) => category === "recovery" || category === "realign")) {
    return "recovery";
  }
  return "train";
}

function recordedDays(activities: Activity[], monday: Date): CurrentWeekDay[] {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday.getTime() + index * DAY_MS);
    const dateKey = localDateKey(date);
    const matches = activities
      .filter((activity) => activity.start_date_local.slice(0, 10) === dateKey)
      .sort(
        (left, right) =>
          parseLocal(left.start_date_local).getTime() - parseLocal(right.start_date_local).getTime(),
      );
    const categories = matches.map(getTrainingCategory);

    return {
      date: dateKey,
      day: date.toLocaleDateString("en-GB", { weekday: "long" }),
      intent: intentFor(categories),
      coach_note: null,
      sessions: matches.map((activity) => {
        const category = getTrainingCategory(activity);
        return {
          id: `activity-${activity.id}`,
          discipline: disciplineFor(category),
          kind: category,
          title: activity.name,
          priority: "support" as const,
          status: "completed" as const,
          planned_duration_min: Math.round(activity.elapsed_time / 60),
          planned_load: null,
          template_id: null,
          session_file: null,
          coach_note: null,
          completion_activity_ids: [String(activity.id)],
        };
      }),
    };
  });
}

export function buildLiveWeekContract(
  activities: Activity[],
  challenge: ChallengeV2,
  now = new Date(),
): CurrentWeekContract {
  const monday = getMonday(now);
  const sunday = new Date(monday.getTime() + 6 * DAY_MS);
  const startDate = localDateKey(monday);
  const endDate = localDateKey(sunday);
  const weekActivities = activities.filter((activity) => {
    const date = parseLocal(activity.start_date_local);
    return date >= monday && date < new Date(monday.getTime() + 7 * DAY_MS);
  });
  const activeDays = new Set(
    weekActivities.map((activity) => activity.start_date_local.slice(0, 10)),
  ).size;
  const totalMinutes = weekActivities.reduce(
    (sum, activity) => sum + Math.max(0, activity.elapsed_time) / 60,
    0,
  );
  const disciplines = new Set(
    weekActivities.map((activity) => disciplineFor(getTrainingCategory(activity))),
  ).size;
  const evidenceRefs = weekActivities.map((activity) => `activity:${activity.id}`);
  const latestTimestamp = weekActivities
    .map((activity) => activity.start_date_local)
    .sort()
    .at(-1) ?? `${startDate}T00:00:00`;

  return {
    schema_version: 1,
    data_status: "live",
    week: {
      id: `${startDate}_${endDate}`,
      start_date: startDate,
      end_date: endDate,
      status: "active",
      phase_name: challenge.phase?.name ?? challenge.challenge?.name ?? "Current block",
      block_name: challenge.phase?.current_block.name ?? "This week",
      focus: "Recorded activity log for the current calendar week.",
      guardrails: [],
    },
    coach_read: {
      headline: `${weekActivities.length} session${weekActivities.length === 1 ? "" : "s"} logged.`,
      body: `${activeDays} active day${activeDays === 1 ? "" : "s"} · ${(totalMinutes / 60).toFixed(1)} hours · ${disciplines} discipline${disciplines === 1 ? "" : "s"}. Factual log summary; no training prescription is inferred.`,
      tone: "steady",
      confidence: "high",
      evidence_refs: evidenceRefs,
      valid_from: startDate,
      valid_until: endDate,
    },
    days: recordedDays(weekActivities, monday),
    coach_comments: [],
    updated_at: latestTimestamp,
    updated_by: "activity-log-adapter",
  };
}
