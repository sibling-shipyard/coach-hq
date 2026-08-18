/**
 * Athlete OS — Workout data types and utilities
 * Types for workout templates, sessions, and timer logic.
 */
import { toLocalDateStr } from "@/lib/challenge";

export type WorkoutType = "foundation" | "strength" | "recovery" | "realign" | "calisthenics";
export type ExerciseType = "timed" | "reps";

export interface Exercise {
  num: number;
  name: string;
  type: ExerciseType;
  duration_secs?: number;
  reps?: number;
  sets: number;
  rest_between_sets_secs?: number;
  rest_after_exercise_secs?: number; // Rest after ALL sets, before next exercise
  prep_secs?: number;                // "Get Ready" countdown before timed exercises
  optional?: boolean;                // If true, UI offers guilt-free skip
  both_sides?: boolean;              // If true, timer runs duration_secs twice per set (LEFT then RIGHT). Ignored for type: "reps".
  form_cue: string;
  why: string;
}

export interface Phase {
  name: string;
  duration: string;
  default_rest_secs: number;
  transition_rest_secs?: number; // Rest before this phase begins (equipment change, mental reset)
  optional?: boolean;            // If true, entire phase can be skipped
  coaching_note?: string;        // Phase-level coaching note
  exercises: Exercise[];
  circuit?: boolean;  // default false — when true, loop all exercises per round
  rounds?: number;    // default 1 — number of circuit rounds
}

export interface Workout {
  id: string;
  title: string;
  subtitle: string;
  session_date?: string;
  based_on_template?: string;
  workout_type: WorkoutType;
  estimated_duration_mins: number;
  location: string;
  equipment: string[];
  coaching_note: string;
  phases: Phase[];
  shoulder_modification?: {
    note: string;
    affected_exercises: number[];
  };
  progression_notes?: string;
  // Optional, forward-compatible (part3-rollout): Coach writes templates/sessions directly via
  // git commit (platform/soul/B_engine.md's Persisting Session Files ritual), not through
  // coach-chat.ts, so nothing in this codebase stamps it yet - never crash on a file that lacks
  // it. Matches the {updated_at, updated_by, trace_id} shape coach-chat's own files use.
  _meta?: { updated_at: string; updated_by: string; trace_id: string };
}

export interface WorkoutsData {
  templates: Workout[];
  sessions: Workout[];
}

// ─── Workout Type Config ───────────────────────────────────────────────────

export const WORKOUT_TYPE_CONFIG: Record<WorkoutType, { label: string; color: string; icon: string }> = {
  calisthenics: { label: "CALISTHENICS", color: "#f59e0b", icon: "🤸" },
  foundation:   { label: "FOUNDATION",   color: "#60a5fa", icon: "⚡" },
  strength:     { label: "STRENGTH",     color: "#111111", icon: "💪" },
  recovery:     { label: "RECOVERY",     color: "#2dd4bf", icon: "🧘" },
  realign:      { label: "REALIGN",      color: "#a78bfa", icon: "🔧" },
};

// ─── Utilities ─────────────────────────────────────────────────────────────

/**
 * Get the best workout to run for a given template ID.
 * Checks for a session matching today's date first, falls back to template.
 */
export function getWorkoutForToday(
  templateId: string,
  templates: Workout[],
  sessions: Workout[],
): Workout | null {
  const today = toLocalDateStr(new Date());

  // Check for today's session first
  const session = sessions.find(
    (s) => s.id === templateId && s.session_date === today,
  );
  if (session) return session;

  // Fall back to template
  return templates.find((t) => t.id === templateId) ?? null;
}

/**
 * Get the most recent session for a template, regardless of date.
 * Sorts matching sessions by session_date descending to guarantee "latest".
 */
export function getLatestSession(
  templateId: string,
  sessions: Workout[],
): Workout | null {
  const matching = sessions
    .filter((s) => s.id === templateId && s.session_date)
    .sort((a, b) => (b.session_date ?? "").localeCompare(a.session_date ?? ""));
  return matching[0] ?? null;
}

/**
 * Count total exercises across all phases.
 */
export function countExercises(workout: Workout): number {
  return workout.phases.reduce((sum, p) => sum + p.exercises.length, 0);
}

/**
 * Count total sets across all phases.
 */
export function countSets(workout: Workout): number {
  return workout.phases.reduce(
    (sum, p) => {
      const exerciseSets = p.exercises.reduce((s, e) => s + e.sets, 0);
      // In circuit mode, total sets = sum(exercise.sets) × rounds
      return sum + (p.circuit ? exerciseSets * (p.rounds ?? 1) : exerciseSets);
    },
    0,
  );
}

/**
 * Format seconds as mm:ss for timer display.
 */
export function formatTimer(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}
