/**
 * badmintonLensModel.ts — Data model for the Badminton Play LENS.
 * Everything here is derived from logged activities + parsed match descriptions.
 * No fabricated numbers: widgets with insufficient sample size report an
 * empty/opt-in state rather than guessing.
 */
import { type Activity, getTrainingCategory, parseLocal } from "@/lib/activities";
import {
  getAllGames,
  getRankedGames,
  parseMatch,
  type ParsedGame,
  type ParsedMatch,
} from "@/lib/matchParser";

export type BadmintonMode = "ranked" | "all";

const RANKED_CATEGORIES = new Set(["badminton_ranked", "badminton_league", "RNK", "LGE"]);
const ALL_CATEGORIES = new Set([
  "badminton_ranked",
  "badminton_league",
  "badminton_friendly",
  "badminton_casual",
  "badminton",
  "RNK",
  "LGE",
  "FRN",
  "CAS",
]);
const EIGHT_WEEKS_MS = 56 * 24 * 60 * 60 * 1000;
const FIFTY_TWO_WEEKS_MS = 52 * 7 * 24 * 60 * 60 * 1000;
const MIN_POSITION_SAMPLES = 5;
const MIN_OPPONENT_GAMES = 3;
const MIN_MONTH_SESSIONS = 3;

export interface BadmintonSession {
  activity: Activity;
  parsed: ParsedMatch;
  dateKey: string;
  timestamp: number;
}

function buildSessions(activities: Activity[]): BadmintonSession[] {
  const result: BadmintonSession[] = [];
  for (const activity of activities) {
    const category = getTrainingCategory(activity);
    if (!ALL_CATEGORIES.has(category)) continue;
    const parsed = parseMatch(activity);
    if (!parsed || (parsed.games.length === 0 && parsed.friendlies.length === 0)) continue;
    result.push({
      activity,
      parsed,
      dateKey: activity.start_date_local.slice(0, 10),
      timestamp: parseLocal(activity.start_date_local).getTime(),
    });
  }
  result.sort((a, b) => a.timestamp - b.timestamp);
  return result;
}

function gamesForMode(session: BadmintonSession, mode: BadmintonMode): ParsedGame[] {
  return mode === "ranked" ? getRankedGames(session.parsed) : getAllGames(session.parsed);
}

