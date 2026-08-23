/**
 * runningLensModel.ts — Data model for the Running Pace LENS.
 * Everything here is derived from logged Run activities.
 * No fabricated numbers: widgets with insufficient sample size report an
 * empty/opt-in state rather than guessing.
 */
import { type Activity, getTrainingCategory, parseLocal } from "@/lib/activities";
import { zoneRamp } from "@/lib/wiTokens";
import type { EffortSnapshot } from "./badmintonLensModel";

export type RunningScope = "8w" | "52w";

const EIGHT_WEEKS_MS = 56 * 24 * 60 * 60 * 1000;
const FIFTY_TWO_WEEKS_MS = 52 * 7 * 24 * 60 * 60 * 1000;
const ROUTE_BUCKET_METERS = 500;

const STANDARD_DISTANCES: Array<{ label: string; meters: number; tolerance: number }> = [
  { label: "1K", meters: 1000, tolerance: 0.08 },
  { label: "5K", meters: 5000, tolerance: 0.06 },
  { label: "10K", meters: 10000, tolerance: 0.05 },
  { label: "HALF · 21K", meters: 21097.5, tolerance: 0.04 },
];

const ZONE_COLORS = zoneRamp();

export interface RunSession {
  activity: Activity;
  timestamp: number;
  dateKey: string;
  distanceKm: number;
  paceSecPerKm: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function weekStartKey(dateStr: string): string {
  const date = new Date(`${dateStr}T12:00:00`);
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + mondayOffset);
  return localDateKey(date);
}

function shiftWeekKey(weekKey: string, weeks: number): string {
  const date = new Date(`${weekKey}T12:00:00`);
  date.setDate(date.getDate() + weeks * 7);
  return localDateKey(date);
}

/** Consecutive ISO weeks ending at `endWeekKey` (inclusive), oldest first. */
function calendarWeekKeysEndingAt(endWeekKey: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => shiftWeekKey(endWeekKey, index - (count - 1)));
}

