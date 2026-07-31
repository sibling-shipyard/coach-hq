/**
 * matchParser.ts — Parse formatted badminton match descriptions from activity JSON.
 *
 * Reads the display-layer description written by iOS DescriptionParser (ADR 0013).
 * Doubles: `W 21-18 w/ Partner vs Opp1 + Opp2`
 * Singles:  `W 21-18 vs Opponent`
 *
 * W/L on each line determines myScore vs oppScore: W → max, L → min.
 */

import type { Activity } from "./activities";
import { normalizeName } from "./nameAliases";

// ─── Types ──────────────────────────────────────────────────────────────────

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

// ─── Description Parser ─────────────────────────────────────────────────────

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
  const format = partner ? "doubles" : "singles";
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
    format,
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

export function parseMatch(activity: Activity): ParsedMatch | null {
  return parseDescription(activity.description);
}

export function getAllGames(match: ParsedMatch): ParsedGame[] {
  return [...match.games, ...match.friendlies];
}

/** Get only ranked games (excludes friendlies section) */
export function getRankedGames(match: ParsedMatch): ParsedGame[] {
  return match.games;
}
