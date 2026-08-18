/**
 * Types only — this file no longer carries sample values. For sample
 * `CurrentWeekContract` data, see `shared/golden-dataset/current_week.json`,
 * read through `@/lib/goldenDataset`'s `GOLDEN_CURRENT_WEEK`.
 */
export type CurrentWeekDataStatus = "placeholder" | "live";
export type WeekStatus = "draft" | "active" | "complete";
export type PlanIntent = "train" | "recovery" | "open" | "rest" | "review";
export type SessionDiscipline =
  | "badminton"
  | "calisthenics"
  | "cycling"
  | "foundation"
  | "recovery"
  | "other"
  | "run"
  | "strength"
  | "weight_training"
  | "hike"
  | "walk"
  | "cricket"
  | "football"
  | "workout"
  | "swim";
export type SessionPriority = "anchor" | "support" | "optional";
export type SessionStatus = "planned" | "completed" | "skipped" | "moved";
export type CoachTone = "steady" | "positive" | "caution";
export type CoachConfidence = "low" | "medium" | "high";

export interface CurrentWeekSession {
  id: string;
  discipline: SessionDiscipline;
  kind: string;
  title: string;
  priority: SessionPriority;
  status: SessionStatus;
  planned_duration_min: number | null;
  planned_load: number | null;
  template_id: string | null;
  session_file: string | null;
  coach_note: string | null;
  completion_activity_ids: string[];
}

export interface CurrentWeekDay {
  date: string;
  day: string;
  intent: PlanIntent;
  coach_note: string | null;
  sessions: CurrentWeekSession[];
}

export interface CoachComment {
  id: string;
  topic: "weekly_load" | "training_intensity" | "weekly_plan";
  headline: string;
  body: string;
  tone: CoachTone;
  priority: number;
  evidence_refs: string[];
  valid_from: string;
  valid_until: string;
}

export interface CurrentWeekContract {
  schema_version: 1;
  data_status: CurrentWeekDataStatus;
  week: {
    id: string;
    start_date: string;
    end_date: string;
    status: WeekStatus;
    focus: string;
    guardrails: string[];
  };
  // tone/confidence/evidence_refs dropped (part3-rollout) - redundant with SOUL's own prose
  // voice, and evidence should be computed from real data rather than self-asserted.
  // valid_from/valid_until kept - a coach_read can start partway through the week after a reset.
  coach_read: {
    headline: string;
    body: string;
    valid_from: string;
    valid_until: string;
  };
  days: CurrentWeekDay[];
  coach_comments: CoachComment[];
  updated_at: string;
  updated_by: string;
  trace_id: string;
}