function winPct(wins: number, losses: number): number {
  const total = wins + losses;
  return total > 0 ? Math.round((wins / total) * 100) : 0;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

// ─── Header stats ───────────────────────────────────────────────────────────

export interface BadmintonHeaderStats {
  totalSessions: number;
  sessionsWithMatchData: number;
  rankedGameCount: number;
  allGameCount: number;
}

function buildHeaderStats(activities: Activity[], sessions: BadmintonSession[]): BadmintonHeaderStats {
  const totalSessions = activities.filter((a) => ALL_CATEGORIES.has(getTrainingCategory(a))).length;
  let rankedGameCount = 0;
  let allGameCount = 0;
  for (const session of sessions) {
    rankedGameCount += getRankedGames(session.parsed).length;
    allGameCount += getAllGames(session.parsed).length;
  }
  return {
    totalSessions,
    sessionsWithMatchData: sessions.length,
    rankedGameCount,
    allGameCount,
  };
}

// ─── Win Rate hero ──────────────────────────────────────────────────────────

export interface WinRateTrendPoint {
  label: string;
  sessionWinPct: number;
  rollingWinPct: number | null;
  activityId: number | string;
  timestamp: number;
}

export interface WinRateWindow {
  winPct: number;
  wins: number;
  losses: number;
  games: number;
  verdict: string;
  trend: WinRateTrendPoint[];
}

export interface WinRateYearWindow {
  /** e.g. "JUL '25 – JUL '26". Newest window is index 0. */
  rangeLabel: string;
  window: WinRateWindow;
}

export interface WinRateSnapshot {
  available: boolean;
  bandLow: number;
  bandHigh: number;
  eightWeek: WinRateWindow;
  /** Rolling 52-week windows, paged back through history. Index 0 = most recent. */
  yearWindows: WinRateYearWindow[];
}

function verdictForWindow(pct: number, low: number, high: number, hasGames: boolean): string {
  if (!hasGames) return "no games logged in this window";
  if (pct > high) return "above the band — improving";
  if (pct < low) return "below the band";
  return "in the band";
}

function formatMonthYear(timestamp: number): string {
  return new Date(timestamp)
    .toLocaleDateString("en-GB", { month: "short", year: "2-digit" })
    .toUpperCase()
    .replace(" ", " '");
}

function buildWinRate(sessions: BadmintonSession[], mode: BadmintonMode, now: number): WinRateSnapshot {
  // Chronological per-session win% + 28-day rolling win% (game-weighted), used
  // both for the band (statistical spread of the rolling series) and the trend line.
  const points: Array<{
    timestamp: number;
    label: string;
    activityId: number | string;
    wins: number;
    losses: number;
    rolling: number | null;
  }> = sessions.map((session) => {
    const games = gamesForMode(session, mode);
    const wins = games.filter((g) => g.result === "W").length;
    const losses = games.filter((g) => g.result === "L").length;
    const date = parseLocal(session.activity.start_date_local);
    return {
      timestamp: session.timestamp,
      label: date.toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase(),
      activityId: session.activity.id,
      wins,
      losses,
      rolling: null,
    };
  });

  for (let i = 0; i < points.length; i++) {
    const cutoff = points[i].timestamp - 28 * 24 * 60 * 60 * 1000;
    const window = points.filter((p, j) => j <= i && p.timestamp >= cutoff);
    const totalWins = window.reduce((sum, p) => sum + p.wins, 0);
    const totalGames = window.reduce((sum, p) => sum + p.wins + p.losses, 0);
    points[i].rolling = window.length >= 2 && totalGames > 0
      ? Math.round((totalWins / totalGames) * 100)
      : null;
  }

  const rollingValues = points
    .map((p) => p.rolling)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);

  const hasBand = rollingValues.length >= 4;
  const bandLow = hasBand ? Math.round(percentile(rollingValues, 0.25)) : 0;
  const bandHigh = hasBand ? Math.round(percentile(rollingValues, 0.75)) : 100;

  // A window is any [start, end) slice of the chronological points — used both
  // for the fixed 8-week window and for each paged 52-week year window.
  function windowForRange(start: number | null, end: number): WinRateWindow {
    const inWindow = points.filter((p) => (start === null || p.timestamp >= start) && p.timestamp < end);
    const wins = inWindow.reduce((sum, p) => sum + p.wins, 0);
    const losses = inWindow.reduce((sum, p) => sum + p.losses, 0);
    const pct = winPct(wins, losses);
    return {
      winPct: pct,
      wins,
      losses,
      games: wins + losses,
      verdict: hasBand
        ? verdictForWindow(pct, bandLow, bandHigh, wins + losses > 0)
        : "not enough history for a band yet",
      trend: inWindow.map((p) => ({
        label: p.label,
        sessionWinPct: winPct(p.wins, p.losses),
        rollingWinPct: p.rolling,
        activityId: p.activityId,
        timestamp: p.timestamp,
      })),
    };
  }

  const eightWeek = windowForRange(now - EIGHT_WEEKS_MS, now + 1);

  // Page backward from "now" in 52-week steps until the earliest session is covered.
  const yearWindows: WinRateYearWindow[] = [];
  if (points.length > 0) {
    const earliest = points[0].timestamp;
    const pageCount = Math.max(1, Math.ceil((now - earliest) / FIFTY_TWO_WEEKS_MS));
    for (let page = 0; page < pageCount; page++) {
      const end = now - page * FIFTY_TWO_WEEKS_MS;
      const start = end - FIFTY_TWO_WEEKS_MS;
      yearWindows.push({
        rangeLabel: `${formatMonthYear(start)} – ${formatMonthYear(end)}`,
        window: windowForRange(start, end),
      });
    }
  }

  return {
    available: points.length > 0,
    bandLow,
    bandHigh,
    eightWeek,
    yearWindows,
  };
}

// ─── Session shape ──────────────────────────────────────────────────────────

