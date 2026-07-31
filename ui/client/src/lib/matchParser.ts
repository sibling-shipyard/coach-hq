/**
 * matchParser.ts - Parse match descriptions from Strava activity descriptions.
 *
 * Handles two description formats:
 * 1. Enriched descriptions (from strava-enrichment pipeline)
 * 2. eBadders structured data (fallback)
 *
 * Score convention: scores are always winner-loser in ranked (ebadders) descriptions,
 * and player's-score-first in friendly descriptions. We use the W/L result to determine
 * myScore vs oppScore universally: W → myScore = max, L → myScore = min.
 */

import type { Activity } from "./activities";
import { normalizeName } from "./nameAliases";

// ─── Types ───────────────────�export interface ParsedGame {
  result: "W" | "L";
  score: string;           // "21-18"
  myScore: number;         // player's score
  oppScore: number;        // Opponent's score
  margin: number;          // positive for wins, negative for losses
  partner: string | null;  // null for singles
  opponents: string[];
  gameNumber: number;      // 1-indexed position in session
  isFriendly: boolean;     // true if category === "friendly"
  format: "singles" | "doubles";
  category: "ranked" | "friendly";
}

export interface ParsedMatch {
  wins: number;
  losses: number;
  winPct: number;
  comment: string | null;
  games: ParsedGame[];
  friendlies: ParsedGame[];
}

export interface StructuredGame {
  format?: "singles" | "doubles";
  category?: "ranked" | "friendly";
  partner?: string | null;
  opponents?: string[];
  scoreFor?: number;
  scoreAgainst?: number;
  result?: "W" | "L";
  score?: string;
  akash_won?: boolean;
  akashWon?: boolean;
  vs?: string[];
}

export interface StructuredSession {
  date?: string;
  activityId?: number | null;
  rank?: number | null;
  notes?: string | null;
  summary?: { wins: number; losses: number; winPct: number };
  games?: StructuredGame[];
  matches?: StructuredGame[];
}

// ─── Description Parser (Text fallback) ────────────────────────────────────

const WL_SUMMARY_RE = /(\d+)W[–-](\d+)L\s*\((\d+)%?\)/;
const GAME_LINE_RE = /^(W|L)\s+(\d+)[–-](\d+)\s+(?:w\/\s+(.+?)\s+)?vs\s+(.+)$/i;

function parseGameLine(line: string, gameNumber: number, isFriendly: boolean): ParsedGame | null {
  const m = line.trim().match(GAME_LINE_RE);
  if (!m) return null;

  const result = m[1].toUpperCase() as "W" | "L";
  const s1 = parseInt(m[2], 10);
  const s2 = parseInt(m[3], 10);
  const partnerRaw = m[4]?.trim();
  const partner = partnerRaw ? normalizeName(partnerRaw) : null;
  const isSingles = !partner;
  const opponents = m[5].split(/\s*\+\s*/).map((s) => normalizeName(s.trim())).filter(Boolean);

  const myScore = result === "W" ? Math.max(s1, s2) : Math.min(s1, s2);
  const oppScore = result === "W" ? Math.min(s1, s2) : Math.max(s1, s2);
  const margin = myScore - oppScore;

  return {
    result,
    score: `${s1}-${s2}`,
    myScore,
    oppScore,
    margin,
    partner,
    opponents,
    gameNumber,
    isFriendly,
    format: isSingles ? "singles" : "doubles",
    category: isFriendly ? "friendly" : "ranked",
  };
}

export function parseDescription(description: string | null): ParsedMatch | null {
  if (!description) return null;

  const lines = description.split("\n").map((l) => l.trim());

  let summaryIdx = -1;
  let summaryWins = 0;
  let summaryLosses = 0;
  let summaryPct = 0;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(WL_SUMMARY_RE);
    if (m) {
      summaryIdx = i;
      summaryWins = parseInt(m[1], 10);
      summaryLosses = parseInt(m[2], 10);
      summaryPct = parseInt(m[3], 10);
      break;
    }
  }

  if (summaryIdx === -1) return null;

  const commentLines = lines.slice(0, summaryIdx).filter((l) => l.length > 0);
  const comment = commentLines.length > 0 ? commentLines.join("\n") : null;

  let gamesStartIdx = -1;
  for (let i = summaryIdx + 1; i < lines.length; i++) {
    if (/^Games:/i.test(lines[i])) {
      gamesStartIdx = i + 1;
      break;
    }
  }

  if (gamesStartIdx === -1) {
    return {
      wins: summaryWins,
      losses: summaryLosses,
      winPct: summaryPct,
      comment,
      games: [],
      friendlies: [],
    };
  }

  const games: ParsedGame[] = [];
  const friendlies: ParsedGame[] = [];
  let inFriendlies = false;
  let gameNumber = 1;

  for (let i = gamesStartIdx; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    if (/^Friendlies:/i.test(line)) {
      inFriendlies = true;
      continue;
    }

    const game = parseGameLine(line, gameNumber, inFriendlies);
    if (game) {
      if (inFriendlies) {
        friendlies.push(game);
      } else {
        games.push(game);
      }
      gameNumber++;
    }
  }

  const allGames = [...games, ...friendlies];
  const actualWins = allGames.filter((g) => g.result === "W").length;
  const actualLosses = allGames.filter((g) => g.result === "L").length;
  const total = actualWins + actualLosses;

  return {
    wins: allGames.length > 0 ? actualWins : summaryWins,
    losses: allGames.length > 0 ? actualLosses : summaryLosses,
    winPct: total > 0 ? Math.round((actualWins / total) * 100) : summaryPct,
    comment,
    games,
    friendlies,
  };
}

