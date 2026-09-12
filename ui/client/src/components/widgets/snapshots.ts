import type { ActivityGlyphKind } from "./ActivityGlyph";
import type { AmIImprovingSnapshot } from "@/components/sport-analytics/badmintonLensModel";

export type SportAnalyticsNavLink = {
  glyph: Extract<ActivityGlyphKind, "badminton" | "run" | "calisthenics">;
  href: string;
  title: string;
};

export type WarmSportId =
  | "cycling"
  | "badminton"
  | "calisthenics"
  | "foundation"
  | "run"
  | "other"
  | "strength"
  | "weight_training"
  | "hike"
  | "walk"
  | "cricket"
  | "football"
  | "workout"
  | "swim";

export interface ActivityInspectionSnapshot {
  id: string;
  dateKey: string;
  dateLabel: string;
  title: string;
  sport: WarmSportId;
  ranked: boolean;
  durationMinutes: number;
  calories: number | null;
  averageHeartRate: number | null;
  maxHeartRate: number | null;
  distanceKm: number | null;
  load: number | null;
  source: string;
}

export interface TrendPointSnapshot {
  label: string;
  value: number;
  weekLabel?: string;
}

export interface LoadMixSnapshot {
  id: WarmSportId;
  label: string;
  shortLabel: string;
  hours: number;
  color: string;
}

export interface DoseRowSnapshot {
  day: string;
  title: string;
  detail?: string;
  load: number | null;
  sport: WarmSportId;
  isRest?: boolean;
}

export interface EngineSnapshot {
  weekLabel: string;
  load: number;
  signal: string;
  verdict: string;
  compactVerdict?: string;
  openVerdict?: string;
  bandLow: number | null;
  bandHigh: number | null;
  scaleLow: number;
  scaleHigh: number;
  trend: TrendPointSnapshot[];
  mix: LoadMixSnapshot[];
  totalHours: number;
  method: string;
  doseRows: DoseRowSnapshot[];
}

export interface QuestSideSnapshot {
  id?: string;
  name: string;
  value: number;
  target: number;
  color: string;
  notes?: string;
}

export interface QuestSnapshot {
  name: string;
  completed: number;
  target: number;
  loaded: number;
  daysLeft: number;
  sideQuests: QuestSideSnapshot[];
  streakLabel?: string;
  hasQuest: boolean;
}

export interface CoachReadSnapshot {
  dateLabel: string;
  body: string;
  eyebrow?: string;
  signature?: string;
  actionLabel?: string;
  isPreview?: boolean;
  evidence?: string[];
}

export interface CoachMessageSnapshot {
  id: string;
  created_at: string;
  body: string;
  conversation_seed_id: string;
}

export interface CommitmentSnapshot {
  id: "cycling" | "badminton" | "calisthenics" | "foundation";
  label: string;
  glyph: ActivityGlyphKind;
  value: number;
  target: number | null;
  note: string;
  status: string;
  progress: number | null;
  accent: string;
  alarm?: boolean;
  allRecord?: string;
  rankedRecord?: string;
  hasRankedRecord?: boolean;
  latest?: ActivityInspectionSnapshot;
  latestRanked?: ActivityInspectionSnapshot;
  streak?: number;
}

export interface PlanDaySnapshot {
  key: string;
  day: string;
  dayShort: string;
  glyph: ActivityGlyphKind | null;
  sport: WarmSportId | "recovery";
  title: string;
  loadDelta: number | null;
  isRecorded?: boolean;
  href?: string;
  activities?: ActivityInspectionSnapshot[];
}

export interface WeeklyPlanSnapshot {
  label: string;
  isPreview: boolean;
  title?: string;
  statusLabel?: string;
  bandLow: number | null;
  bandHigh: number | null;
  days: PlanDaySnapshot[];
}

export interface CaloriesSnapshot {
  monthLabel: string;
  current: number;
  target: number | null;
  daysLeft: number;
  daysInMonth: number;
  pacePercent: number;
  dailyActual: number[];
  dailyNeeded: number | null;
  targetIsFixture?: boolean;
  elapsedDays?: number;
  activeDays?: number;
  highestDayLabel?: string;
  highestDayCalories?: number;
}

export type ActivityCellState =
  | "empty"
  | "badminton"
  | "calisthenics"
  | "foundation"
  | "cycling"
  | "run"
  | "strength"
  | "weight_training"
  | "hike"
  | "walk"
  | "cricket"
  | "football"
  | "workout"
  | "swim"
  | "planned-missed";

export interface ActivityMonthSnapshot {
  label: string;
  cells: ActivityCellState[];
  dates?: Array<string | null>;
}

export interface TrainingActivitySnapshot {
  rangeLabel: string;
  months: ActivityMonthSnapshot[];
  longestBlock: number;
  activeDays: number;
  planTruePercent: number | null;
  gapCount: number;
  worstGap: number;
  read: string;
  dayDetails?: Record<
    string,
    {
      dateLabel: string;
      activities: ActivityInspectionSnapshot[];
      durationMinutes: number;
      load: number | null;
    }
  >;
}

export interface Vo2Snapshot {
  status: "available" | "unavailable";
  value: number | null;
  delta: number | null;
  percentileLabel?: string;
  trend: TrendPointSnapshot[];
  read: string;
}

export interface RecentSessionSnapshot {
  id: string;
  dateLabel: string;
  title: string;
  detail: string;
  load: number | null;
  sport: WarmSportId;
  href?: string;
  evidence?: ActivityInspectionSnapshot;
}

export interface PhaseMilestoneSnapshot {
  id?: string;
  name: string;
  baseline: string;
  current?: string;
  target: string;
  note?: string;
  progressPercent?: number | null;
  projectedDateLabel?: string;
}

export interface BuildPhaseSnapshot {
  weekLabel: string;
  title?: string;
  milestones: PhaseMilestoneSnapshot[];
  read: string;
}

export interface WarmHomeSnapshots {
  coachMessage?: CoachMessageSnapshot;
  engine: EngineSnapshot;
  quest: QuestSnapshot;
  coachRead: CoachReadSnapshot;
  commitments: CommitmentSnapshot[];
  plan: WeeklyPlanSnapshot;
  calories: CaloriesSnapshot;
  trainingActivity: TrainingActivitySnapshot;
  vo2: Vo2Snapshot;
  sessions: RecentSessionSnapshot[];
  phase: BuildPhaseSnapshot;
  amIImproving: AmIImprovingSnapshot;
  activityEvidence: ActivityInspectionSnapshot[];
  sync: {
    label: string;
    healthy: boolean;
    status: string;
    timestamp: string | null;
    warnings: string[];
  };
}

export interface WidgetSnapshotsFile {
  schema_version: number;
  generated_at: string;
  home: WarmHomeSnapshots;
  sizes: {
    engine: { S: EngineSnapshotS; M: EngineSnapshot; L: EngineSnapshot };
    quest: { S: QuestSnapshotS; M: QuestSnapshot };
    commitments: { S: CommitmentSnapshot; M: CommitmentSnapshot[] };
  };
}

/** WidgetKit / glance — number + band strip only */
export interface EngineSnapshotS {
  weekLabel: string;
  load: number;
  signal: string;
  compactVerdict: string;
  bandLow: number | null;
  bandHigh: number | null;
}

/** WidgetKit / glance — title + fraction + bar */
export interface QuestSnapshotS {
  name: string;
  completed: number;
  target: number;
  progressPercent: number;
  hasQuest: boolean;
}
