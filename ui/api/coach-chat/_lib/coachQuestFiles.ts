/**
 * Shapes and paths for the four files coach-redesign-part2-ledger.md introduces: seasons.json,
 * quests.json, progress.json, progressions.json. These replace challenge_v2.json (and the old
 * per-season archive snapshots it needed for history) with one append-only progress ledger plus
 * three small definition files. Types only here - the read/write mechanics live in
 * coachChatFiles.ts (reads) and coachIntents.ts (server-owned writes), same split as
 * coachMemoryFiles.ts from Part 1.
 */

export const SEASONS_PATH = "user_data/coach/seasons.json";
export const QUESTS_PATH = "user_data/coach/quests.json";
export const PROGRESS_PATH = "user_data/coach/progress.json";
export const PROGRESSIONS_PATH = "user_data/coach/progressions.json";

export interface Season {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: "active" | "completed" | "retired";
}

export interface SeasonsJson {
  version: 1;
  _meta: { updated_at: string; updated_by: string; trace_id: string };
  current_season_id: string | null;
  // Newest-first (descending start_date) - a new season gets prepended, per the spec doc.
  seasons: Season[];
}

export interface WeeklyTarget {
  target: number;
  // "quest" means this target computes itself from a quest's own completions (quest_id below);
  // omitted means it's manually tracked in the UI, same as today.
  source?: "quest";
  quest_id?: string;
}

export type QuestType = "daily_streak" | "progress" | "count_target" | "weekly_frequency";

export interface MainQuest {
  id: string;
  name: string;
  type: QuestType;
  target: number;
  count_pattern?: string;
}

export interface Quest {
  id: string;
  name: string;
  type: QuestType;
  start_date: string;
  end_date: string | null;
  status: "active" | "graduated" | "retired";
  // daily_streak only.
  polarity?: "default_done" | "default_not_done";
  // progress/count_target/weekly_frequency only.
  target?: number;
  // progress only.
  unit?: string;
  source: "model" | "athlete";
}

export interface QuestsJson {
  version: 1;
  _meta: { updated_at: string; updated_by: string; trace_id: string };
  weekly_targets: Record<string, WeeklyTarget>;
  main_quest: MainQuest;
  quests: Quest[];
}

export interface ProgressRow {
  id: string;
  quest_id: string;
  season_id: string;
  date: string;
  status: "completed" | "missed" | "excused";
  // Only meaningful for progress-type quests (e.g. chapters read).
  value: number | string | null;
  source: "model" | "pipeline" | "athlete";
  ts: string;
  trace_id: string;
}

export interface ProgressJson {
  version: 1;
  rows: ProgressRow[];
}

export interface ProgressionHistoryEntry {
  date: string;
  value: string;
  trace_id: string;
}

export interface Progression {
  id: string;
  name: string;
  current: string;
  target: string;
  unit: string | null;
  history: ProgressionHistoryEntry[];
}

export interface ProgressionsJson {
  version: 1;
  _meta: { updated_at: string; updated_by: string; trace_id: string };
  progressions: Progression[];
}
