import type { ChallengeV2 } from "@/lib/challenge";
import {
  getThisWeekActivities,
  getTrainingCategory,
  parseLocal,
  type Activity,
  type TrainingCategory,
} from "@/lib/activities";
import { buildBadmintonLensModel } from "@/components/sport-analytics/badmintonLensModel";
import type { SessionDiscipline } from "./currentWeek.fixture";
import { formatMinutesLabel } from "./formatUtils";
import type {
  ActivityCellState,
  ActivityInspectionSnapshot,
  BuildPhaseSnapshot,
  CaloriesSnapshot,
  CoachReadSnapshot,
  CommitmentSnapshot,
  EngineSnapshot,
  EngineSnapshotS,
  QuestSnapshot,
  QuestSnapshotS,
  RecentSessionSnapshot,
  TrainingActivitySnapshot,
  Vo2Snapshot,
  WarmHomeSnapshots,
  WarmSportId,
  WeeklyPlanSnapshot,
  WidgetSnapshotsFile,
} from "./snapshots";
import {
  buildWarmHomeModel,
  getActivityZoneLoad,
  type SyncStatusPayload,
  type WarmHomeModel,
} from "./warmHomeModel";
import type { CurrentWeekContract } from "./currentWeek.fixture";

const DAY_MS = 24 * 60 * 60 * 1000;

export function localDateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function isoWeek(date = new Date()) {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return Math.ceil((((utc.getTime() - yearStart.getTime()) / DAY_MS) + 1) / 7);
}

export function categoryToSport(category: TrainingCategory): WarmSportId {
  if (category.startsWith("badminton")) return "badminton";
  if (category === "calisthenics") return "calisthenics";
  if (category === "foundation" || category === "recovery" || category === "realign") {
    return "foundation";
  }
  if (category === "ride") return "cycling";
  if (category === "run") return "run";
  if (category === "strength") return "strength";
  if (category === "weight_training") return "weight_training";
  if (category === "hike") return "hike";
  if (category === "walk") return "walk";
  if (category === "cricket") return "cricket";
  if (category === "football") return "football";
  if (category === "workout") return "workout";
  if (category === "swim") return "swim";
  return "other";
}