export interface SessionShapePoint {
  gameNumber: number;
  label: string;
  fiftyTwoWeekWinPct: number | null;
  eightWeekWinPct: number | null;
  sampleCount: number;
}

export interface SessionShapeSnapshot {
  available: boolean;
  points: SessionShapePoint[];
  read: string;
}

function buildSessionShapeRead(points: SessionShapePoint[]): string {
  const withPct = points.filter((point) => point.fiftyTwoWeekWinPct !== null);
  if (withPct.length < 3) return "Shape emerges once more games stack at each position.";
  const third = Math.max(1, Math.ceil(withPct.length / 3));
  const early = withPct.slice(0, third);
  const late = withPct.slice(-third);
  const avgEarly = early.reduce((sum, point) => sum + (point.fiftyTwoWeekWinPct ?? 0), 0) / early.length;
  const avgLate = late.reduce((sum, point) => sum + (point.fiftyTwoWeekWinPct ?? 0), 0) / late.length;
  const delta = Math.round(avgLate - avgEarly);
  if (delta <= -8) return `Win rate fades late — down ${Math.abs(delta)} pts from early to late games.`;
  if (delta >= 8) return `You finish strong — up ${delta} pts from early to late games.`;
  return "Win rate holds steady across the session — no clear fatigue curve.";
}

function buildSessionShape(sessions: BadmintonSession[], mode: BadmintonMode, now: number): SessionShapeSnapshot {
  const byPosition52w = new Map<number, ParsedGame[]>();
  const byPosition8w = new Map<number, ParsedGame[]>();
  const cutoff52 = now - FIFTY_TWO_WEEKS_MS;
  const cutoff8 = now - EIGHT_WEEKS_MS;

  for (const session of sessions) {
    if (session.timestamp < cutoff52) continue;
    const games = gamesForMode(session, mode);
    games.forEach((game, index) => {
      const position = index + 1;
      if (!byPosition52w.has(position)) byPosition52w.set(position, []);
      byPosition52w.get(position)!.push(game);
      if (session.timestamp >= cutoff8) {
        if (!byPosition8w.has(position)) byPosition8w.set(position, []);
        byPosition8w.get(position)!.push(game);
      }
    });
  }

  const positions = Array.from(byPosition52w.keys()).sort((a, b) => a - b);
  const points: SessionShapePoint[] = positions
    .map((position) => {
      const windowGames = byPosition52w.get(position) ?? [];
      const recentGames = byPosition8w.get(position) ?? [];
      const windowPct = windowGames.length >= MIN_POSITION_SAMPLES
        ? winPct(windowGames.filter((g) => g.result === "W").length, windowGames.filter((g) => g.result === "L").length)
        : null;
      const recentPct = recentGames.length >= 3
        ? winPct(recentGames.filter((g) => g.result === "W").length, recentGames.filter((g) => g.result === "L").length)
        : null;
      return {
        gameNumber: position,
        label: `GAME ${position}`,
        fiftyTwoWeekWinPct: windowPct,
        eightWeekWinPct: recentPct,
        sampleCount: windowGames.length,
      };
    })
    .filter((point) => point.fiftyTwoWeekWinPct !== null || point.eightWeekWinPct !== null);

  return { available: points.length >= 3, points, read: buildSessionShapeRead(points) };
}

// ─── Best month ─────────────────────────────────────────────────────────────

export interface BestMonthSnapshot {
  available: boolean;
  label: string;
  winPct: number;
  sessionCount: number;
  isHighestVolume: boolean;
}

