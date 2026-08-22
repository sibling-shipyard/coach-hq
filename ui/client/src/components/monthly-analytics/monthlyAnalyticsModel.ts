import type { Activity, TrainingCategory } from "@/lib/activities";
import { getTrainingCategory, parseLocal, totalCalories } from "@/lib/activities";
import { getActivityZoneLoad } from "@/components/home-warm/warmHomeModel";
import type { WarmSportId } from "@/components/home-warm/WarmInstrumentWidgets";
import { sportHex } from "@/lib/wiTokens";

const DAY_MS = 24 * 60 * 60 * 1000;

const SPORT_ROWS: Array<{
  id: WarmSportId;
  label: string;
  color: string;
  match: (category: TrainingCategory) => boolean;
}> = [
  {
    id: "badminton",
    label: "BADMINTON",
    color: sportHex("badminton"),
    match: (category) => category.startsWith("badminton"),
  },
  {
    id: "foundation",
    label: "FOUNDATION",
    color: sportHex("foundation"),
    match: (category) =>
      category === "foundation" || category === "recovery" || category === "realign",
  },
  {
    id: "cycling",
    label: "RIDE",
    color: sportHex("cycling"),
    match: (category) => category === "ride",
  },
  {
    id: "calisthenics",
    label: "CALISTHENICS",
    color: sportHex("calisthenics"),
    match: (category) => category === "calisthenics",
  },
  {
    id: "run",
    label: "RUN",
    color: sportHex("run"),
    match: (category) => category === "run",
  },
  {
    id: "strength",
    label: "STRENGTH",
    color: sportHex("strength"),
    match: (category) => category === "strength",
  },
  {
    id: "weight_training",
    label: "WEIGHTS",
    color: sportHex("weight_training"),
    match: (category) => category === "weight_training",
  },
  {
    id: "hike",
    label: "HIKE",
    color: sportHex("hike"),
    match: (category) => category === "hike",
  },
  {
    id: "walk",
    label: "WALK",
    color: sportHex("walk"),
    match: (category) => category === "walk",
  },
  {
    id: "cricket",
    label: "CRICKET",
    color: sportHex("cricket"),
    match: (category) => category === "cricket",
  },
  {
    id: "football",
    label: "FOOTBALL",
    color: sportHex("football"),
    match: (category) => category === "football",
  },
  {
    id: "workout",
    label: "WORKOUT",
    color: sportHex("workout"),
    match: (category) => category === "workout",
  },
  {
    id: "swim",
    label: "SWIM",
    color: sportHex("swim"),
    match: (category) => category === "swim",
  },
  {
    id: "other",
    label: "OTHER",
    color: sportHex("other"),
    match: (category) => category === "other",
  },
];

const QUEST_COLORS: Record<string, string> = {
  visualization: "#7c6f9e",
  reading: "#a8702c",
  foundation: "#6d7d4e",
  cold_shower: "#4b5578",
  protein: "#7f3728",
};

export interface MonthOverviewCell {
  month: number;
  label: string;
  fullName: string;
  activeDays: number;
  hours: number;
}

export interface MonthlyEngineWeek {
  label: string;
  load: number;
  isPartial: boolean;
}

export interface MonthlyEngineModel {
  monthLabel: string;
  avgWeeklyLoad: number | null;
  signal: "IN BAND" | "ABOVE BAND" | "BELOW BAND" | null;
  verdict: string;
  bandLow: number | null;
  bandHigh: number | null;
  scaleLow: number;
  scaleHigh: number;
  weeks: MonthlyEngineWeek[];
  method: string;
  hasData: boolean;
}

export interface SportBreakdownRow {
  id: WarmSportId;
  label: string;
  sessions: number;
  hours: number;
  share: number;
  color: string;
}

export interface WorkoutBreakdownModel {
  sessions: number;
  hours: number;
  calories: number;
  consistencyPercent: number | null;
  activeDays: number;
  elapsedDays: number;
  vsPrevious: { sessionsDelta: number; hoursDelta: number } | null;
  sports: SportBreakdownRow[];
  hasData: boolean;
}