function disciplineToSport(discipline: SessionDiscipline): WarmSportId | "recovery" {
  if (discipline === "cycling") return "cycling";
  if (discipline === "badminton") return "badminton";
  if (discipline === "calisthenics") return "calisthenics";
  if (discipline === "foundation") return "foundation";
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

function formatSessionTitle(name: string) {
  return name.replace(/:\s*/, " · ");
}

export function buildActivityEvidenceSnapshots(
  activities: Activity[],
): ActivityInspectionSnapshot[] {
  return [...activities]
    .sort(
      (left, right) =>
        parseLocal(right.start_date_local).getTime() - parseLocal(left.start_date_local).getTime(),
    )
    .map((activity, index) => {
      const category = getTrainingCategory(activity);
      const date = parseLocal(activity.start_date_local);
      const calories = Number(activity.calories) || 0;
      const distance = Number(activity.distance) || 0;
      const activityLoad = getActivityZoneLoad(activity);
      return {
        id: activity.id !== undefined && activity.id !== null
          ? String(activity.id)
          : `${activity.start_date_local}-${activity.name}-${index}`,
        dateKey: localDateKey(date),
        dateLabel: date.toLocaleDateString("en-GB", {
          weekday: "short",
          day: "2-digit",
          month: "short",
        }).toUpperCase(),
        title: formatSessionTitle(activity.name),
        sport: categoryToSport(category),
        ranked: category === "badminton_ranked",
        durationMinutes: Math.max(0, activity.elapsed_time ?? 0) / 60,
        calories: calories > 0 ? Math.round(calories) : null,
        averageHeartRate: activity.average_heartrate
          ? Math.round(activity.average_heartrate)
          : null,
        maxHeartRate: activity.max_heartrate ? Math.round(activity.max_heartrate) : null,
        distanceKm: distance > 0 ? distance / 1000 : null,
        load: activityLoad === null ? null : Math.round(activityLoad),
        source: activity.device_name ?? "Strava activity log",
      };
    });
}

function formatDuration(activity: Activity) {
  const duration = formatMinutesLabel(Math.max(0, activity.elapsed_time ?? 0) / 60);
  return activity.average_heartrate
    ? `${duration} · ${Math.round(activity.average_heartrate)} BPM`
    : duration;
}

export function buildEngineSnapshot(
  activities: Activity[],
  engine: WarmHomeModel["engine"],
): EngineSnapshot {
  const thisWeek = getThisWeekActivities(activities);
  const mixDefinition: Array<{
    id: WarmSportId;
    label: string;
    shortLabel: string;
    color: string;
  }> = [
    { id: "badminton", label: "Badminton", shortLabel: "BDM", color: "#9fc0ad" },
    { id: "foundation", label: "Foundation", shortLabel: "FDN", color: "#cdd3a8" },
    { id: "calisthenics", label: "Calisthenics", shortLabel: "CAL", color: "#aeb2c9" },
    { id: "cycling", label: "Ride", shortLabel: "RIDE", color: "#e0b06e" },
    { id: "run", label: "Run", shortLabel: "RUN", color: "#c44020" },
    { id: "strength", label: "Strength", shortLabel: "STR", color: "#111111" },
    { id: "weight_training", label: "Weights", shortLabel: "WGT", color: "#3b4a6b" },
    { id: "hike", label: "Hike", shortLabel: "HIK", color: "#8b6f47" },
    { id: "walk", label: "Walk", shortLabel: "WLK", color: "#a8a29e" },
    { id: "cricket", label: "Cricket", shortLabel: "CRK", color: "#2dd4bf" },
    { id: "football", label: "Football", shortLabel: "FBL", color: "#e11d48" },
    { id: "workout", label: "Workout", shortLabel: "WKT", color: "#6b7280" },
    { id: "swim", label: "Swim", shortLabel: "SWM", color: "#0ea5e9" },
  ];
  const mix = mixDefinition.map((item) => ({
    ...item,
    hours: thisWeek
      .filter((activity) => categoryToSport(getTrainingCategory(activity)) === item.id)
      .reduce((sum, activity) => sum + (activity.elapsed_time ?? 0) / 3600, 0),
  }));
  const totalHours = thisWeek.reduce(
    (sum, activity) => sum + (activity.elapsed_time ?? 0) / 3600,
    0,
  );
  const bandLow = engine.corridorLow ?? engine.currentLoad * 0.8;
  const bandHigh = engine.corridorHigh ?? engine.currentLoad * 1.2;
  const minimumSignal = Math.min(engine.currentLoad, bandLow);
  const maximumSignal = Math.max(engine.currentLoad, bandHigh, 1);
  const scaleLow = Math.max(0, Math.floor((minimumSignal * 0.7) / 50) * 50);
  const scaleHigh = Math.max(
    scaleLow + 100,
    Math.ceil((maximumSignal * 1.2) / 50) * 50,
  );
  const signal = engine.signal === "HOLD"
    ? "IN BAND"
    : engine.signal === "EASE"
      ? "ABOVE BAND"
      : "BELOW BAND";
  const verdict = engine.signal === "HOLD"
    ? "Optimal."
    : engine.signal === "EASE"
      ? "Ease off."
      : "Build gently.";
  const compactVerdict = engine.signal === "HOLD"
    ? "In the band."
    : engine.signal === "EASE"
      ? "Above the band."
      : "Below the band.";
  const openVerdict = engine.signal === "HOLD"
    ? "Hold here."
    : engine.signal === "EASE"
      ? "Absorb."
      : "Build gently.";
  const observedLoadCount = thisWeek.filter(
    (activity) => getActivityZoneLoad(activity) !== null,
  ).length;
  const doseRows: EngineSnapshot["doseRows"] = [...thisWeek]
    .sort(
      (left, right) =>
        parseLocal(left.start_date_local).getTime() - parseLocal(right.start_date_local).getTime(),
    )
    .slice(-5)
    .map((activity) => ({
      day: parseLocal(activity.start_date_local).toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase(),
      title: formatSessionTitle(activity.name),
      detail: formatDuration(activity),
      load: getActivityZoneLoad(activity) === null
        ? null
        : Math.round(getActivityZoneLoad(activity)!),
      sport: categoryToSport(getTrainingCategory(activity)),
    }));

  if (doseRows.length < 5) {
    doseRows.push({
      day: "SUN",
      title: "Rest — part of the texture",
      load: null,
      sport: "other",
      isRest: true,
    });
  }

  return {
    weekLabel: `WK ${isoWeek()}`,
    load: engine.currentLoad,
    signal,
    verdict,
    compactVerdict,
    openVerdict,
    bandLow,
    bandHigh,
    scaleLow,
    scaleHigh,
    trend: engine.points.map((point) => ({
      label: point.label,
      value: point.load,
      weekLabel: `WK ${isoWeek(new Date(point.weekKey))}`,
    })),
    mix,
    totalHours,
    method: `LOAD = Σ(MIN × ZONE 1–5) · BAND = 8-WK RHYTHM ±20%${
      observedLoadCount < thisWeek.length
        ? ` · ${observedLoadCount}/${thisWeek.length} LOAD STREAMS`
        : ""
    }`,
    doseRows,
  };
}

function buildQuestSnapshot(
  challenge: ChallengeV2,
  quest: WarmHomeModel["quest"],
): QuestSnapshot {
  const palette = ["#7c6f9e", "#a8702c"];
  const sideQuests = challenge.quests.slice(0, 2).map((item, index) => {
    const completedDates = item.completed_dates?.length ?? 0;
    const value = item.current ?? completedDates;
    const target = item.target ?? Math.max(value, 1);
    return {
      id: item.id,
      name: item.name,
      value,
      target,
      color: palette[index] ?? palette[0],
      notes: item.notes,
    };
  });
  const mondayIndex = (new Date().getDay() + 6) % 7;

  return {
    name: quest.name,
    completed: Number(quest.completed.toFixed(1)),
    target: quest.floor,
    loaded: Number(quest.loaded.toFixed(1)),
    daysLeft: Math.max(0, 6 - mondayIndex),
    sideQuests,
  };
}

function winPercent(record?: string) {
  const match = record?.match(/(\d+)\D+(\d+)/);
  if (!match) return 0;
  const wins = Number(match[1]);
  const losses = Number(match[2]);
  return wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0;
}

function activityDayStreak(activities: ActivityInspectionSnapshot[]) {
  const dates = Array.from(new Set(activities.map((activity) => activity.dateKey))).sort().reverse();
  if (dates.length === 0) return 0;
  const activeDates = new Set(dates);
  const cursor = new Date(`${dates[0]}T12:00:00`);
  let streak = 0;
  while (activeDates.has(localDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function buildCommitmentSnapshots(
  commitments: WarmHomeModel["commitments"],
  dataMode: "reference" | "live",
  activityEvidence: ActivityInspectionSnapshot[],
): CommitmentSnapshot[] {
  const targets = {
    cycling: 1,
    badminton: 2,
    calisthenics: 2,
    foundation: 7,
  } as const;
  const order = ["cycling", "badminton", "calisthenics", "foundation"] as const;

  return order.map((id) => {
    const source = commitments.find((item) => item.id === id);
    const sportActivities = activityEvidence.filter((activity) => activity.sport === id);
    const value = Number(source?.value ?? 0);
    const target = dataMode === "live"
      ? id === "cycling" ? null : targets[id]
      : targets[id];
    const progress = target === null
      ? null
      : id === "badminton"
        ? winPercent(source?.allRecord)
        : Math.min(100, (value / target) * 100);
    const alarm = dataMode !== "live" && target !== null && id === "calisthenics" && value < target;
    const status = dataMode === "live"
      ? id === "badminton" ? "ALL" : ""
      : id === "foundation"
        ? value >= target! ? "GRADUATED" : `${target! - value}D LEFT`
        : id === "calisthenics"
          ? value >= target! ? "IN BAND" : "BELOW"
          : id === "cycling"
            ? "LOGGED"
            : "ALL";
    const note = dataMode === "live"
      ? id === "foundation" ? "" : source?.secondary.toUpperCase() ?? "NO DATA"
      : id === "foundation"
        ? `${value}/${target} DAYS`
        : id === "calisthenics"
          ? `FLOOR ${target}`
          : source?.secondary.toUpperCase() ?? "NO DATA";

    return {
      id,
      label: source?.label ?? id,
      glyph: source?.glyph ?? id,
      value,
      target,
      note,
      status,
      progress,
      accent: id === "badminton"
        ? "#315a4a"
        : id === "calisthenics"
          ? "#4f587a"
          : id === "foundation"
            ? "#6d7d4e"
            : "#a8702c",
      alarm,
      allRecord: source?.allRecord,
      rankedRecord: source?.rankedRecord,
      hasRankedRecord: source?.hasRankedRecord,
      latest: sportActivities[0],
      latestRanked: sportActivities.find((activity) => activity.ranked),
      streak: id === "foundation" ? activityDayStreak(sportActivities) : undefined,
    };
  });
}

function buildWeeklyPlanSnapshot(
  model: WarmHomeModel,
  engine: EngineSnapshot,
  dataMode: "reference" | "live",
  activityEvidence: ActivityInspectionSnapshot[],
): WeeklyPlanSnapshot {
  return {
    label: model.weekLabel,
    isPreview: model.dataStatus === "placeholder",
    title: dataMode === "live" ? "WEEKLY LOG" : undefined,
    statusLabel: dataMode === "live" ? model.weekLabel.toUpperCase() : undefined,
    bandLow: engine.bandLow,
    bandHigh: engine.bandHigh,
    days: model.planDays.map((day) => {
      const session = day.sessions[0];
      const dayActivities = activityEvidence.filter(
        (activity) => activity.dateKey === day.date,
      );
      const observedLoads = dayActivities
        .map((activity) => activity.load)
        .filter((load): load is number => load !== null);
      const hasCompleteLoad = dayActivities.length > 0
        && observedLoads.length === dayActivities.length;
      return {
        key: day.date,
        day: day.day,
        dayShort: day.day.slice(0, 1),
        glyph: session?.glyph ?? null,
        sport: session ? disciplineToSport(session.discipline) : "recovery",
        title: session?.title ?? "Rest",
        loadDelta: dataMode === "live" && hasCompleteLoad
          ? Math.round(observedLoads.reduce((sum, load) => sum + load, 0))
          : null,
        isRecorded: dataMode === "live" && dayActivities.length > 0,
        href: session?.href,
        activities: dayActivities,
      };
    }),
  };
}

function buildCaloriesSnapshot(
  activities: Activity[],
  dataMode: "reference" | "live",
): CaloriesSnapshot {
  const now = new Date();
  const current = activities
    .filter((activity) => {
      const date = parseLocal(activity.start_date_local);
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    })
    .reduce((sum, activity) => sum + (Number(activity.calories) || 0), 0);
  const target = 12_000;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(0, daysInMonth - now.getDate());
  const monthActivities = activities.filter((activity) => {
    const date = parseLocal(activity.start_date_local);
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  });
  const caloriesByDay = monthActivities.reduce<Map<string, number>>((totals, activity) => {
    const key = activity.start_date_local.slice(0, 10);
    totals.set(key, (totals.get(key) ?? 0) + (Number(activity.calories) || 0));
    return totals;
  }, new Map());
  const highestDay = Array.from(caloriesByDay.entries()).sort((left, right) => right[1] - left[1])[0];
  let cumulativeCalories = 0;
  const dailyActual = Array.from({ length: now.getDate() }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), index + 1);
    cumulativeCalories += caloriesByDay.get(localDateKey(date)) ?? 0;
    return Math.round(cumulativeCalories);
  });

  return {
    monthLabel: now.toLocaleDateString("en-GB", { month: "short" }).toUpperCase(),
    current: Math.round(current),
    target,
    daysLeft,
    daysInMonth,
    pacePercent: (now.getDate() / daysInMonth) * 100,
    dailyActual,
    dailyNeeded: daysLeft > 0 ? Math.max(0, target - current) / daysLeft : 0,
    targetIsFixture: dataMode === "reference",
    elapsedDays: now.getDate(),
    activeDays: caloriesByDay.size,
    highestDayLabel: highestDay
      ? new Date(`${highestDay[0]}T12:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }).toUpperCase()
      : undefined,
    highestDayCalories: highestDay ? Math.round(highestDay[1]) : undefined,
  };
}

function dominantActivityState(categories: TrainingCategory[]): ActivityCellState {
  const states = categories.map(categoryToSport);
  if (states.includes("badminton")) return "badminton";
  if (states.includes("calisthenics")) return "calisthenics";
  if (states.includes("run")) return "run";
  if (states.includes("cycling")) return "cycling";
  if (states.includes("foundation")) return "foundation";
  if (states.includes("strength")) return "strength";
  if (states.includes("weight_training")) return "weight_training";
  if (states.includes("hike")) return "hike";
  if (states.includes("walk")) return "walk";
  if (states.includes("cricket")) return "cricket";
  if (states.includes("football")) return "football";
  if (states.includes("workout")) return "workout";
  if (states.includes("swim")) return "swim";
  return "empty";
}

function calculateConsistency(activeKeys: Set<string>, start: Date, end: Date) {
  let currentBlock = 0;
  let longestBlock = 0;
  let currentGap = 0;
  let worstGap = 0;
  let gapCount = 0;
  let inGap = false;

  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const active = activeKeys.has(localDateKey(cursor));
    if (active) {
      currentBlock += 1;
      longestBlock = Math.max(longestBlock, currentBlock);
      if (inGap) {
        gapCount += 1;
        worstGap = Math.max(worstGap, currentGap);
      }
      currentGap = 0;
      inGap = false;
    } else {
      currentBlock = 0;
      currentGap += 1;
      inGap = true;
    }
  }
  if (inGap && currentGap > 0) {
    gapCount += 1;
    worstGap = Math.max(worstGap, currentGap);
  }
  return { longestBlock, gapCount, worstGap };
}

export function buildTrainingActivitySnapshot(
  activities: Activity[],
  activityEvidence: ActivityInspectionSnapshot[],
): TrainingActivitySnapshot {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const summaryStart = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const byDate = new Map<string, TrainingCategory[]>();
  activities.forEach((activity) => {
    const date = parseLocal(activity.start_date_local);
    if (date < start || date > now) return;
    const key = localDateKey(date);
    const categories = byDate.get(key) ?? [];
    categories.push(getTrainingCategory(activity));
    byDate.set(key, categories);
  });
  const months = Array.from({ length: 12 }, (_, index) => {
    const monthDate = new Date(start.getFullYear(), start.getMonth() + index, 1);
    const dates = Array.from({ length: 28 }, (_, dayIndex) => {
      const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), dayIndex + 1);
      return date.getMonth() === monthDate.getMonth() && date <= now
        ? localDateKey(date)
        : null;
    });
    const cells = dates.map((dateKey) =>
      dateKey ? dominantActivityState(byDate.get(dateKey) ?? []) : "empty",
    );
    return {
      label: monthDate.toLocaleDateString("en-GB", { month: "short" }).toUpperCase(),
      cells,
      dates,
    };
  });
  const activeKeys = new Set(byDate.keys());
  const summaryActiveKeys = new Set(
    Array.from(activeKeys).filter((key) => new Date(`${key}T12:00:00`) >= summaryStart),
  );
  const consistency = calculateConsistency(summaryActiveKeys, summaryStart, now);
  const dayDetails = activityEvidence.reduce<NonNullable<TrainingActivitySnapshot["dayDetails"]>>(
    (details, activity) => {
      const date = new Date(`${activity.dateKey}T12:00:00`);
      if (date < start || date > now) return details;
      const existing = details[activity.dateKey] ?? {
        dateLabel: activity.dateLabel,
        activities: [],
        durationMinutes: 0,
        load: 0,
      };
      existing.activities.push(activity);
      existing.durationMinutes += activity.durationMinutes;
      existing.load = existing.load === null || activity.load === null
        ? null
        : existing.load + activity.load;
      details[activity.dateKey] = existing;
      return details;
    },
    {},
  );

  return {
    rangeLabel: `${months.at(-4)?.label ?? months[0]?.label ?? ""}–${months.at(-1)?.label ?? ""}`,
    months,
    longestBlock: consistency.longestBlock,
    activeDays: summaryActiveKeys.size,
    planTruePercent: null,
    gapCount: consistency.gapCount,
    worstGap: consistency.worstGap,
    read: "Activity is observed from the log; plan-truth appears when completed-vs-planned history lands.",
    dayDetails,
  };
}

function buildVo2Snapshot(): Vo2Snapshot {
  return {
    status: "unavailable",
    value: null,
    delta: null,
    trend: [],
    read: "Connect a real Apple Health VO₂ series before Coach reads the trend.",
  };
}

export function buildRecentSessions(
  activityEvidence: ActivityInspectionSnapshot[],
): RecentSessionSnapshot[] {
  return activityEvidence.slice(0, 3).map((activity) => ({
    id: activity.id,
    dateLabel: activity.dateLabel.replace(/^\w+\s/, ""),
    title: activity.title,
    detail: activity.averageHeartRate === null
      ? formatMinutesLabel(activity.durationMinutes)
      : `${formatMinutesLabel(activity.durationMinutes)} · ${activity.averageHeartRate} BPM`,
    load: activity.load,
    sport: activity.sport,
    evidence: activity,
  }));
}

function buildPhaseSnapshot(
  challenge: ChallengeV2,
  dataMode: "reference" | "live",
): BuildPhaseSnapshot {
  const blockStart = challenge.phase?.current_block.start_date ?? challenge.challenge?.start_date;
  const blockEnd = challenge.phase?.current_block.end_date ?? challenge.challenge?.end_date;
  const start = blockStart ? new Date(`${blockStart}T00:00:00`) : new Date();
  const end = blockEnd ? new Date(`${blockEnd}T00:00:00`) : new Date();
  const totalWeeks = Math.max(1, Math.ceil((end.getTime() - start.getTime() + DAY_MS) / (7 * DAY_MS)));
  const currentWeek = Math.min(
    totalWeeks,
    Math.max(1, Math.floor((Date.now() - start.getTime()) / (7 * DAY_MS)) + 1),
  );

  return {
    weekLabel: `WK ${currentWeek}/${totalWeeks}`,
    title: dataMode === "live" ? "BUILD PHASE · CHALLENGE DATA" : undefined,
    milestones: (challenge.milestones ?? []).slice(0, 3).map((milestone) => {
      const progress = milestone.progress;
      const progressPercent = progress
        ? Math.max(
            0,
            Math.min(
              100,
              Math.round(
                ((progress.current_value - progress.baseline_value) /
                  (progress.target_value - progress.baseline_value || 1)) *
                  100,
              ),
            ),
          )
        : null;
      const projectedDateLabel = progress?.projected_date
        ? new Date(`${progress.projected_date}T00:00:00`)
            .toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
            .toUpperCase()
        : undefined;
      return {
        id: milestone.id,
        name: milestone.short_name ?? milestone.name,
        baseline: String(milestone.baseline ?? "—"),
        current: milestone.short_current
          ?? String(milestone.current ?? milestone.baseline ?? "—"),
        target: milestone.short_target ?? milestone.target,
        note: milestone.note,
        progressPercent,
        projectedDateLabel: dataMode === "live" ? projectedDateLabel : undefined,
      };
    }),
    read: dataMode === "live"
      ? "Phase dates and milestone values are read directly from the generated challenge record."
      : "Dates assume plan-true weeks — every missed bar day slides them right.",
  };
}

function buildCoachReadSnapshot(
  model: WarmHomeModel,
  engine: EngineSnapshot,
  quest: QuestSnapshot,
  dataMode: "reference" | "live",
): CoachReadSnapshot {
  return {
    dateLabel: new Date().toLocaleDateString("en-GB", {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).toUpperCase(),
    body: [model.coachRead?.headline, model.coachRead?.body]
      .filter(Boolean)
      .join(" "),
    eyebrow: dataMode === "live" ? "LOG" : undefined,
    signature: dataMode === "live" ? "— COACH" : undefined,
    actionLabel: dataMode === "live" ? "Inspect evidence" : undefined,
    isPreview: model.dataStatus === "placeholder",
    evidence: [
      `LOAD ${engine.load} · BAND ${Math.round(engine.bandLow ?? engine.load)}–${Math.round(engine.bandHigh ?? engine.load)}`,
      `${engine.totalHours.toFixed(1)}H RECORDED THIS WEEK`,
      `QUEST ${quest.completed}/${quest.target} · ${quest.daysLeft}D LEFT`,
    ],
  };
}

export function buildWarmHomeSnapshots(
  activities: Activity[],
  challengeData: ChallengeV2,
  syncStatus: SyncStatusPayload,
  contract: CurrentWeekContract,
  dataMode: "reference" | "live" = "live",
): WarmHomeSnapshots {
  const model = buildWarmHomeModel(activities, challengeData, syncStatus, contract);
  const activityEvidence = buildActivityEvidenceSnapshots(activities);
  const engine = buildEngineSnapshot(activities, model.engine);
  const quest = buildQuestSnapshot(challengeData, model.quest);

  return {
    engine,
    quest,
    coachRead: buildCoachReadSnapshot(model, engine, quest, dataMode),
    commitments: buildCommitmentSnapshots(model.commitments, dataMode, activityEvidence),
    plan: buildWeeklyPlanSnapshot(model, engine, dataMode, activityEvidence),
    calories: buildCaloriesSnapshot(activities, dataMode),
    trainingActivity: buildTrainingActivitySnapshot(activities, activityEvidence),
    vo2: buildVo2Snapshot(),
    sessions: buildRecentSessions(activityEvidence),
    phase: buildPhaseSnapshot(challengeData, dataMode),
    amIImproving: buildBadmintonLensModel(activities, "ranked").amIImproving,
    activityEvidence,
    sync: {
      label: model.syncLabel,
      healthy: model.syncHealthy,
      status: syncStatus.status,
      timestamp: syncStatus.timestamp,
      warnings: syncStatus.warnings ?? [],
    },
  };
}

function engineSnapshotS(engine: EngineSnapshot): EngineSnapshotS {
  return {
    weekLabel: engine.weekLabel,
    load: engine.load,
    signal: engine.signal,
    compactVerdict: engine.compactVerdict ?? engine.verdict,
    bandLow: engine.bandLow,
    bandHigh: engine.bandHigh,
  };
}

function questSnapshotS(quest: QuestSnapshot): QuestSnapshotS {
  const progressPercent = quest.target > 0
    ? Math.min(100, Math.round((quest.completed / quest.target) * 100))
    : 0;
  return {
    name: quest.name,
    completed: quest.completed,
    target: quest.target,
    progressPercent,
  };
}

export function buildWidgetSnapshotsFile(
  activities: Activity[],
  challengeData: ChallengeV2,
  syncStatus: SyncStatusPayload,
  contract: CurrentWeekContract,
  dataMode: "reference" | "live" = "live",
): WidgetSnapshotsFile {
  const home = buildWarmHomeSnapshots(
    activities,
    challengeData,
    syncStatus,
    contract,
    dataMode,
  );

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    home,
    sizes: {
      engine: {
        S: engineSnapshotS(home.engine),
        M: home.engine,
        L: home.engine,
      },
      quest: {
        S: questSnapshotS(home.quest),
        M: home.quest,
      },
      commitments: {
        S: home.commitments.find((item) => item.id === "badminton")
          ?? home.commitments[0]
          ?? {
            id: "badminton",
            label: "Badminton",
            glyph: "badminton",
            value: 0,
            target: 2,
            note: "NO DATA",
            status: "ALL",
            progress: 0,
            accent: "#315a4a",
          },
        M: home.commitments,
      },
    },
  };
}
