/**
 * Paths and shapes for structured coach profile, memory, injuries, and continuity: profile.json
 * (settings), memory.json (Coach's free-text notes), injuries.json (open/resolved flags),
 * coach_log.json (the merged continuity log - named coach_log.json rather than sessions.json to
 * avoid colliding with the unrelated activities/workout_plans/sessions/*.json workout files).
 * Types only here - the read/write mechanics live in coachChatFiles.ts (reads) and
 * coachProfileIntents.ts/coachInjuryIntents.ts (server-owned writes). state.md/coach_notes.md/rolling_state.json, which these
 * four files replaced, no longer exist.
 */

export const PROFILE_PATH = "user_data/coach/profile.json";
export const MEMORY_PATH = "user_data/coach/memory.json";
export const INJURIES_PATH = "user_data/coach/injuries.json";
export const COACH_LOG_PATH = "user_data/coach/coach_log.json";

export interface ProfileJson {
  version: 1;
  coach_since: string | null;
  name: string;
  dob: string | null;
  timezone: string;
  height_cm: number | null;
  weight_kg: number | null;
  // A3 retry fix (#727): set alongside coach_since on the wasProfileComplete false->true
  // transition (coachSinceStamp.ts), cleared once generateFirstSessionWorkoutsAfterCompletion
  // actually commits a benchmark. Lets that function retry on a later turn after a failed
  // attempt without also firing for an already-established athlete, who never gets this field
  // set in the first place. Optional so every profile.json written before this field existed
  // still parses as "not pending" (undefined is falsy) - no backfill needed.
  first_session_benchmark_pending?: boolean;
  // Review finding (P1, #727 hardening): without a cap, a repeated failure (a real commit error,
  // not just an invariant trip - the fallback spec is structurally safe from those) left
  // first_session_benchmark_pending stuck true forever, so every single future turn from that
  // athlete re-ran the full generation attempt with no backoff. Incremented on each failed
  // attempt in generateFirstSessionWorkoutsAfterCompletion; past FIRST_SESSION_BENCHMARK_MAX_ATTEMPTS
  // the marker is cleared anyway (giving up, not looping) so the athlete gets a working chat
  // experience even without a benchmark rather than a silent retry storm. Optional/undefined reads
  // as 0 attempts so far - same backfill-free discipline as the field above.
  first_session_benchmark_attempts?: number;
}

// The six memory_update labels - fixed set, per gemini-flow.md's "constrained values over free
// text" rule. `equipment` moved here from profile.json.
export const MEMORY_NOTE_LABELS = [
  "fitness_baseline",
  "coaching_priorities",
  "learned_patterns.training",
  "learned_patterns.nutrition",
  "learned_patterns.mental",
  "equipment",
] as const;

export type MemoryNoteLabel = (typeof MEMORY_NOTE_LABELS)[number];

export interface MemoryNote {
  text: string;
  updated_at: string;
  trace_id: string;
}

// coaching_style: constrained enum, not free text (gemini-flow.md's Action-field design rule).
// Values match B_engine.md's real First Session Protocol intake question verbatim ("What works
// when things get hard: someone holding you accountable, someone cheering you on, or someone
// walking through the why?"). Set during First Session Protocol, changeable later via chat
// (coaching_style_update) - no write-once guard, it's just naturally infrequent in practice.
export const COACHING_STYLES = ["accountability", "encouragement", "analysis"] as const;
export type CoachingStyle = (typeof COACHING_STYLES)[number];

// A3 (#727): structured training availability, the one new memory.json field this PR adds. Intake
// already asks "how many days a week and which days do you train" as a natural question - the
// answer used to land only as prose inside fitness_baseline/coaching_priorities. This field is
// derived from that same prose deterministically (inferTrainingAvailability in
// coachFirstSessionBenchmark.ts, same keyword-parsing spirit the deleted template-selection
// helpers used) at the profile-complete transition, so the first-week compiler has something to read
// besides free text. Not written directly by Gemini - there's no schema field for it, since this
// PR's file column doesn't touch ui/api/coach-chat/_lib/gemini/. `days_per_week: 0` is a real,
// legal answer (an athlete who trains zero days a week still gets a valid week); `null` means
// nothing parseable was ever said.
export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface TrainingAvailability {
  days_per_week: number;
  preferred_days: Weekday[];
}

export interface MemoryJson {
  version: 1;
  _meta: { updated_at: string; updated_by: string; trace_id: string };
  sports: string[];
  coaching_style: CoachingStyle | null;
  training_availability: TrainingAvailability | null;
  notes: Record<MemoryNoteLabel, MemoryNote>;
}

export interface InjuryFlag {
  id: string;
  text: string;
  status: "active" | "resolved";
  opened_at: string;
  resolved_at: string | null;
}

export interface InjuriesJson {
  flags: InjuryFlag[];
}

export interface CoachLogRow {
  id: string;
  date: string;
  ts: string;
  type: "chat";
  text: string;
  trace_id: string;
}

export interface CoachLogJson {
  version: 1;
  rows: CoachLogRow[];
}