function calculateWeeklyStreaks(sessionDateKeys: string[]): { current: number; longest: number } {
  const weekKeys = Array.from(new Set(sessionDateKeys.map(weekStartKey))).sort();
  if (weekKeys.length === 0) return { current: 0, longest: 0 };

  let longest = 1;
  let run = 1;
  for (let index = 1; index < weekKeys.length; index += 1) {
    if (shiftWeekKey(weekKeys[index - 1], 1) === weekKeys[index]) {
      run += 1;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
  }

  const activeWeeks = new Set(weekKeys);
  let current = 0;
  let cursor = weekStartKey(localDateKey(new Date()));
  while (activeWeeks.has(cursor)) {
    current += 1;
    cursor = shiftWeekKey(cursor, -1);
  }

  return { current, longest };
}

function normalizeRouteName(name: string): string {
  return name.toLowerCase().replace(/[^\w\s]/g, "").trim();
}

function buildSessions(activities: Activity[]): RunSession[] {
  const result: RunSession[] = [];
  for (const activity of activities) {
    if (getTrainingCategory(activity) !== "run") continue;
    const distance = Number(activity.distance) || 0;
    if (distance <= 0) continue;
    const distanceKm = distance / 1000;
    const elapsed = Number(activity.elapsed_time) || 0;
    if (elapsed <= 0) continue;
    result.push({
      activity,
      timestamp: parseLocal(activity.start_date_local).getTime(),
      dateKey: activity.start_date_local.slice(0, 10),
      distanceKm,
      paceSecPerKm: elapsed / distanceKm,
    });
  }
  result.sort((a, b) => a.timestamp - b.timestamp);
  return result;
}

function formatShortDate(timestamp: number): string {
  return new Date(timestamp)
    .toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    .toUpperCase();
}

function formatMonthYear(timestamp: number): string {
  return new Date(timestamp)
    .toLocaleDateString("en-GB", { month: "short", year: "2-digit" })
    .toUpperCase()
    .replace(" ", " '");
}

export function formatPace(secPerKm: number): string {
  const mins = Math.floor(secPerKm / 60);
  const secs = Math.round(secPerKm % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ─── Header ─────────────────────────────────────────────────────────────────

export interface RunningHeaderStats {
  totalRuns: number;
  withGps: number;
  withHr: number;
  metaLine: string;
}

function buildHeaderStats(activities: Activity[], sessions: RunSession[]): RunningHeaderStats {
  const allRuns = activities.filter((a) => getTrainingCategory(a) === "run");
  const withGps = allRuns.filter((a) => (Number(a.distance) || 0) > 0).length;
  const withHr = allRuns.filter(
    (a) => a.has_heartrate || (a.hr_zones && Object.values(a.hr_zones).some((z) => z.seconds > 0)),
  ).length;

  const parts = [`${allRuns.length} runs`];
  if (withGps > 0) parts.push("GPS");
  if (withHr > 0) parts.push("HR from watch");
  const metaLine = parts.length > 1 ? `${parts[0]} · ${parts.slice(1).join(" + ")}` : parts[0];

  return { totalRuns: allRuns.length, withGps, withHr, metaLine };
}

// ─── Weekly volume ──────────────────────────────────────────────────────────

export interface WeeklyVolumeWeek {
  weekKey: string;
  label: string;
  km: number;
  longestRunKm: number;
  longestRunName: string;
  isCurrent: boolean;
}

export interface WeeklyVolumeSnapshot {
  available: boolean;
  currentKm: number;
  bandLow: number;
  bandHigh: number;
  verdict: string;
  weeks: WeeklyVolumeWeek[];
  weekOverWeekCapLabel: string | null;
  footnote: string | null;
}

function verdictForVolume(km: number, low: number, high: number, hasBand: boolean): string {
  if (!hasBand) return "building a baseline";
  if (km > high) return "above the band — ease off";
  if (km < low) return "below the band";
  return "in the band — steady build";
}

function aggregateWeeklyKm(sessions: RunSession[]): Map<string, WeeklyVolumeWeek> {
  const byWeek = new Map<string, WeeklyVolumeWeek>();
  for (const session of sessions) {
    const weekKey = weekStartKey(session.dateKey);
    const entry = byWeek.get(weekKey) ?? {
      weekKey,
      label: formatShortDate(new Date(`${weekKey}T12:00:00`).getTime()),
      km: 0,
      longestRunKm: 0,
      longestRunName: "",
      isCurrent: false,
    };
    entry.km += session.distanceKm;
    if (session.distanceKm > entry.longestRunKm) {
      entry.longestRunKm = session.distanceKm;
      entry.longestRunName = session.activity.name;
    }
    byWeek.set(weekKey, entry);
  }
  return byWeek;
}

function buildWeeklyVolume(sessions: RunSession[], scope: RunningScope, now: number): WeeklyVolumeSnapshot {
  if (sessions.length === 0) {
    return {
      available: false,
      currentKm: 0,
      bandLow: 0,
      bandHigh: 0,
      verdict: "",
      weeks: [],
      weekOverWeekCapLabel: null,
      footnote: null,
    };
  }

  const currentWeekKey = weekStartKey(localDateKey(new Date(now)));
  const byWeek = aggregateWeeklyKm(sessions);

  // Band + 8W chart use the trailing 8 *calendar* weeks (zeros included),
  // not the last 8 weeks that happen to have a logged run.
  const bandWeekKeys = calendarWeekKeysEndingAt(currentWeekKey, 8);
  const bandKms = bandWeekKeys.map((key) => byWeek.get(key)?.km ?? 0).sort((a, b) => a - b);
  const hasBand = bandKms.filter((km) => km > 0).length >= 4;
  const bandLow = hasBand ? Math.round(percentile(bandKms, 0.25) * 10) / 10 : 0;
  const bandHigh = hasBand ? Math.round(percentile(bandKms, 0.75) * 10) / 10 : 0;

  const currentEntry = byWeek.get(currentWeekKey);
  const currentKm = Math.round((currentEntry?.km ?? 0) * 10) / 10;

  const chartWeekCount = scope === "8w" ? 8 : 52;
  const scopeKeys = calendarWeekKeysEndingAt(currentWeekKey, chartWeekCount);
  const weeks = scopeKeys.map((key) => {
    const entry = byWeek.get(key);
    return {
      weekKey: key,
      label: formatShortDate(new Date(`${key}T12:00:00`).getTime()),
      km: Math.round((entry?.km ?? 0) * 10) / 10,
      longestRunKm: entry?.longestRunKm ?? 0,
      longestRunName: entry?.longestRunName ?? "",
      isCurrent: key === currentWeekKey,
    };
  });

  let weekOverWeekCapLabel: string | null = null;
  const prevWeekKey = shiftWeekKey(currentWeekKey, -1);
  const prevKm = byWeek.get(prevWeekKey)?.km ?? 0;
  if (prevKm > 0 && currentKm > prevKm * 1.1) {
    weekOverWeekCapLabel = "+10%/WK CAP";
  }

  let footnote: string | null = null;
  if (currentEntry && currentEntry.longestRunKm > 0) {
    const longestThisWeek = sessions
      .filter((s) => weekStartKey(s.dateKey) === currentWeekKey)
      .sort((a, b) => b.distanceKm - a.distanceKm)[0];
    const dayLabel = longestThisWeek
      ? new Date(longestThisWeek.timestamp).toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase()
      : "THIS";
    footnote = `${dayLabel} long run ${currentEntry.longestRunKm.toFixed(1)} km — longest this block.`;
  }

  return {
    available: true,
    currentKm,
    bandLow,
    bandHigh,
    verdict: verdictForVolume(currentKm, bandLow, bandHigh, hasBand),
    weeks,
    weekOverWeekCapLabel,
    footnote,
  };
}

// ─── Benchmark ──────────────────────────────────────────────────────────────

export interface BenchmarkTrendPoint {
  timestamp: number;
  label: string;
  paceSecPerKm: number;
  elapsedTime: number;
  activityId: number | string;
}

export interface BenchmarkSnapshot {
  available: boolean;
  routeLabel: string;
  distanceKm: number;
  latestTimeSec: number;
  latestPaceSecPerKm: number;
  deltaVs8wSec: number | null;
  deltaTone: "up" | "down" | "flat";
  trend: BenchmarkTrendPoint[];
}

function routeClusterKey(session: RunSession): string {
  const bucket = Math.round((session.activity.distance / ROUTE_BUCKET_METERS) * ROUTE_BUCKET_METERS);
  return `${normalizeRouteName(session.activity.name)}|${bucket}`;
}

function buildBenchmark(sessions: RunSession[], now: number): BenchmarkSnapshot {
  const clusters = new Map<string, RunSession[]>();
  for (const session of sessions) {
    const key = routeClusterKey(session);
    const group = clusters.get(key) ?? [];
    group.push(session);
    clusters.set(key, group);
  }

  const qualifying = Array.from(clusters.entries())
    .filter(([, group]) => group.length >= 2)
    .sort((a, b) => b[1].length - a[1].length);

  if (qualifying.length === 0) {
    return {
      available: false,
      routeLabel: "",
      distanceKm: 0,
      latestTimeSec: 0,
      latestPaceSecPerKm: 0,
      deltaVs8wSec: null,
      deltaTone: "flat",
      trend: [],
    };
  }

  const [, cluster] = qualifying[0];
  const sorted = [...cluster].sort((a, b) => a.timestamp - b.timestamp);
  const avgDistance = sorted.reduce((sum, s) => sum + s.distanceKm, 0) / sorted.length;
  const displayName = sorted[0].activity.name;
  const routeLabel = `${displayName.toUpperCase()} ${avgDistance.toFixed(1)}K`;

  const trend: BenchmarkTrendPoint[] = sorted.map((session) => ({
    timestamp: session.timestamp,
    label: formatShortDate(session.timestamp),
    paceSecPerKm: session.paceSecPerKm,
    elapsedTime: session.activity.elapsed_time,
    activityId: session.activity.id,
  }));

  const latest = sorted.at(-1)!;
  const cutoff8 = now - EIGHT_WEEKS_MS;
  const windowRuns = sorted.filter((s) => s.timestamp >= cutoff8);
  const baseline = windowRuns.length >= 2 ? windowRuns[0] : sorted[0];
  const deltaVs8wSec =
    windowRuns.length >= 2 ? Math.round(latest.activity.elapsed_time - baseline.activity.elapsed_time) : null;

  return {
    available: true,
    routeLabel,
    distanceKm: Math.round(avgDistance * 10) / 10,
    latestTimeSec: latest.activity.elapsed_time,
    latestPaceSecPerKm: latest.paceSecPerKm,
    deltaVs8wSec,
    deltaTone: deltaVs8wSec === null ? "flat" : deltaVs8wSec < 0 ? "up" : deltaVs8wSec > 0 ? "down" : "flat",
    trend,
  };
}

// ─── PBs ────────────────────────────────────────────────────────────────────

export interface PbRow {
  label: string;
  timeSec: number | null;
  dateLabel: string;
  isPr: boolean;
  isCurrentBest: boolean;
}

export interface NextMilestoneRow {
  label: string;
  copy: string;
}

export interface PbsSnapshot {
  available: boolean;
  rows: PbRow[];
  nextMilestone: NextMilestoneRow | null;
}

function buildPbs(sessions: RunSession[]): PbsSnapshot {
  const rows: PbRow[] = [];

  for (const std of STANDARD_DISTANCES) {
    const matches = sessions.filter((s) => {
      const ratio = s.activity.distance / std.meters;
      return ratio >= 1 - std.tolerance && ratio <= 1 + std.tolerance;
    });
    if (matches.length === 0) {
      rows.push({ label: std.label, timeSec: null, dateLabel: "—", isPr: false, isCurrentBest: false });
      continue;
    }
    matches.sort((a, b) => a.activity.elapsed_time - b.activity.elapsed_time);
    const best = matches[0];
    rows.push({
      label: std.label,
      timeSec: best.activity.elapsed_time,
      dateLabel: formatShortDate(best.timestamp),
      isPr: false,
      isCurrentBest: false,
    });
  }

  const logged = rows.filter((r) => r.timeSec !== null);
  if (logged.length === 0) return { available: false, rows: [], nextMilestone: null };

  let newestPrLabel = "";
  let newestPrTime = 0;
  for (const std of STANDARD_DISTANCES) {
    const matches = sessions.filter((s) => {
      const ratio = s.activity.distance / std.meters;
      return ratio >= 1 - std.tolerance && ratio <= 1 + std.tolerance;
    });
    if (matches.length === 0) continue;
    matches.sort((a, b) => a.activity.elapsed_time - b.activity.elapsed_time);
    const best = matches[0];
    if (best.timestamp > newestPrTime) {
      newestPrTime = best.timestamp;
      newestPrLabel = std.label;
    }
  }
  for (const row of rows) {
    if (row.timeSec !== null && row.label === newestPrLabel) row.isPr = true;
  }

  const hasHalf = rows.find((r) => r.label.startsWith("HALF"))?.timeSec !== null;
  let nextMilestone: NextMilestoneRow | null = null;
  if (!hasHalf) {
    nextMilestone = { label: "HALF · 21K", copy: "NEXT MILESTONE" };
  }

  return { available: true, rows: rows.filter((r) => r.timeSec !== null), nextMilestone };
}

// ─── Pace trend ─────────────────────────────────────────────────────────────

export interface PaceTrendPoint {
  timestamp: number;
  label: string;
  paceSecPerKm: number;
  rollingPaceSecPerKm: number | null;
  distanceKm: number;
  activityId: number | string;
}

export interface PaceTrendSnapshot {
  available: boolean;
  points: PaceTrendPoint[];
}

function buildPaceTrend(sessions: RunSession[], now: number): PaceTrendSnapshot {
  const cutoff = now - FIFTY_TWO_WEEKS_MS;
  const filtered = sessions.filter((s) => s.timestamp >= cutoff);
  if (filtered.length === 0) return { available: false, points: [] };

  const points: PaceTrendPoint[] = filtered.map((session, index, arr) => {
    const cutoffRolling = session.timestamp - 28 * 24 * 60 * 60 * 1000;
    const window = arr.filter((s, j) => j <= index && s.timestamp >= cutoffRolling);
    const rolling =
      window.length >= 2
        ? window.reduce((sum, s) => sum + s.paceSecPerKm, 0) / window.length
        : null;
    return {
      timestamp: session.timestamp,
      label: formatShortDate(session.timestamp),
      paceSecPerKm: session.paceSecPerKm,
      rollingPaceSecPerKm: rolling,
      distanceKm: session.distanceKm,
      activityId: session.activity.id,
    };
  });

  return { available: points.length > 0, points };
}

// ─── Effort ─────────────────────────────────────────────────────────────────

function buildEffort(activities: Activity[]): EffortSnapshot {
  const totals = [0, 0, 0, 0, 0];
  let anyZones = false;
  for (const activity of activities) {
    if (getTrainingCategory(activity) !== "run") continue;
    const zones = activity.hr_zones;
    if (!zones) continue;
    anyZones = true;
    for (let z = 1; z <= 5; z++) {
      totals[z - 1] += Math.max(0, Number(zones[`Zone ${z}`]?.seconds) || 0);
    }
  }
  const totalSeconds = totals.reduce((sum, v) => sum + v, 0);
  if (!anyZones || totalSeconds === 0) return { available: false, zones: [] };

  return {
    available: true,
    zones: totals.map((seconds, index) => ({
      label: `Z${index + 1}`,
      percent: Math.round((seconds / totalSeconds) * 100),
      color: ZONE_COLORS[index],
    })),
  };
}

// ─── Coach's read ───────────────────────────────────────────────────────────

export interface CoachReadSnapshot {
  available: boolean;
  text: string;
}

function buildCoachRead(
  volume: WeeklyVolumeSnapshot,
  paceTrend: PaceTrendSnapshot,
  benchmark: BenchmarkSnapshot,
): CoachReadSnapshot {
  const reads: string[] = [];

  if (paceTrend.available && paceTrend.points.length >= 4) {
    const rolling = paceTrend.points
      .map((p) => p.rollingPaceSecPerKm)
      .filter((v): v is number => v !== null);
    if (rolling.length >= 3) {
      const early = rolling.slice(0, Math.ceil(rolling.length / 3));
      const late = rolling.slice(-Math.ceil(rolling.length / 3));
      const avgEarly = early.reduce((s, v) => s + v, 0) / early.length;
      const avgLate = late.reduce((s, v) => s + v, 0) / late.length;
      if (avgLate < avgEarly - 8) {
        reads.push("The rolling pace is dropping — that's real aerobic gain, not just effort.");
      } else if (avgLate > avgEarly + 8) {
        reads.push("Pace has drifted slower lately — check recovery before adding volume.");
      }
    }
  }

  if (volume.available && volume.verdict.includes("in the band")) {
    reads.push("Volume sits inside your usual band — the build is honest and inside the lines.");
  } else if (volume.available && volume.verdict.includes("above")) {
    reads.push("You're above your usual weekly band — hold steady before stacking more.");
  }

  if (benchmark.available && benchmark.deltaVs8wSec !== null && benchmark.deltaVs8wSec < -5) {
    reads.push(
      `${Math.abs(benchmark.deltaVs8wSec)} seconds faster on ${benchmark.routeLabel.split(" ")[0].toLowerCase()} than eight weeks ago.`,
    );
  }

  if (reads.length === 0) return { available: false, text: "" };
  return { available: true, text: `${reads[0]} — Coach` };
}

// ─── Running activity heatmap (spine) ───────────────────────────────────────

export type RunningHeatmapCell = "empty" | "run";

export interface RunningActivityHeatmapSnapshot {
  rangeLabel: string;
  months: Array<{
    label: string;
    cells: RunningHeatmapCell[];
    dates: Array<string | null>;
  }>;
  sessionCount52w: number;
  currentWeeklyStreak: number;
  longestWeeklyStreak: number;
}

export function buildRunningActivityHeatmap(
  activities: Activity[],
  now: number = Date.now(),
): RunningActivityHeatmapSnapshot {
  const end = new Date(now);
  const start = new Date(end.getFullYear(), end.getMonth() - 11, 1);
  const cutoff52 = now - FIFTY_TWO_WEEKS_MS;
  const byDate = new Set<string>();
  const streakDateKeys: string[] = [];
  let sessionCount52w = 0;

  for (const activity of activities) {
    if (getTrainingCategory(activity) !== "run") continue;
    const date = parseLocal(activity.start_date_local);
    const timestamp = date.getTime();
    const key = localDateKey(date);
    streakDateKeys.push(key);
    if (timestamp >= cutoff52 && timestamp <= now) sessionCount52w += 1;
    if (date < start || date > end) continue;
    byDate.add(key);
  }

  const months = Array.from({ length: 12 }, (_, index) => {
    const monthDate = new Date(start.getFullYear(), start.getMonth() + index, 1);
    const dates = Array.from({ length: 28 }, (_, dayIndex) => {
      const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), dayIndex + 1);
      return date.getMonth() === monthDate.getMonth() && date <= end ? localDateKey(date) : null;
    });
    const cells = dates.map((dateKey) => (dateKey && byDate.has(dateKey) ? "run" : "empty"));
    return {
      label: monthDate.toLocaleDateString("en-GB", { month: "short" }).toUpperCase(),
      cells,
      dates,
    };
  });

  const streaks = calculateWeeklyStreaks(streakDateKeys);
  const visibleMonths = months.slice(-3);

  return {
    rangeLabel: `${visibleMonths[0]?.label ?? ""}–${visibleMonths.at(-1)?.label ?? ""}`,
    months,
    sessionCount52w,
    currentWeeklyStreak: streaks.current,
    longestWeeklyStreak: streaks.longest,
  };
}

// ─── Assembled snapshot ─────────────────────────────────────────────────────

export interface RunningLensSnapshot {
  header: RunningHeaderStats;
  weeklyVolume: WeeklyVolumeSnapshot;
  benchmark: BenchmarkSnapshot;
  pbs: PbsSnapshot;
  paceTrend: PaceTrendSnapshot;
  effort: EffortSnapshot;
  coachRead: CoachReadSnapshot;
}

export function buildRunningLensModel(
  activities: Activity[],
  volumeScope: RunningScope,
  now: number = Date.now(),
): RunningLensSnapshot {
  const sessions = buildSessions(activities);
  const weeklyVolume = buildWeeklyVolume(sessions, volumeScope, now);
  const benchmark = buildBenchmark(sessions, now);
  const pbs = buildPbs(sessions);
  const paceTrend = buildPaceTrend(sessions, now);
  const effort = buildEffort(activities);
  const coachRead = buildCoachRead(weeklyVolume, paceTrend, benchmark);

  return {
    header: buildHeaderStats(activities, sessions),
    weeklyVolume,
    benchmark,
    pbs,
    paceTrend,
    effort,
    coachRead,
  };
}