function buildBestMonth(sessions: BadmintonSession[], mode: BadmintonMode): BestMonthSnapshot {
  const byMonth = new Map<string, { sessions: number; wins: number; losses: number; label: string }>();
  for (const session of sessions) {
    const date = parseLocal(session.activity.start_date_local);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    const games = gamesForMode(session, mode);
    if (games.length === 0) continue;
    const entry = byMonth.get(key) ?? {
      sessions: 0,
      wins: 0,
      losses: 0,
      label: date.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }).toUpperCase().replace(" ", " '"),
    };
    entry.sessions += 1;
    entry.wins += games.filter((g) => g.result === "W").length;
    entry.losses += games.filter((g) => g.result === "L").length;
    byMonth.set(key, entry);
  }

  const months = Array.from(byMonth.values());
  const qualifying = months.filter((m) => m.sessions >= MIN_MONTH_SESSIONS);
  if (qualifying.length === 0) return { available: false, label: "", winPct: 0, sessionCount: 0, isHighestVolume: false };

  qualifying.sort((a, b) => {
    const pctDiff = winPct(b.wins, b.losses) - winPct(a.wins, a.losses);
    return pctDiff !== 0 ? pctDiff : b.sessions - a.sessions;
  });
  const best = qualifying[0];
  const maxSessions = Math.max(...months.map((m) => m.sessions));

  return {
    available: true,
    label: best.label,
    winPct: winPct(best.wins, best.losses),
    sessionCount: best.sessions,
    isHighestVolume: best.sessions === maxSessions,
  };
}

// ─── Head-to-head ───────────────────────────────────────────────────────────

export interface HeadToHeadRow {
  name: string;
  fiftyTwoWeekRecord: string;
  fiftyTwoWeekWinPct: number;
  fiftyTwoWeekGames: number;
  recentRecord: string;
  recentGames: number;
  direction: string;
  tone: "up" | "down" | "flat";
}

export interface HeadToHeadSnapshot {
  available: boolean;
  rows: HeadToHeadRow[];
}

function buildHeadToHead(sessions: BadmintonSession[], mode: BadmintonMode, now: number): HeadToHeadSnapshot {
  const cutoff52 = now - FIFTY_TWO_WEEKS_MS;
  const cutoff8 = now - EIGHT_WEEKS_MS;
  const byOpponent = new Map<string, ParsedGame[]>();
  const byOpponentRecent = new Map<string, ParsedGame[]>();

  for (const session of sessions) {
    if (session.timestamp < cutoff52) continue;
    const games = gamesForMode(session, mode);
    for (const game of games) {
      for (const opponent of game.opponents) {
        if (!byOpponent.has(opponent)) byOpponent.set(opponent, []);
        byOpponent.get(opponent)!.push(game);
        if (session.timestamp >= cutoff8) {
          if (!byOpponentRecent.has(opponent)) byOpponentRecent.set(opponent, []);
          byOpponentRecent.get(opponent)!.push(game);
        }
      }
    }
  }

  const rows: HeadToHeadRow[] = [];
  Array.from(byOpponent.entries()).forEach(([name, games]) => {
    if (games.length < MIN_OPPONENT_GAMES) return;
    const wins = games.filter((g) => g.result === "W").length;
    const losses = games.filter((g) => g.result === "L").length;
    const windowPct = winPct(wins, losses);
    const recent = byOpponentRecent.get(name) ?? [];
    const recentWins = recent.filter((g) => g.result === "W").length;
    const recentLosses = recent.filter((g) => g.result === "L").length;

    let direction = "steady rivalry";
    let tone: "up" | "down" | "flat" = "flat";
    if (recent.length >= 2) {
      const recentPct = winPct(recentWins, recentLosses);
      if (recentPct - windowPct >= 15) {
        direction = "closing the gap";
        tone = "up";
      } else if (recentPct - windowPct <= -15) {
        direction = "his pace, not yours";
        tone = "down";
      } else if (recentPct >= 50) {
        direction = "edge holding";
        tone = "up";
      } else {
        direction = "steady rivalry";
        tone = "flat";
      }
    } else {
      direction = "no recent meetings";
      tone = "flat";
    }

    rows.push({
      name,
      fiftyTwoWeekRecord: `${wins}W–${losses}L`,
      fiftyTwoWeekWinPct: windowPct,
      fiftyTwoWeekGames: games.length,
      recentRecord: recent.length > 0 ? `${recentWins}W–${recentLosses}L` : "—",
      recentGames: recent.length,
      direction,
      tone,
    });
  });

  rows.sort((a, b) => b.fiftyTwoWeekGames - a.fiftyTwoWeekGames);

  return { available: rows.length > 0, rows };
}

// ─── Am I improving ─────────────────────────────────────────────────────────

export interface ImprovingRow {
  label: string;
  fiftyTwoWeek: string;
  recent: string;
  improved: boolean | null;
}