// ─── Structured JSON Match Parser ──────────────────────────────────────────

export function parseStructuredGames(rawGames: StructuredGame[]): ParsedMatch | null {
  if (!rawGames || !rawGames.length) return null;

  const games: ParsedGame[] = [];
  const friendlies: ParsedGame[] = [];
  let gameNumber = 1;

  for (const item of rawGames) {
    const won = item.result ? item.result === "W" : (item.akashWon ?? item.akash_won ?? false);
    const result: "W" | "L" = won ? "W" : "L";

    let s1 = item.scoreFor ?? 0;
    let s2 = item.scoreAgainst ?? 0;

    if (s1 === 0 && s2 === 0 && item.score) {
      const parts = item.score.split(/[–-]/).map((s) => parseInt(s.trim(), 10));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        s1 = parts[0];
        s2 = parts[1];
      }
    }

    const myScore = result === "W" ? Math.max(s1, s2) : Math.min(s1, s2);
    const oppScore = result === "W" ? Math.min(s1, s2) : Math.max(s1, s2);

    let partnerStr: string | null = null;
    if (typeof item.partner === "string" && item.partner && item.partner !== "Solo") {
      partnerStr = normalizeName(item.partner);
    } else if (Array.isArray(item.partner) && item.partner.length > 0 && item.partner[0] !== "Solo") {
      partnerStr = normalizeName(item.partner[0]);
    }

    const rawOpponents = item.opponents ?? item.vs ?? [];
    const opponents = rawOpponents.map((v) => normalizeName(v)).filter(Boolean);
    const format = item.format ?? (!partnerStr ? "singles" : "doubles");
    const category = item.category ?? "ranked";
    const isFriendly = category === "friendly";

    const parsedGame: ParsedGame = {
      result,
      score: `${s1}-${s2}`,
      myScore,
      oppScore,
      margin: myScore - oppScore,
      partner: partnerStr,
      opponents,
      gameNumber,
      isFriendly,
      format,
      category,
    };

    if (isFriendly) {
      friendlies.push(parsedGame);
    } else {
      games.push(parsedGame);
    }
    gameNumber++;
  }

  const allGames = [...games, ...friendlies];
  const wins = allGames.filter((g) => g.result === "W").length;
  const losses = allGames.filter((g) => g.result === "L").length;
  const total = wins + losses;

  return {
    wins,
    losses,
    winPct: total > 0 ? Math.round((wins / total) * 100) : 0,
    comment: null,
    games,
    friendlies,
  };
}

export function parseEbadders(ebadders: { matches?: StructuredGame[] }): ParsedMatch | null {
  if (!ebadders?.matches?.length) return null;
  return parseStructuredGames(ebadders.matches);
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

export function parseMatch(
  activity: Activity & {
    games?: StructuredGame[];
    match_history?: StructuredSession;
    ebadders?: { matches?: StructuredGame[] };
  }
): ParsedMatch | null {
  if (activity.games?.length) {
    return parseStructuredGames(activity.games);
  }
  if (activity.match_history?.games?.length) {
    return parseStructuredGames(activity.match_history.games);
  }
  if (activity.ebadders?.matches?.length) {
    const fromEb = parseEbadders(activity.ebadders);
    if (fromEb) {
      const fromDesc = parseDescription(activity.description);
      if (fromDesc?.comment) fromEb.comment = fromDesc.comment;
      return fromEb;
    }
  }

  return parseDescription(activity.description);
}Desc) {
    // Try ebadders for full game data
    if (activity.ebadders) {
      const fromEb = parseEbadders(activity.ebadders);
      if (fromEb && fromEb.games.length > 0) {
        // Preserve the comment from description
        fromEb.comment = fromDesc.comment;
        return fromEb;
      }
    }
    return fromDesc;
  }

  // No description match - try ebadders fallback
  if (activity.ebadders) {
    return parseEbadders(activity.ebadders);
  }

  return null;
}

// ─── Utility: Get all games from a parsed match ─────────────────────────────

export function getAllGames(match: ParsedMatch): ParsedGame[] {
  return [...match.games, ...match.friendlies];
}

/** Get only ranked games (excludes friendlies section) */
export function getRankedGames(match: ParsedMatch): ParsedGame[] {
  return match.games;
}