export interface SideQuestMonthRow {
  id: string;
  name: string;
  done: number;
  miss: number;
  excused: number;
  rate: number | null;
  rateDeltaVsPrevious: number | null;
  color: string;
}

export interface SideQuestsModel {
  quests: SideQuestMonthRow[];
  coachRead: string;
  footnote: string;
}

export interface MonthlyVo2Model {
  status: "available" | "unavailable";
  monthLabel: string;
  value: number | null;
  delta: number | null;
  percentileLabel?: string;
  trend: Array<{ label: string; value: number }>;
  read: string;
}

export interface MonthlySleepModel {
  monthLabel: string;
  hasData: false;
}

export interface MonthlyAnalyticsModel {
  year: number;
  month: number;
  monthLabel: string;
  monthFullName: string;
  isCurrentMonth: boolean;
  summaryLine: string;
  yearOptions: number[];
  monthOverview: MonthOverviewCell[];
  engine: MonthlyEngineModel;
  vo2: MonthlyVo2Model;
  sleep: MonthlySleepModel;
  breakdown: WorkoutBreakdownModel;
  sideQuests: SideQuestsModel;
}

function localDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function getMonday(date: Date): Date {
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(date.getFullYear(), date.getMonth(), diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function isoWeek(date: Date): number {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return Math.ceil((((utc.getTime() - yearStart.getTime()) / DAY_MS) + 1) / 7);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function monthBounds(year: number, month: number): { start: Date; end: Date; elapsedDays: number } {
  const start = new Date(year, month, 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(year, month + 1, 0);
  end.setHours(23, 59, 59, 999);
  const now = new Date();
  const isCurrentMonth =
    now.getFullYear() === year && now.getMonth() === month;
  const elapsedDays = isCurrentMonth ? now.getDate() : end.getDate();
  return { start, end, elapsedDays };
}

function activitiesInMonth(activities: Activity[], year: number, month: number): Activity[] {
  const { start, end } = monthBounds(year, month);
  return activities.filter((activity) => {
    const date = parseLocal(activity.start_date_local);
    return date >= start && date <= end;
  });
}

function activeDayKeys(activities: Activity[]): Set<string> {
  const keys = new Set<string>();
  for (const activity of activities) {
    keys.add(localDateKey(parseLocal(activity.start_date_local)));
  }
  return keys;
}

function weekLoad(activities: Activity[]): number {
  return Math.round(
    activities
      .map(getActivityZoneLoad)
      .filter((load): load is number => load !== null)
      .reduce((sum, load) => sum + load, 0),
  );
}

function activitiesForWeek(activities: Activity[], weekStart: Date): Activity[] {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  return activities.filter((activity) => {
    const date = parseLocal(activity.start_date_local);
    return date >= weekStart && date < weekEnd;
  });
}

function buildRhythmBand(activities: Activity[], anchor: Date): { low: number | null; high: number | null } {
  const anchorMonday = getMonday(anchor);
  const loads: number[] = [];
  for (let index = 0; index < 8; index += 1) {
    const weekStart = new Date(anchorMonday);
    weekStart.setDate(weekStart.getDate() - (7 - index) * 7);
    const load = weekLoad(activitiesForWeek(activities, weekStart));
    if (load > 0) loads.push(load);
  }
  const rhythm = median(loads);
  if (rhythm === null) return { low: null, high: null };
  return {
    low: Math.round(rhythm * 0.8),
    high: Math.round(rhythm * 1.2),
  };
}

function buildMonthlyEngine(
  activities: Activity[],
  year: number,
  month: number,
): MonthlyEngineModel {
  const monthName = new Date(year, month, 1).toLocaleDateString("en-GB", { month: "long" }).toUpperCase();
  const { end } = monthBounds(year, month);
  const monthActivities = activitiesInMonth(activities, year, month);
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);

  const weekStarts = new Map<string, Date>();
  for (let day = monthStart.getDate(); day <= monthEnd.getDate(); day += 1) {
    const date = new Date(year, month, day);
    const monday = getMonday(date);
    weekStarts.set(localDateKey(monday), monday);
  }

  const weeks: MonthlyEngineWeek[] = Array.from(weekStarts.values())
    .sort((left, right) => left.getTime() - right.getTime())
    .map((weekStart) => {
      const weekActivities = activitiesForWeek(activities, weekStart);
      const observed = weekActivities.filter((activity) => getActivityZoneLoad(activity) !== null);
      return {
        label: `WK${isoWeek(weekStart)}`,
        load: weekLoad(weekActivities),
        isPartial: observed.length < weekActivities.length,
      };
    });

  const weekLoads = weeks.map((week) => week.load).filter((load) => load > 0);
  const avgWeeklyLoad =
    weekLoads.length > 0
      ? Math.round(weekLoads.reduce((sum, load) => sum + load, 0) / weekLoads.length)
      : null;

  const { low: bandLow, high: bandHigh } = buildRhythmBand(activities, end);
  let signal: MonthlyEngineModel["signal"] = null;
  if (avgWeeklyLoad !== null && bandLow !== null && bandHigh !== null) {
    if (avgWeeklyLoad > bandHigh) signal = "ABOVE BAND";
    else if (avgWeeklyLoad < bandLow) signal = "BELOW BAND";
    else signal = "IN BAND";
  }

  const minimumSignal = Math.min(avgWeeklyLoad ?? 0, bandLow ?? avgWeeklyLoad ?? 0);
  const maximumSignal = Math.max(avgWeeklyLoad ?? 0, bandHigh ?? 0, 1);
  const scaleLow = Math.max(0, Math.floor((minimumSignal * 0.7) / 50) * 50);
  const scaleHigh = Math.max(scaleLow + 100, Math.ceil((maximumSignal * 1.2) / 50) * 50);

  let verdict = "No load streams this month — connect heart-rate data before Coach reads the band.";
  if (avgWeeklyLoad !== null && signal === "IN BAND") {
    verdict = "The engine stayed inside its own rhythm — steady work, no drama.";
  } else if (signal === "ABOVE BAND") {
    verdict = "Running hot this month — absorb before the next push.";
  } else if (signal === "BELOW BAND") {
    verdict = "A lighter month — room to build when life allows.";
  }

  const hasHrData = monthActivities.some((activity) => getActivityZoneLoad(activity) !== null);

  return {
    monthLabel: monthName,
    avgWeeklyLoad,
    signal,
    verdict,
    bandLow,
    bandHigh,
    scaleLow,
    scaleHigh,
    weeks,
    method: "LOAD = Σ(MIN × ZONE WEIGHT) · BAND = 8-WK RHYTHM ±20%",
    hasData: hasHrData,
  };
}

function buildSportBreakdown(monthActivities: Activity[]): SportBreakdownRow[] {
  const totals = SPORT_ROWS.map((row) => {
    const matched = monthActivities.filter((activity) =>
      row.match(getTrainingCategory(activity)),
    );
    const hours = matched.reduce((sum, activity) => sum + (activity.elapsed_time ?? 0) / 3600, 0);
    return {
      ...row,
      sessions: matched.length,
      hours,
    };
  }).filter((row) => row.sessions > 0);

  const totalHours = totals.reduce((sum, row) => sum + row.hours, 0) || 1;
  return totals.map((row) => ({
    id: row.id,
    label: row.label,
    sessions: row.sessions,
    hours: row.hours,
    share: row.hours / totalHours,
    color: row.color,
  }));
}

function buildWorkoutBreakdown(
  activities: Activity[],
  year: number,
  month: number,
): WorkoutBreakdownModel {
  const monthActivities = activitiesInMonth(activities, year, month);
  const { elapsedDays } = monthBounds(year, month);
  const activeDays = activeDayKeys(monthActivities).size;
  const hours = monthActivities.reduce((sum, activity) => sum + (activity.elapsed_time ?? 0) / 3600, 0);
  const calories = totalCalories(monthActivities);

  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const prevActivities = activitiesInMonth(activities, prevYear, prevMonth);
  const prevSessions = prevActivities.length;
  const prevHours = prevActivities.reduce(
    (sum, activity) => sum + (activity.elapsed_time ?? 0) / 3600,
    0,
  );

  const consistencyPercent =
    elapsedDays > 0 ? Math.round((activeDays / elapsedDays) * 100) : null;

  return {
    sessions: monthActivities.length,
    hours,
    calories,
    consistencyPercent,
    activeDays,
    elapsedDays,
    vsPrevious:
      prevActivities.length > 0 || monthActivities.length > 0
        ? {
            sessionsDelta: monthActivities.length - prevSessions,
            hoursDelta: hours - prevHours,
          }
        : null,
    sports: buildSportBreakdown(monthActivities),
    hasData: monthActivities.length > 0,
  };
}

// gen/quest_history.json's shape (built by engine/scripts/generate_quest_history.py, which
// walks every archived season directory plus the current one and caps entries at "today" for
// the live season - so unlike recomputing from challenge_v2.json's raw date arrays, future days
// and old-season boundaries never enter this data in the first place).
export interface QuestHistoryEntry {
  date: string;
  status: "done" | "missed" | "excused";
}

export interface QuestHistoryQuest {
  name: string;
  // Earliest start_date seen for this quest id across every season, and null while it's still
  // active (present in the current/live season) or the date it was last processed through once
  // retired. Not currently used for the show/hide gate below (that's driven by entries directly)
  // - available for any consumer that wants the window without scanning entries.
  start_date: string;
  end_date: string | null;
  entries: QuestHistoryEntry[];
}

export interface QuestHistory {
  generated_at: string;
  quests: Record<string, QuestHistoryQuest>;
}

// Ported from the legacy pre-Warm-Instrument dashboard's QuestSummaryCard.tsx (monthRate +
// row-building) - filtering pre-computed entries by a "YYYY-MM" prefix instead of recomputing
// from date-range math is what avoids issue #93 (future days counted as done) and makes
// archived-season data show up at all (challenge_v2.json's quests[] only ever has the live
// season's quests; quest_history.json already has all of them).
function questHistoryMonthStats(
  entries: QuestHistoryEntry[],
  monthKey: string,
): { done: number; miss: number; excused: number } {
  const monthEntries = entries.filter((e) => e.date.startsWith(monthKey));
  const done = monthEntries.filter((e) => e.status === "done").length;
  const miss = monthEntries.filter((e) => e.status === "missed").length;
  const excused = monthEntries.filter((e) => e.status === "excused").length;
  return { done, miss, excused };
}

function monthKeyFor(year: number, month: number): string {
  // month is 0-indexed (JS Date convention) - quest_history.json's dates are real calendar
  // dates, so the key needs a 1-indexed month.
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function questRate(stats: { done: number; miss: number }): number | null {
  const denominator = stats.done + stats.miss;
  if (denominator <= 0) return null;
  return Math.round((stats.done / denominator) * 100);
}

export function buildSideQuests(
  questHistory: QuestHistory,
  year: number,
  month: number,
): SideQuestsModel {
  const monthKey = monthKeyFor(year, month);
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const prevMonthKey = monthKeyFor(prevYear, prevMonth);

  // A quest only appears in a given month's view if it actually has entries that month - a
  // quest that finished in May doesn't show up as a permanent empty row every month after
  // (issue flagged in PR #253's own review: buildSideQuests used to list every quest id
  // quest_history.json had ever seen). A month with real entries but zero "done" still shows
  // (a genuine 0%, not "not applicable") - the gate is entries-existence, not the rate.
  const quests: SideQuestMonthRow[] = Object.entries(questHistory.quests ?? {})
    .filter(([, quest]) => quest.entries.some((e) => e.date.startsWith(monthKey)))
    .map(([id, quest]) => {
      const stats = questHistoryMonthStats(quest.entries, monthKey);
      const prevStats = questHistoryMonthStats(quest.entries, prevMonthKey);
      const rate = questRate(stats);
      const prevRate = questRate(prevStats);
      return {
        id,
        name: quest.name,
        done: stats.done,
        miss: stats.miss,
        excused: stats.excused,
        rate,
        rateDeltaVsPrevious:
          rate !== null && prevRate !== null ? rate - prevRate : null,
        color: QUEST_COLORS[id] ?? "#7c6f9e",
      };
    },
  );

  const activeQuest = quests.find((quest) => quest.done + quest.miss > 0) ?? quests[0];
  let coachRead = "Side quests only count when you log them — no invented progress.";
  if (activeQuest && activeQuest.rate !== null) {
    if (activeQuest.rate >= 70) {
      coachRead = `${activeQuest.name} held this month — keep the floor, not the ceiling.`;
    } else if (activeQuest.rate <= 20 && activeQuest.miss > 0) {
      coachRead = `${activeQuest.done} kept promise${activeQuest.done === 1 ? "" : "s"} out of ${activeQuest.done + activeQuest.miss}. The ${activeQuest.name.toLowerCase()} habit slipped — worth a smaller floor next month.`;
    } else if (activeQuest.done + activeQuest.miss > 0) {
      coachRead = `${activeQuest.name} landed ${activeQuest.rate}% this month — honest, not heroic.`;
    }
  }

  return {
    quests,
    coachRead,
    footnote: "RATE = DONE ÷ (DONE + MISS). EXCUSED DAYS EXCLUDED. DELTA vs LAST MONTH.",
  };
}

function buildMonthOverview(activities: Activity[], year: number, now: Date): MonthOverviewCell[] {
  const lastMonth = year === now.getFullYear() ? now.getMonth() : 11;
  return Array.from({ length: lastMonth + 1 }, (_, month) => {
    const monthActivities = activitiesInMonth(activities, year, month);
    const hours = monthActivities.reduce(
      (sum, activity) => sum + (activity.elapsed_time ?? 0) / 3600,
      0,
    );
    const date = new Date(year, month, 1);
    return {
      month,
      label: date.toLocaleDateString("en-GB", { month: "short" }).toUpperCase(),
      fullName: date.toLocaleDateString("en-GB", { month: "long" }),
      activeDays: activeDayKeys(monthActivities).size,
      hours,
    };
  });
}

function availableYears(activities: Activity[], now: Date): number[] {
  const years = new Set<number>([now.getFullYear()]);
  for (const activity of activities) {
    years.add(parseLocal(activity.start_date_local).getFullYear());
  }
  return Array.from(years).sort((left, right) => right - left).slice(0, 3);
}

function formatHours(hours: number): string {
  return hours.toFixed(1);
}

export function buildMonthlyAnalyticsModel(
  activities: Activity[],
  questHistory: QuestHistory,
  scope: { year: number; month: number },
): MonthlyAnalyticsModel {
  const now = new Date();
  const { year, month } = scope;
  const monthDate = new Date(year, month, 1);
  const monthFullName = monthDate.toLocaleDateString("en-GB", { month: "long" });
  const monthLabel = monthFullName.toUpperCase();
  const isCurrentMonth = now.getFullYear() === year && now.getMonth() === month;
  const breakdown = buildWorkoutBreakdown(activities, year, month);

  const summaryLine = [
    `${breakdown.sessions} SESSIONS`,
    `${formatHours(breakdown.hours)}H`,
    `${breakdown.activeDays} ACTIVE DAYS`,
  ].join(" · ");

  return {
    year,
    month,
    monthLabel,
    monthFullName,
    isCurrentMonth,
    summaryLine,
    yearOptions: availableYears(activities, now),
    monthOverview: buildMonthOverview(activities, year, now),
    engine: buildMonthlyEngine(activities, year, month),
    vo2: {
      status: "unavailable",
      monthLabel: `END OF ${monthLabel}`,
      value: null,
      delta: null,
      trend: [],
      read: "Connect a real Apple Health VO₂ series before Coach reads the trend.",
    },
    sleep: {
      monthLabel: `${monthLabel} ${year}`,
      hasData: false,
    },
    breakdown,
    sideQuests: buildSideQuests(questHistory, year, month),
  };
}

export function clampMonthlyScope(
  scope: { year: number; month: number },
  activities: Activity[],
): { year: number; month: number } {
  const now = new Date();
  const years = availableYears(activities, now);
  const year = years.includes(scope.year) ? scope.year : years[0] ?? now.getFullYear();
  const maxMonth = year === now.getFullYear() ? now.getMonth() : 11;
  const month = Math.max(0, Math.min(scope.month, maxMonth));
  return { year, month };
}