export interface AmIImprovingSnapshot {
  available: boolean;
  rows: ImprovingRow[];
}

function closeGamesWinPct(games: ParsedGame[]): number | null {
  const close = games.filter((g) => Math.abs(g.margin) <= 3);
  if (close.length === 0) return null;
  return winPct(close.filter((g) => g.result === "W").length, close.filter((g) => g.result === "L").length);
}

function avgMargin(games: ParsedGame[]): number | null {
  if (games.length === 0) return null;
  return Math.round((games.reduce((sum, g) => sum + g.margin, 0) / games.length) * 10) / 10;
}

function fadePoint(shape: SessionShapePoint[], key: "fiftyTwoWeekWinPct" | "eightWeekWinPct"): string {
  const drop = shape.find((p) => (p[key] ?? 100) < 50);
  return drop ? `GAME ${drop.gameNumber}` : "—";
}

function buildAmIImproving(
  sessions: BadmintonSession[],
  mode: BadmintonMode,
  now: number,
  shape: SessionShapeSnapshot,
): AmIImprovingSnapshot {
  const cutoff8 = now - EIGHT_WEEKS_MS;
  const cutoff52 = now - FIFTY_TWO_WEEKS_MS;
  const windowGames = sessions.filter((s) => s.timestamp >= cutoff52).flatMap((s) => gamesForMode(s, mode));
  const recentGames = sessions.filter((s) => s.timestamp >= cutoff8).flatMap((s) => gamesForMode(s, mode));

  if (recentGames.length < 6) return { available: false, rows: [] };

  const windowWinPct = winPct(windowGames.filter((g) => g.result === "W").length, windowGames.filter((g) => g.result === "L").length);
  const recentWinPct = winPct(recentGames.filter((g) => g.result === "W").length, recentGames.filter((g) => g.result === "L").length);
  const windowClose = closeGamesWinPct(windowGames);
  const recentClose = closeGamesWinPct(recentGames);
  const windowAvgMargin = avgMargin(windowGames);
  const recentAvgMargin = avgMargin(recentGames);
  const windowFade = fadePoint(shape.points, "fiftyTwoWeekWinPct");
  const recentFade = fadePoint(shape.points, "eightWeekWinPct");

  const rows: ImprovingRow[] = [
    {
      label: "WIN RATE",
      fiftyTwoWeek: `${windowWinPct}%`,
      recent: `${recentWinPct}%`,
      improved: recentWinPct === windowWinPct ? null : recentWinPct > windowWinPct,
    },
  ];
  if (windowClose !== null && recentClose !== null) {
    rows.push({
      label: "CLOSE GAMES WON",
      fiftyTwoWeek: `${windowClose}%`,
      recent: `${recentClose}%`,
      improved: recentClose === windowClose ? null : recentClose > windowClose,
    });
  }
  if (windowAvgMargin !== null && recentAvgMargin !== null) {
    rows.push({
      label: "AVG MARGIN",
      fiftyTwoWeek: windowAvgMargin > 0 ? `+${windowAvgMargin}` : `${windowAvgMargin}`,
      recent: recentAvgMargin > 0 ? `+${recentAvgMargin}` : `${recentAvgMargin}`,
      improved: recentAvgMargin === windowAvgMargin ? null : recentAvgMargin > windowAvgMargin,
    });
  }
  if (windowFade !== "—" || recentFade !== "—") {
    const windowNum = windowFade === "—" ? null : Number(windowFade.replace("GAME ", ""));
    const recentNum = recentFade === "—" ? null : Number(recentFade.replace("GAME ", ""));
    rows.push({
      label: "FADE POINT",
      fiftyTwoWeek: windowFade,
      recent: recentFade,
      improved: windowNum === null || recentNum === null || recentNum === windowNum
        ? null
        : recentNum > windowNum,
    });
  }

  return { available: true, rows };
}

// ─── Effort (HR zones) ──────────────────────────────────────────────────────

export interface EffortSnapshot {
  available: boolean;
  zones: Array<{ label: string; percent: number; color: string }>;
}

