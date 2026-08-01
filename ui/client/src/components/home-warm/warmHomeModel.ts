import type { ChallengeV2, MainQuest } from "@/lib/challenge";
import {
  type Activity,
  getThisWeekActivities,
  getTrainingCategory,
  parseLocal,
  parseWinLoss,
} from "@/lib/activities";
import type { ActivityGlyphKind } from "./ActivityGlyph";
import type {
  CoachComment,
  CurrentWeekContract,
  CurrentWeekDay,
  SessionDiscipline,
} from "./currentWeek.fixture";

export interface SyncStatusPayload {
  timestamp: string | null;
  status: string;
  warnings?: string[];
}

export interface EnginePoint {
  weekKey: string;
  label: string;
  load: number;
  isCurrent: boolean;
  isPartial: boolean;
}

export interface EngineModel {
  points: EnginePoint[];
  currentLoad: number;
  projectedLoad: number;
  corridorLow: number | null;
  corridorTarget: number | null;
  corridorHigh: number | null;
  signal: "BUILD" | "HOLD" | "EASE";
  headline: string;
  body: string;
  completionFraction: number;
}

export interface CommitmentModel {
  id: "cycling" | "foundation" | "badminton" | "calisthenics";
  label: string;
  glyph: ActivityGlyphKind;
  value: string;
  unit: string;
  secondary: string;
  accent: string;
  allRecord?: string;
  rankedRecord?: string;
  hasRankedRecord?: boolean;
}

export interface PlanSessionModel {
  id: string;
  title: string;
  discipline: SessionDiscipline;
  glyph: ActivityGlyphKind;
  duration: string | null;
  priority: "anchor" | "support" | "optional";
  status: "planned" | "completed" | "skipped" | "moved";
  href?: string;
}

export interface PlanDayModel {
  date: string;
  day: string;
  dayShort: string;
  dateNumber: string;
  intent: CurrentWeekDay["intent"];
  isToday: boolean;
  sessions: PlanSessionModel[];
}

export interface QuestModel {
  name: string;
  completed: number;
  floor: number;
  loaded: number;
  skill: number;
  percent: number;
}

