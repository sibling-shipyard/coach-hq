/**
 * Athlete OS — Activity data utilities
 * Formatting, filtering, aggregation, and training category classification.
 */
import { toLocalDateStr } from "@/lib/challenge";

export interface HrZone {
  low: number | null;
  high: number | null;
  seconds: number;
}

export interface Activity {
  id: number | string;
  /** Optional machine category — when present, used by getTrainingCategory before name-regex fallbacks. */
  category?: string;
  name: string;
  sport_type: string;
  start_date_local: string;
  elapsed_time: number;
  moving_time: number;
  calories: number;
  distance: number;
  total_elevation_gain: number;
  average_heartrate: number | null;
  max_heartrate: number | null;
  has_heartrate: boolean;
  hr_zones: Record<string, HrZone> | null;
  description: string | null;
  total_photo_count: number;
  average_speed: number;
  average_cadence: number | null;
  max_speed: number;
  device_name: string | null;
  best_efforts: Array<{
    name: string;
    moving_time: number;
    start_date_local: string;
    pr_rank: number | null;
  }> | null;
}

// ─── Training Category Classification ───────────────────────────────────────
// Based on activity name patterns from the enrichment pipeline.

export type TrainingCategory =
  | "foundation"
  | "strength"
  | "weight_training"
  | "calisthenics"
  | "recovery"
  | "realign"
  | "badminton_ranked"
  | "badminton_league"
  | "badminton_friendly"
  | "badminton_casual"
  | "hike"
  | "walk"
  | "cricket"
  | "football"
  | "workout"
  | "swim"
  | "ride"
  | "run"
  | "other";

export interface CategoryConfig {
  label: string;
  shortLabel: string;
  color: string;
  group: "foundation" | "strength" | "weight_training" | "calisthenics" | "badminton" | "hike" | "ride" | "other";
}

export const CATEGORY_CONFIG: Record<TrainingCategory, CategoryConfig> = {
  foundation:       { label: "FOUNDATION",   shortLabel: "FDN",  color: "#60a5fa", group: "foundation" },
  strength:         { label: "STRENGTH",     shortLabel: "STR",  color: "#111111", group: "strength" },
  weight_training:  { label: "WEIGHTS",      shortLabel: "WGT",  color: "#3b4a6b", group: "weight_training" },
  calisthenics:     { label: "CALISTHENICS", shortLabel: "CAL",  color: "#f59e0b", group: "calisthenics" },
  recovery:         { label: "RECOVERY",     shortLabel: "REC",  color: "#7c3aed", group: "other" },
  realign:          { label: "REALIGN",      shortLabel: "RLN",  color: "#a78bfa", group: "other" },
  badminton_ranked:   { label: "RANKED",   shortLabel: "RNK", color: "#dc2626", group: "badminton" },
  badminton_league:   { label: "LEAGUE",   shortLabel: "LGE", color: "#7c3aed", group: "badminton" },
  badminton_friendly: { label: "FRIENDLY", shortLabel: "FRN", color: "#2563eb", group: "badminton" },
  badminton_casual:   { label: "CASUAL",   shortLabel: "CAS", color: "#6b7280", group: "badminton" },
  hike:             { label: "HIKE",         shortLabel: "HIK",  color: "#8b6f47", group: "hike" },
  walk:             { label: "WALK",         shortLabel: "WLK",  color: "#a8a29e", group: "other" },
  cricket:          { label: "CRICKET",      shortLabel: "CRK",  color: "#2dd4bf", group: "other" },
  football:         { label: "FOOTBALL",     shortLabel: "FBL",  color: "#e11d48", group: "other" },
  workout:          { label: "WORKOUT",      shortLabel: "WKT",  color: "#6b7280", group: "other" },
  swim:             { label: "SWIM",         shortLabel: "SWM",  color: "#0ea5e9", group: "other" },
  ride:             { label: "RIDE",         shortLabel: "RDE",  color: "#c47a20", group: "ride" },
  run:              { label: "RUN",          shortLabel: "RUN",  color: "#c44020", group: "other" },
  other:            { label: "OTHER",        shortLabel: "OTH",  color: "#777",    group: "other" },
};