// Z5 stays inside the warm palette — the alarm indigo (--wi ink-alarm) is
// reserved for real "something's wrong" states and must never appear here.
const ZONE_COLORS = ["#adc2b7", "#315a4a", "#a8702c", "#7f3728", "#4a241a"];

function buildEffort(sessions: BadmintonSession[]): EffortSnapshot {
  const totals = [0, 0, 0, 0, 0];
  let anyZones = false;
  for (const session of sessions) {
    const zones = session.activity.hr_zones;
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

// ─── Badminton activity heatmap (spine) ─────────────────────────────────────

export type BadmintonHeatmapCell = "empty" | "ranked" | "league" | "friendly" | "casual";

const HEATMAP_CATEGORY_PRIORITY: Array<{ category: string; cell: BadmintonHeatmapCell }> = [
  { category: "badminton_ranked", cell: "ranked" },
  { category: "badminton_league", cell: "league" },
  { category: "badminton_friendly", cell: "friendly" },
  { category: "badminton_casual", cell: "casual" },
];

function dominantBadmintonCell(categories: string[]): BadmintonHeatmapCell {
  for (const entry of HEATMAP_CATEGORY_PRIORITY) {
    if (categories.includes(entry.category)) return entry.cell;
  }
  return "empty";
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export interface BadmintonActivityHeatmapSnapshot {
  rangeLabel: string;
  months: Array<{
    label: string;
    cells: BadmintonHeatmapCell[];
    dates: Array<string | null>;
  }>;
  /** Sessions in the last 52 weeks — matches the lens analytics window. */
  sessionCount52w: number;
  currentWeeklyStreak: number;
  longestWeeklyStreak: number;
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

export function buildBadmintonActivityHeatmap(
  activities: Activity[],
  now: number = Date.now(),
): BadmintonActivityHeatmapSnapshot {
  const end = new Date(now);
  const start = new Date(end.getFullYear(), end.getMonth() - 11, 1);
  const cutoff52 = now - FIFTY_TWO_WEEKS_MS;
  const byDate = new Map<string, string[]>();
  const streakDateKeys: string[] = [];
  let sessionCount52w = 0;

  for (const activity of activities) {
    const category = getTrainingCategory(activity);
    if (!ALL_CATEGORIES.has(category)) continue;
    const date = parseLocal(activity.start_date_local);
    const timestamp = date.getTime();
    const key = localDateKey(date);
    streakDateKeys.push(key);
    if (timestamp >= cutoff52 && timestamp <= now) sessionCount52w += 1;
    if (date < start || date > end) continue;
    const categories = byDate.get(key) ?? [];
    categories.push(category);
    byDate.set(key, categories);
  }

  const months = Array.from({ length: 12 }, (_, index) => {
    const monthDate = new Date(start.getFullYear(), start.getMonth() + index, 1);
    const dates = Array.from({ length: 28 }, (_, dayIndex) => {
      const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), dayIndex + 1);
      return date.getMonth() === monthDate.getMonth() && date <= end ? localDateKey(date) : null;
    });
    const cells = dates.map((dateKey) =>
      dateKey ? dominantBadmintonCell(byDate.get(dateKey) ?? []) : "empty",
    );
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

export interface BadmintonLensSnapshot {
  header: BadmintonHeaderStats;
  winRate: WinRateSnapshot;
  sessionShape: SessionShapeSnapshot;
  bestMonth: BestMonthSnapshot;
  headToHead: HeadToHeadSnapshot;
  amIImproving: AmIImprovingSnapshot;
  effort: EffortSnapshot;
}

export function buildBadmintonLensModel(
  activities: Activity[],
  mode: BadmintonMode,
  now: number = Date.now(),
): BadmintonLensSnapshot {
  const sessions = buildSessions(activities);
  const shape = buildSessionShape(sessions, mode, now);

  return {
    header: buildHeaderStats(activities, sessions),
    winRate: buildWinRate(sessions, mode, now),
    sessionShape: shape,
    bestMonth: buildBestMonth(sessions, mode),
    headToHead: buildHeadToHead(sessions, mode, now),
    amIImproving: buildAmIImproving(sessions, mode, now, shape),
    effort: buildEffort(sessions),
  };
}
