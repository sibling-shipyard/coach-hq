/** Read the structured match history written by iOS (ADR 0013, ADR 0050). */
import { type Activity, getTrainingCategory } from "./activities";

export interface ParsedGame {
  result: "W" | "L";
  score: string;
  myScore: number;
  oppScore: number;
  margin: number;
  partner: string | null;
  opponents: string[];
  gameNumber: number;
  isFriendly: boolean;
  format: "singles" | "doubles";
}

export interface ParsedMatch {
  wins: number;
  losses: number;
  winPct: number;
  comment: string | null;
  games: ParsedGame[];
  friendlies: ParsedGame[];
}

export interface ResolvedMatch {
  date: string;
  historyFile: string | null;
  activity: Activity | null;
  parsed: ParsedMatch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseGame(value: unknown, gameNumber: number): ParsedGame | null {
  if (!isRecord(value)) return null;
  const { scoreFor, scoreAgainst, result, partner, opponents, category, format } = value;
  if (
    (result !== "W" && result !== "L") ||
    typeof scoreFor !== "number" ||
    typeof scoreAgainst !== "number" ||
    !Number.isFinite(scoreFor) ||
    !Number.isFinite(scoreAgainst) ||
    !Array.isArray(opponents)
  )
    return null;

  const isFriendly = category === "friendly";
  return {
    result,
    score: `${scoreFor}-${scoreAgainst}`,
    myScore: scoreFor,
    oppScore: scoreAgainst,
    margin: scoreFor - scoreAgainst,
    partner: typeof partner === "string" && partner.trim() ? partner.trim() : null,
    opponents: opponents
      .filter((name): name is string => typeof name === "string" && !!name.trim())
      .map((name) => name.trim()),
    gameNumber,
    isFriendly,
    format: format === "singles" || format === "doubles" ? format : partner ? "doubles" : "singles",
  };
}

function parseMatch(value: Record<string, unknown>): ParsedMatch | null {
  if (!Array.isArray(value.games)) return null;
  const parsed = value.games
    .map((game, index) => parseGame(game, index + 1))
    .filter((game): game is ParsedGame => game !== null);
  if (parsed.length === 0) return null;
  const wins = parsed.filter((game) => game.result === "W").length;
  const games = parsed.filter((game) => !game.isFriendly);
  const friendlies = parsed.filter((game) => game.isFriendly);
  return {
    wins,
    losses: parsed.length - wins,
    winPct: Math.round((wins / parsed.length) * 100),
    comment: typeof value.notes === "string" && value.notes.trim() ? value.notes.trim() : null,
    games,
    friendlies,
  };
}

/**
 * Keyed records join only their exact hist basename. A date-only record gets
 * activity metadata only when exactly one unkeyed record and one unclaimed
 * badminton activity share that date. Ambiguous records keep their games.
 */
export function resolveMatchSessions(activities: Activity[], history: unknown): ResolvedMatch[] {
  const rawSessions = isRecord(history) && Array.isArray(history.sessions) ? history.sessions : [];
  const entries = rawSessions.flatMap((value) => {
    if (
      !isRecord(value) ||
      typeof value.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value.date)
    )
      return [];
    const parsed = parseMatch(value);
    return parsed
      ? [
          {
            date: value.date,
            historyFile:
              typeof value.historyFile === "string" && value.historyFile ? value.historyFile : null,
            legacy: value.historyFile === undefined || value.historyFile === null,
            parsed,
          },
        ]
      : [];
  });

  const badminton = activities.filter((activity) =>
    getTrainingCategory(activity).startsWith("badminton"),
  );
  const byFile = new Map(
    badminton
      .filter((activity) => activity.history_file)
      .map((activity) => [activity.history_file, activity]),
  );
  const claimed = new Set(
    entries.map((entry) => entry.historyFile).filter((file): file is string => file !== null),
  );
  const unclaimedByDate = new Map<string, Activity[]>();
  for (const activity of badminton) {
    if (activity.history_file && claimed.has(activity.history_file)) continue;
    const date = activity.start_date_local.slice(0, 10);
    unclaimedByDate.set(date, [...(unclaimedByDate.get(date) ?? []), activity]);
  }
  const legacyCounts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.legacy) legacyCounts.set(entry.date, (legacyCounts.get(entry.date) ?? 0) + 1);
  }

  return entries.map((entry) => ({
    date: entry.date,
    historyFile: entry.historyFile,
    parsed: entry.parsed,
    activity: entry.historyFile
      ? (byFile.get(entry.historyFile) ?? null)
      : entry.legacy &&
          legacyCounts.get(entry.date) === 1 &&
          unclaimedByDate.get(entry.date)?.length === 1
        ? unclaimedByDate.get(entry.date)![0]
        : null,
  }));
}

export function getAllGames(match: ParsedMatch): ParsedGame[] {
  return [...match.games, ...match.friendlies].sort((a, b) => a.gameNumber - b.gameNumber);
}

export function getRankedGames(match: ParsedMatch): ParsedGame[] {
  return match.games;
}