// Group-level config for summary cards
export const GROUP_CONFIG: Record<string, { label: string; color: string; categories: TrainingCategory[] }> = {
  foundation:    { label: "FOUNDATION",   color: "#60a5fa", categories: ["foundation"] },
  strength:      { label: "STRENGTH",     color: "#111111", categories: ["strength"] },
  calisthenics:  { label: "CALISTHENICS", color: "#f59e0b", categories: ["calisthenics"] },
  run:          { label: "RUN",          color: "#c44020", categories: ["run"] },
  hike:         { label: "HIKE",         color: "#8b6f47", categories: ["hike"] },
  badminton:    { label: "BADMINTON",    color: "#2d8a4e", categories: ["badminton_ranked", "badminton_league", "badminton_friendly", "badminton_casual"] },
  swim:         { label: "SWIM",         color: "#0ea5e9", categories: ["swim"] },
  weight_training: { label: "WEIGHTS",       color: "#3b4a6b", categories: ["weight_training"] },
  ride:         { label: "RIDES",        color: "#c47a20", categories: ["ride"] },
};

export function getTrainingCategory(activity: Activity): TrainingCategory {
  if (activity.category) {
    return activity.category as TrainingCategory;
  }

  const name = activity.name;

  // Run
  if (/^Run\s*#/i.test(name)) return "run";

  // Foundation
  if (/^Foundation\s*#/i.test(name)) return "foundation";

  // Strength
  if (/^Strength\s+(A|B)/i.test(name)) return "strength";

  // Weight Training
  if (/^Weight Training\s*#/i.test(name)) return "weight_training";

  // Calisthenics
  if (/^Calisthenics\s*#/i.test(name)) return "calisthenics";

  // Recovery
  if (/^Recovery\s*#/i.test(name)) return "recovery";

  // Realign
  if (/^Realign\s*#/i.test(name)) return "realign";

  // Badminton sub-categories
  if (/^Badminton: Ranked\s*#/i.test(name))   return "badminton_ranked";
  if (/^Badminton: League\s*#/i.test(name))   return "badminton_league";
  if (/^Badminton: Friendly\s*#/i.test(name)) return "badminton_friendly";
  if (/^Badminton: Casual\s*#/i.test(name))   return "badminton_casual";

  // Swim (numbered, e.g. "Swim #3")
  if (/^Swim\s*#/i.test(name)) return "swim";

  // Cricket — logged with sport_type "Workout" but "Cricket" in the name, so check by
  // name before the generic Workout fallback below
  if (/cricket/i.test(name)) return "cricket";

  // Sport type fallback
  if (activity.sport_type === "Badminton") return "badminton_casual";
  if (activity.sport_type === "Hike") return "hike";
  if (activity.sport_type === "Walk") return "walk";
  if (activity.sport_type === "Swim") return "swim";
  if (activity.sport_type === "Soccer") return "football";
  if (activity.sport_type === "Workout") return "workout";
  if (activity.sport_type === "Ride" || activity.sport_type === "EBikeRide") return "ride";
  if (activity.sport_type === "Run") return "run";

  // WeightTraining without renamed name — use duration heuristic
  if (activity.sport_type === "WeightTraining") {
    if (activity.elapsed_time < 1800) return "foundation"; // <30 min
    return "weight_training"; // >=30 min
  }

  return "other";
}

export function getCategoryConfig(activity: Activity): CategoryConfig {
  return CATEGORY_CONFIG[getTrainingCategory(activity)];
}

// ─── Legacy Sport Grouping (kept for backward compat) ───────────────────────

const CORE_SPORTS = ["Badminton", "WeightTraining", "Ride", "Run", "Workout", "Swim", "Walk"] as const;

// Some accounts' sync sources log a "Foundation" sport type directly rather than
// "WeightTraining" — treat it as WeightTraining for grouping purposes.
const SPORT_TYPE_ALIASES: Record<string, string> = {
  Foundation: "WeightTraining",
};

export const SPORT_CONFIG: Record<string, { label: string; color: string; cssClass: string }> = {
  Badminton: { label: "BADMINTON", color: "#2d8a4e", cssClass: "sport-bar-badminton" },
  WeightTraining: { label: "WEIGHTS", color: "#3b4a6b", cssClass: "sport-bar-weights" },
  Ride: { label: "RIDE", color: "#c47a20", cssClass: "sport-bar-ride" },
  Run: { label: "RUN", color: "#c44020", cssClass: "sport-bar-run" },
  Workout: { label: "WORKOUT", color: "#6b7280", cssClass: "sport-bar-workout" },
  Swim: { label: "SWIM", color: "#0ea5e9", cssClass: "sport-bar-swim" },
  Walk: { label: "WALK", color: "#a8a29e", cssClass: "sport-bar-walk" },
  Others: { label: "OTHERS", color: "#777", cssClass: "sport-bar-others" },
};

export function getSportGroup(sportType: string): string {
  const resolved = SPORT_TYPE_ALIASES[sportType] ?? sportType;
  return (CORE_SPORTS as readonly string[]).includes(resolved) ? resolved : "Others";
}

export function getSportConfig(sportType: string) {
  const group = getSportGroup(sportType);
  return SPORT_CONFIG[group] || { label: "OTHERS", color: "#777", cssClass: "" };
}

export const DISPLAY_SPORT_TYPES = ["Badminton", "Ride", "WeightTraining", "Run", "Others"] as const;

// ─── Formatting ─────────────────────────────────────────────────────────────

export function formatDuration(seconds: number): string {
  if (!seconds) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatDurationShort(seconds: number): string {
  if (!seconds) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h${m > 0 ? ` ${m}m` : ""}`;
  return `${m}m`;
}

export function formatDistance(meters: number): string {
  if (!meters) return "";
  const km = meters / 1000;
  return km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(meters)} m`;
}

// Strava appends "Z" to start_date_local even though it's local time, not UTC.
// Stripping it makes JS parse as local browser time, which matches the actual activity timezone.
export function parseLocal(dateStr: string): Date {
  return new Date(dateStr.replace(/Z$/, ""));
}

export function formatDate(dateStr: string): string {
  const d = parseLocal(dateStr);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export function formatTime(dateStr: string): string {
  const d = parseLocal(dateStr);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function formatDateFull(dateStr: string): string {
  const d = parseLocal(dateStr);
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function getRelativeDay(dateStr: string): string {
  const activity = parseLocal(dateStr);
  const now = new Date();
  activity.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  const diffDays = Math.round((now.getTime() - activity.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(dateStr);
}

export function computeSleepStreak(completedDates: string[]): number {
  const dateSet = new Set(completedDates);
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  let streak = 0;
  for (let i = 0; i < 60; i++) {
    const key = toLocalDateStr(cursor);
    if (dateSet.has(key)) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else if (i === 0) {
      // Today not logged yet — start counting from yesterday
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

export function formatZoneTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export const HR_ZONE_LABELS = [
  { key: "Zone 1", label: "Z1", range: "<131", color: "#bfdbfe" },
  { key: "Zone 2", label: "Z2", range: "132-145", color: "#22c55e" },
  { key: "Zone 3", label: "Z3", range: "146-158", color: "#eab308" },
  { key: "Zone 4", label: "Z4", range: "159-172", color: "#f97316" },
  { key: "Zone 5", label: "Z5", range: "173+", color: "#ef4444" },
];

// ─── Aggregation ────────────────────────────────────────────────────────────

export function getWeekKey(dateStr: string): string {
  const d = parseLocal(dateStr);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return toLocalDateStr(monday);
}

export function groupByWeek(activities: Activity[]): Map<string, Activity[]> {
  const map = new Map<string, Activity[]>();
  for (const a of activities) {
    const key = getWeekKey(a.start_date_local);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(a);
  }
  return map;
}

export function getMonthKey(dateStr: string): string {
  const d = parseLocal(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function isCurrentMonth(year: number, month: number): boolean {
  const today = new Date();
  return year === today.getFullYear() && month === today.getMonth() + 1;
}

// Days-in-month for past/future months, or days elapsed so far for the current month.
export function daysElapsedInMonth(year: number, month: number): number {
  const totalDays = daysInMonth(year, month);
  return isCurrentMonth(year, month) ? Math.min(new Date().getDate(), totalDays) : totalDays;
}

export function groupByMonth(activities: Activity[]): Map<string, Activity[]> {
  const map = new Map<string, Activity[]>();
  for (const a of activities) {
    const key = getMonthKey(a.start_date_local);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(a);
  }
  return map;
}

export function groupBySport(activities: Activity[]): Map<string, Activity[]> {
  const map = new Map<string, Activity[]>();
  for (const a of activities) {
    const key = a.sport_type;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(a);
  }
  return map;
}

export function totalTime(activities: Activity[]): number {
  return activities.reduce((sum, a) => sum + a.elapsed_time, 0);
}

export function totalCalories(activities: Activity[]): number {
  return activities.reduce((sum, a) => sum + (a.calories || 0), 0);
}

export function avgHr(activities: Activity[]): number | null {
  const withHr = activities.filter((a) => a.average_heartrate);
  if (withHr.length === 0) return null;
  return Math.round(withHr.reduce((sum, a) => sum + a.average_heartrate!, 0) / withHr.length);
}

export function getThisWeekActivities(activities: Activity[]): Activity[] {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.getFullYear(), now.getMonth(), diff);
  monday.setHours(0, 0, 0, 0);
  return activities.filter((a) => parseLocal(a.start_date_local) >= monday);
}

export function getLastWeekActivities(activities: Activity[]): Activity[] {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const thisMonday = new Date(now.getFullYear(), now.getMonth(), diff);
  thisMonday.setHours(0, 0, 0, 0);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(lastMonday.getDate() - 7);
  return activities.filter((a) => {
    const d = parseLocal(a.start_date_local);
    return d >= lastMonday && d < thisMonday;
  });
}

// ─── Win/Loss Parsing ───────────────────────────────────────────────────────

export interface WinLossRecord {
  ranked: { wins: number; losses: number };
  all: { wins: number; losses: number };
}

export function parseWinLoss(description: string | null): WinLossRecord | null {
  if (!description) return null;
  // Ranked W/L from the summary line (e.g., "4W-3L (57%)")
  const summaryMatch = description.match(/(\d+)W[–-](\d+)L/);
  if (!summaryMatch) return null;
  const rankedWins = parseInt(summaryMatch[1]);
  const rankedLosses = parseInt(summaryMatch[2]);

  // All W/L by counting individual game lines ("W ..." or "L ...")
  const lines = description.split("\n");
  let allWins = 0;
  let allLosses = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^W \d+[–-]\d+/.test(trimmed)) allWins++;
    else if (/^L \d+[–-]\d+/.test(trimmed)) allLosses++;
  }

  // Fallback: if no game lines found, use summary
  if (allWins + allLosses === 0) {
    allWins = rankedWins;
    allLosses = rankedLosses;
  }

  return {
    ranked: { wins: rankedWins, losses: rankedLosses },
    all: { wins: allWins, losses: allLosses },
  };
}

// ─── Foundation Streak ──────────────────────────────────────────────────────

export function computeFoundationStreak(
  activities: Activity[],
  excusedMisses: string[] = [],
): number {
  // Get all foundation activity dates
  const foundationDates = new Set<string>();
  for (const a of activities) {
    if (getTrainingCategory(a) === "foundation") {
      foundationDates.add(a.start_date_local.slice(0, 10));
    }
  }

  const excusedSet = new Set(excusedMisses);

  // Walk backward from today counting consecutive days with foundation.
  // Foundation is daily (including weekends).
  // Excused misses don't break the streak (skip them like they didn't happen).
  const now = new Date();
  let streak = 0;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  for (let i = 0; i < 365; i++) {
    const dateStr = toLocalDateStr(d);

    // Today: if no foundation yet, don't break — day isn't over
    if (i === 0 && !foundationDates.has(dateStr)) {
      d.setDate(d.getDate() - 1);
      continue;
    }

    // Excused miss: skip, don't break streak
    if (excusedSet.has(dateStr) && !foundationDates.has(dateStr)) {
      d.setDate(d.getDate() - 1);
      continue;
    }

    if (foundationDates.has(dateStr)) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

// ─── Cold Shower Streak ────────────────────────────────────────────────────

export function computeColdShowerStreak(startDate: string, missedDates: string[]): number {
  const missedSet = new Set(missedDates);
  const now = new Date();
  let streak = 0;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);

  for (let i = 0; i < 365; i++) {
    const dateStr = toLocalDateStr(d);

    // Don't go before the quest start date
    if (d < start) break;

    // Today: assume done unless in missed_dates
    if (missedSet.has(dateStr)) {
      break;
    }

    streak++;
    d.setDate(d.getDate() - 1);
  }

  return streak;
}
