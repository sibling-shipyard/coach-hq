/**
 * Canonical types for challenge_v2.json.
 * Single source of truth — all components import from here.
 */

export interface ChallengeMetadata {
  name: string;
  start_date: string;
  // Optional - not every repo's build pipeline derives this (it's computable from
  // start_date/end_date when absent). See sibling-shipyard/coach-phelps-hq's
  // reconciliation of Akash's season/phase model, which has no single fixed duration.
  duration_days?: number;
  end_date: string;
}

export interface MainQuest {
  id: string;
  name: string;
  type: string;
  // Optional - some coaching models (e.g. a weekly-session-floor system) have no single
  // count-target concept. Components must guard on presence rather than assume it's set.
  target?: number;
  count_from?: string;
  count_pattern?: string;
  unit_label?: string;
  event_date?: string;
  notes?: string;
  // Optional - Akash's "Build Phase" coaching model (season/phase/block progression) uses a
  // weekly-session-floor main quest instead of a single count target. See the Warm Instrument
  // UI migration (sibling-shipyard/coach-phelps-hq) for the components that read these.
  weekly_floor?: number;
  loaded_floor?: number;
  skill_weight?: number;
  skill_cap?: number;
  sessions?: QuestSession[];
}

export interface Season {
  name: string;
  start_date: string;
  end_date: string;
}

export interface Block {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  note?: string;
}

export interface Phase {
  name: string;
  start_date: string;
  current_block: Block;
}

export interface QuestSession {
  date: string;
  label: string;
  kind: "loaded" | "skill";
  weight: number;
}

/**
 * Structured progression for a milestone that reduces to a single scalar
 * (e.g. handstand hold seconds). Optional — bilateral or set×rep milestones
 * that don't reduce cleanly omit this and render terse strings only.
 * `projected_date` is computed by the pipeline (Bob), not the UI.
 */
export interface MilestoneProgress {
  unit: string;
  baseline_value: number;
  current_value: number;
  target_value: number;
  history?: { date: string; value: number }[];
  projected_date?: string;
}

export interface Milestone {
  id: string;
  name: string;
  baseline: number | string | null;
  current: number | string | null;
  target: string;
  note?: string;
  // Terse display fields for the dashboard rows. Prose name/current/target stay
  // canonical (quest log + coach read them); these are optional UI overrides.
  short_name?: string;
  short_current?: string;
  short_target?: string;
  progress?: MilestoneProgress;
}

export interface GraduatedQuest {
  id: string;
  name: string;
  type: "daily_streak" | "progress";
  graduated_on: string;
  polarity?: "default_done" | "default_not_done";
  missed_dates?: string[];
  excused_dates?: string[];
  notes?: string;
}

export interface Quest {
  id: string;
  name: string;
  type: "daily_streak" | "progress";
  category: string;
  start_date: string;
  end_date?: string;
  status: string;
  polarity?: "default_done" | "default_not_done";
  tracking: string;
  missed_dates?: string[];
  excused_dates?: string[];
  completed_dates?: string[];
  current?: number;
  target?: number;
  unit?: string;
  notes?: string;
}

export interface WeeklyTargets {
  calisthenics: number;
  badminton: number;
  swim: number;
  run: number;
}

export interface ChallengeV2 {
  version: number;
  // ADR 0018: durable day-number anchor - "days since this athlete started using Coach at all,"
  // set once (server-side, on First Session Protocol completion) and never reset by a new
  // season/challenge. Absent until that first stamp; see coachChatModel.ts's challengeDayNumber
  // for the fallback chain.
  coach_since?: string;
  // Optional - some repos' coaching model has no single "the challenge" concept
  // (e.g. a season/phase/block progression instead). Components must guard on its
  // presence rather than assume it's always there.
  challenge?: ChallengeMetadata;
  // Optional - not every coaching model uses a weekly-quota system.
  weekly_targets?: WeeklyTargets;
  main_quest: MainQuest;
  quests: Quest[];
  // Optional - Akash's "Build Phase" coaching model (season/phase/block progression) instead
  // of a single fixed-duration challenge. Components must guard on presence.
  season?: Season;
  phase?: Phase;
  milestones?: Milestone[];
  graduated?: GraduatedQuest[];
}

/** Format a Date as YYYY-MM-DD in local time (avoids UTC drift from toISOString). */
export function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
