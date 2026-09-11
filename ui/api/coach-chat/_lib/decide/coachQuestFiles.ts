/** Paths and shapes for seasons, quests, progress rows, and progression milestones. */

// Live in ledger/, not coach/ - structured gamification-ledger data. coach/ is narrative/memory-
// band data only (profile/memory/injuries/coach_log/chat_history) - these four don't belong there.
export const SEASONS_PATH = "user_data/ledger/seasons.json";
export const QUESTS_PATH = "user_data/ledger/quests.json";
export const PROGRESS_PATH = "user_data/ledger/progress.json";
export const PROGRESSIONS_PATH = "user_data/ledger/progressions.json";

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
  // The season this goal belongs to (B3) - main_quest now only ever changes together with a
  // season change, so this is the explicit, queryable link, not just something that happens to
  // coincide procedurally.
  season_id: string;
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
  // count_target only (same field MainQuest carries for activity-name matching) - carried over
  // when an outgoing season's goal retires into this array (B3), same "move it, don't destroy
  // it" discipline habit quests already get.
  count_pattern?: string;
  source: "model" | "athlete";
}

export interface QuestsJson {
  version: 1;
  _meta: { updated_at: string; updated_by: string; trace_id: string };
  weekly_targets: Record<string, WeeklyTarget>;
  main_quest: MainQuest | null;
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
