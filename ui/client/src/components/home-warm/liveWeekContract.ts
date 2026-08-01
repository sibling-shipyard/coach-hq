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

function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

import { CategoryConfigInput, getSportForCategory } from "@/lib/categoryResolver";

function disciplineFor(category: TrainingCategory, config?: CategoryConfigInput): SessionDiscipline {
  const sport = getSportForCategory(category, config);
  return (sport as SessionDiscipline) || "other";
}

function intentFor(categories: TrainingCategory[]): PlanIntent {
  if (categories.length === 0) return "open";
  if (categories.every((category) => category === "recovery" || category === "realign")) {
    return "recovery";
  }
  return "train";
}

function recordedDays(activities: Activity[], monday: Date, config?: CategoryConfigInput): CurrentWeekDay[] {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday.getTime() + index * DAY_MS);
    const dateKey = localDateKey(date);
    const matches = activities
      .filter((activity) => activity.start_date_local.slice(0, 10) === dateKey)
      .sort(
        (left, right) =>
          parseLocal(left.start_date_local).getTime() - parseLocal(right.start_date_local).getTime(),
      );
    const categories = matches.map((a) => getTrainingCategory(a, config));

    return {
      date: dateKey,
      day: date.toLocaleDateString("en-GB", { weekday: "long" }),
      intent: intentFor(categories),
      coach_note: null,
      sessions: matches.map((activity) => {
        const category = getTrainingCategory(activity, config);
        return {
          id: `activity-${activity.id}`,
          discipline: disciplineFor(category, config),
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
  config?: CategoryConfigInput,
): CurrentWeekContract {
  const now = new Date();
  const monday = getMonday(now);
  const sunday = new Date(monday.getTime() + 6 * DAY_MS);

  const startDate = localDateKey(monday);
  const endDate = localDateKey(sunday);

  const weekActivities = activities.filter((activity) => {
    const dateStr = activity.start_date_local.slice(0, 10);
    return dateStr >= startDate && dateStr <= endDate;
  });

  const activeDays = new Set(weekActivities.map((a) => a.start_date_local.slice(0, 10))).size;
  const totalMinutes = Math.round(
    weekActivities.reduce((sum, a) => sum + (a.elapsed_time ?? 0), 0) / 60,
  );
  const disciplines = new Set(weekActivities.map((a) => disciplineFor(getTrainingCategory(a, config), config))).size;

  const latestActivity = weekActivities[0];
  const latestTimestamp = latestActivity
    ? latestActivity.start_date_local
    : new Date().toISOString();

  const evidenceRefs = weekActivities.map((a) => `activity:${a.id}`);

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
    days: recordedDays(weekActivities, monday, config),
    coach_comments: [],
    updated_at: latestTimestamp,
    updated_by: "activity-log-adapter",
  };
}