export interface WarmHomeModel {
  dateLabel: string;
  phaseName: string;
  blockName: string;
  syncLabel: string;
  syncHealthy: boolean;
  dataStatus: CurrentWeekContract["data_status"];
  weekLabel: string;
  weekFocus: string;
  engine: EngineModel;
  coachRead: CurrentWeekContract["coach_read"];
  commitments: CommitmentModel[];
  planDays: PlanDayModel[];
  quest: QuestModel;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function getMonday(date = new Date()): Date {
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(date.getFullYear(), date.getMonth(), diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function dateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

/** Most recent synced activity timestamp across all sources (HealthKit/Strava). */
function latestActivityTimestamp(activities: Activity[]): string | null {
  let latest: string | null = null;
  for (const activity of activities) {
    const when = activity.start_date_local ?? "";
    if (when && (!latest || when > latest)) latest = when;
  }
  return latest;
}

function formatSyncAge(timestamp: string | null): string {
  if (!timestamp) return "Not synced";
  const ageMinutes = Math.max(
    0,
    Math.round((Date.now() - new Date(timestamp).getTime()) / 60_000),
  );
  if (ageMinutes < 1) return "Just synced";
  if (ageMinutes < 60) return `${ageMinutes}m ago`;
  const ageHours = Math.round(ageMinutes / 60);
  if (ageHours < 24) return `${ageHours}h ago`;
  return `${Math.round(ageHours / 24)}d ago`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

const ZONE_LOAD_WEIGHTS = [1, 2, 3, 4, 5] as const;

export function getActivityZoneLoad(activity: Activity): number | null {
  if (!activity.hr_zones) return null;

  let observedSeconds = 0;
  const weightedSeconds = ZONE_LOAD_WEIGHTS.reduce((total, weight) => {
    const seconds = Math.max(
      0,
      Number(activity.hr_zones?.[`Zone ${weight}`]?.seconds) || 0,
    );
    observedSeconds += seconds;
    return total + seconds * weight;
  }, 0);

  return observedSeconds > 0 ? weightedSeconds / 60 : null;
}

function activitiesForWeek(activities: Activity[], weekStart: Date): Activity[] {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  return activities.filter((activity) => {
    const activityDate = parseLocal(activity.start_date_local);
    return activityDate >= weekStart && activityDate < weekEnd;
  });
}

function buildEnginePoints(activities: Activity[]): EnginePoint[] {
  const currentMonday = getMonday();
  return Array.from({ length: 8 }, (_, index) => {
    const weekStart = new Date(currentMonday);
    weekStart.setDate(weekStart.getDate() - (7 - index) * 7);
    const weekActivities = activitiesForWeek(activities, weekStart);
    const observedLoads = weekActivities
      .map(getActivityZoneLoad)
      .filter((load): load is number => load !== null);
    const load = observedLoads.reduce((sum, activityLoad) => sum + activityLoad, 0);
    return {
      weekKey: dateKey(weekStart),
      label: weekStart.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      load: Math.round(load),
      isCurrent: index === 7,
      isPartial: observedLoads.length < weekActivities.length,
    };
  });
}

function activeComment(
  contract: CurrentWeekContract,
  topic: CoachComment["topic"],
): CoachComment | null {
  const matching = contract.coach_comments
    .filter((comment) => comment.topic === topic)
    .sort((a, b) => a.priority - b.priority);
  if (contract.data_status === "placeholder") return matching[0] ?? null;
  const today = dateKey(new Date());
  return (
    matching.find(
      (comment) => comment.valid_from <= today && comment.valid_until >= today,
    ) ?? null
  );
}

function buildEngine(
  activities: Activity[],
  contract: CurrentWeekContract,
): EngineModel {
  const points = buildEnginePoints(activities);
  const currentLoad = points.at(-1)?.load ?? 0;
  const validPrevious = points
    .slice(-5, -1)
    .filter((point) => !point.isPartial)
    .map((point) => point.load)
    .filter((load) => load > 0);
  const rhythm = median(validPrevious);
  const monday = getMonday();
  const elapsedDays = Math.min(
    7,
    Math.max(1, Math.floor((Date.now() - monday.getTime()) / DAY_MS) + 1),
  );
  const completionFraction = elapsedDays / 7;
  const projectedLoad = Math.round(
    currentLoad / Math.max(completionFraction, 0.45),
  );
  const ratio = rhythm && rhythm > 0 ? projectedLoad / rhythm : 1;
  const signal = ratio > 1.2 ? "EASE" : ratio < 0.8 ? "BUILD" : "HOLD";
  const comment = activeComment(contract, "weekly_load");

  return {
    points,
    currentLoad,
    projectedLoad,
    corridorLow: rhythm === null ? null : Math.round(rhythm * 0.8),
    corridorTarget: rhythm === null ? null : Math.round(rhythm),
    corridorHigh: rhythm === null ? null : Math.round(rhythm * 1.2),
    signal,
    headline:
      comment?.headline ??
      (signal === "EASE"
        ? "Absorb the work."
        : signal === "BUILD"
          ? "There is room to build."
          : "Hold the line."),
    body:
      comment?.body ??
      (rhythm === null
        ? "More completed weeks are needed before Coach can establish a reliable rhythm."
        : `Projected load is ${Math.round(ratio * 100)}% of the recent rhythm.`),
    completionFraction,
  };
}

function formatDistanceKm(metres: number): string {
  const kilometres = metres / 1000;
  if (kilometres <= 0) return "0 km";
  return `${kilometres >= 10 ? Math.round(kilometres) : kilometres.toFixed(1)} km`;
}

function calisthenicsFocus(activities: Activity[]): string {
  const focuses = activities
    .map((activity) => {
      const parts = activity.name.split(":");
      return parts.length > 1 ? parts.slice(1).join(":").trim() : activity.name;
    })
    .filter((value): value is string => Boolean(value));
  return focuses.at(-1) ?? "No session yet";
}

function buildCommitments(activities: Activity[]): CommitmentModel[] {
  const thisWeek = getThisWeekActivities(activities);
  const rides = thisWeek.filter(
    (activity) => getTrainingCategory(activity) === "ride",
  );
  const foundation = thisWeek.filter(
    (activity) => getTrainingCategory(activity) === "foundation",
  );
  const badminton = thisWeek.filter((activity) =>
    getTrainingCategory(activity).startsWith("badminton"),
  );
  const calisthenics = thisWeek.filter(
    (activity) => getTrainingCategory(activity) === "calisthenics",
  );

  let rankedWins = 0;
  let rankedLosses = 0;
  let allWins = 0;
  let allLosses = 0;
  for (const activity of badminton) {
    const record = parseWinLoss(activity.description);
    if (!record) continue;
    const category = getTrainingCategory(activity);
    allWins += record.all.wins;
    allLosses += record.all.losses;
    if (category === "badminton_ranked" || category === "badminton_league") {
      rankedWins += record.ranked.wins;
      rankedLosses += record.ranked.losses;
    }
  }

  return [
    {
      id: "cycling",
      label: "Cycling",
      glyph: "cycling",
      value: String(rides.length),
      unit: rides.length === 1 ? "ride" : "rides",
      secondary: formatDistanceKm(
        rides.reduce((sum, activity) => sum + (activity.distance ?? 0), 0),
      ),
      accent: "#9c5d2e",
    },
    {
      id: "foundation",
      label: "Foundation",
      glyph: "foundation",
      value: String(
        new Set(
          foundation.map((activity) => activity.start_date_local.slice(0, 10)),
        ).size,
      ),
      unit: "active days",
      secondary: foundation.length > 0 ? "rhythm intact" : "start gently",
      accent: "#496d64",
    },
    {
      id: "badminton",
      label: "Badminton",
      glyph: "badminton",
      value: String(badminton.length),
      unit: badminton.length === 1 ? "session" : "sessions",
      secondary: `${allWins}W-${allLosses}L`,
      allRecord: `${allWins}W-${allLosses}L`,
      rankedRecord: `${rankedWins}W-${rankedLosses}L`,
      hasRankedRecord: rankedWins + rankedLosses > 0,
      accent: "#2f7058",
    },
    {
      id: "calisthenics",
      label: "Calisthenics",
      glyph: "calisthenics",
      value: String(calisthenics.length),
      unit: calisthenics.length === 1 ? "session" : "sessions",
      secondary: calisthenicsFocus(calisthenics),
      accent: "#76556f",
    },
  ];
}

function glyphForDiscipline(discipline: SessionDiscipline): ActivityGlyphKind {
  if (discipline === "cycling") return "cycling";
  if (discipline === "foundation") return "foundation";
  if (discipline === "badminton") return "badminton";
  if (discipline === "calisthenics") return "calisthenics";
  if (discipline === "recovery") return "recovery";
  if (discipline === "run") return "run";
  if (discipline === "strength") return "strength";
  if (discipline === "weight_training") return "weight_training";
  if (discipline === "hike") return "hike";
  if (discipline === "walk") return "walk";
  if (discipline === "cricket") return "cricket";
  if (discipline === "football") return "football";
  if (discipline === "workout") return "workout";
  if (discipline === "swim") return "swim";
  return "other";
}

function weekdayName(dateStr: string, explicit?: string) {
  if (explicit) return explicit;
  const weekday = new Date(`${dateStr}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "long",
  });
  return weekday || "Day";
}

function buildPlanDays(contract: CurrentWeekContract): PlanDayModel[] {
  const today = dateKey(new Date());
  return contract.days.map((day) => {
    const dayName = weekdayName(day.date, day.day);
    return {
    date: day.date,
    day: dayName,
    dayShort: dayName.slice(0, 3),
    dateNumber: String(Number(day.date.slice(-2))),
    intent: day.intent,
    isToday: day.date === today,
    sessions: day.sessions.map((session) => ({
      id: session.id,
      title: session.title,
      discipline: session.discipline,
      glyph: glyphForDiscipline(session.discipline),
      duration:
        session.planned_duration_min === null
          ? null
          : `${session.planned_duration_min} min`,
      priority: session.priority,
      status: session.status,
      href: session.template_id
        ? `/workouts/${session.template_id}`
        : contract.data_status === "placeholder"
          ? "/workouts"
          : undefined,
    })),
  };
  });
}

function buildQuest(mainQuest: MainQuest): QuestModel {
  const monday = getMonday();
  // weekly_floor/loaded_floor/skill_weight/skill_cap/sessions are Akash's weekly-session-floor
  // model only - a classic-model main quest (target/count_from) has none of these, so this
  // widget just shows an empty/zeroed quest bar rather than crashing.
  const sessions = (mainQuest.sessions ?? []).filter(
    (session) => new Date(`${session.date}T00:00:00`) >= monday,
  );
  const loaded = sessions
    .filter((session) => session.kind === "loaded")
    .reduce((sum, session) => sum + session.weight, 0);
  const rawSkill = sessions
    .filter((session) => session.kind === "skill")
    .reduce((sum, session) => sum + session.weight, 0);
  const skill = Math.min(rawSkill, mainQuest.skill_cap ?? 0);
  const completed = loaded + skill;
  const floor = mainQuest.weekly_floor ?? 0;

  return {
    name: mainQuest.name,
    completed,
    floor,
    loaded,
    skill,
    percent: floor > 0 ? Math.min(100, (completed / floor) * 100) : 0,
  };
}

export function buildWarmHomeModel(
  activities: Activity[],
  challenge: ChallengeV2,
  syncStatus: SyncStatusPayload,
  contract: CurrentWeekContract,
): WarmHomeModel {
  const syncHealthy = syncStatus.status === "success" || syncStatus.status === "none";
  const start = new Date(`${contract.week.start_date}T00:00:00`);
  const end = new Date(`${contract.week.end_date}T00:00:00`);

  return {
    dateLabel: new Date().toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }),
    phaseName: contract.week.phase_name || challenge.phase?.name || challenge.challenge?.name || "Current block",
    blockName: contract.week.block_name || challenge.phase?.current_block.name || "This week",
    syncLabel: formatSyncAge(latestActivityTimestamp(activities) ?? syncStatus.timestamp),
    syncHealthy,
    dataStatus: contract.data_status,
    weekLabel: `${start.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}–${end.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`,
    weekFocus: contract.week.focus,
    engine: buildEngine(activities, contract),
    coachRead: contract.coach_read,
    commitments: buildCommitments(activities),
    planDays: buildPlanDays(contract),
    quest: buildQuest(challenge.main_quest),
  };
}
