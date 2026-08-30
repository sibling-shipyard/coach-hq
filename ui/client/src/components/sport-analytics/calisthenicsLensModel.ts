/**
 * calisthenicsLensModel.ts — Skill LENS data for calisthenics analytics.
 * Figures come from logged Calisthenics activities + challenge milestones only.
 */
import { type Activity, getTrainingCategory, parseLocal } from "@/lib/activities";
import type { SplitLedger } from "@/lib/challenge";
import { formatProjectedDateShort } from "@/lib/milestoneProgress";

const FIFTY_TWO_WEEKS_MS = 52 * 7 * 24 * 60 * 60 * 1000;
const TWELVE_WEEKS = 12;

const CALISTHENICS_BENCHMARK_IDS = new Set([
  "weighted_pullups",
  "fl_single_leg",
  "handstand_free",
  "bar_dips",
]);

/** Ladder structure matches Sport Analytics.dc.html §1b — metrics/projections from milestones only. */
const SKILL_LADDERS: Array<{
  id: string;
  name: string;
  fallbackMetric: string;
  displayNote: string;
  milestoneId?: string;
  currentStepId?: string;
  steps: Array<{ id: string; label: string; targetValue?: number; muted?: boolean }>;
}> = [
  {
    id: "front_lever",
    name: "Front lever",
    fallbackMetric: "HOLD · LIMITING SIDE",
    displayNote: "Primary skill this block — Guruji protocol.",
    milestoneId: "fl_single_leg",
    currentStepId: "single_leg",
    steps: [
      { id: "tuck", label: "TUCK" },
      { id: "adv_tuck", label: "ADV TUCK" },
      { id: "single_leg", label: "SINGLE LEG", targetValue: 15 },
      { id: "straddle", label: "STRADDLE", targetValue: 10 },
      { id: "full", label: "FULL", targetValue: 5, muted: true },
    ],
  },
  {
    id: "press_handstand",
    name: "Press handstand",
    fallbackMetric: "CAP 1.0 SKILL SESS/WK",
    displayNote: "Bottleneck: compression, not balance.",
    steps: [
      { id: "pike", label: "PIKE COMP." },
      { id: "straddle_up", label: "STRADDLE UP" },
      { id: "negatives", label: "NEGATIVES" },
      { id: "full_press", label: "FULL PRESS", muted: true },
    ],
  },
  {
    id: "handstand",
    name: "Freestanding handstand",
    fallbackMetric: "FREE HOLD",
    displayNote: "Maintained in Workout A — not chased.",
    milestoneId: "handstand_free",
    currentStepId: "free_hold",
    steps: [
      { id: "wall", label: "WALL" },
      { id: "peel_off", label: "PEEL-OFF" },
      { id: "free_hold", label: "30s FREE", targetValue: 15 },
      { id: "sixty", label: "60s FREE", targetValue: 60, muted: true },
    ],
  },
];

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function weekStartKey(dateStr: string): string {
  const date = new Date(`${dateStr}T12:00:00`);
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + mondayOffset);
  return localDateKey(date);
}

function shiftWeekKey(weekKey: string, weeks: number): string {
  const date = new Date(`${weekKey}T12:00:00`);
  date.setDate(date.getDate() + weeks * 7);
  return localDateKey(date);
}

function calendarWeekKeysEndingAt(endWeekKey: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => shiftWeekKey(endWeekKey, index - (count - 1)));
}

function calculateWeeklyStreaks(sessionDateKeys: string[]): { current: number; longest: number } {
  const weekKeys = Array.from(new Set(sessionDateKeys.map(weekStartKey))).sort();
  if (weekKeys.length === 0) return { current: 0, longest: 0 };

  let longest = 1;
  let run = 1;
  for (let index = 1; index < weekKeys.length; index += 1) {
    if (shiftWeekKey(weekKeys[index - 1], 1) === weekKeys[index]) {
      run += 1;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
  }

  const activeWeeks = new Set(weekKeys);
  let current = 0;
  let cursor = weekStartKey(localDateKey(new Date()));
  while (activeWeeks.has(cursor)) {
    current += 1;
    cursor = shiftWeekKey(cursor, -1);
  }

  return { current, longest };
}

function findMilestone(ledger: SplitLedger, id: string): any | undefined {
  return ledger.progressions?.progressions?.find((progression: any) => progression.id === id);
}

function formatBlockMeta(ledger: SplitLedger): string {
  const currentSeason = ledger.seasons?.seasons?.find(
    (s: any) => s.id === ledger.seasons.current_season_id,
  );
  if (!currentSeason) {
    return "CURRENT BLOCK";
  }
  const start = new Date(`${currentSeason.start_date}T00:00:00`);
  const end = new Date(`${currentSeason.end_date}T00:00:00`);
  const totalDays = Math.max(
    1,
    Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1,
  );
  const currentDay = Math.min(
    totalDays,
    Math.max(1, Math.ceil((Date.now() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1),
  );
  return `${currentSeason.name.toUpperCase()} · DAY ${currentDay}/${totalDays}`;
}

// ─── Header ─────────────────────────────────────────────────────────────────

export interface CalisthenicsHeaderStats {
  totalSessions: number;
  metaLine: string;
  blockMeta: string;
}

function buildHeaderStats(activities: Activity[], ledger: SplitLedger): CalisthenicsHeaderStats {
  const sessions = activities.filter((a) => getTrainingCategory(a) === "calisthenics");
  return {
    totalSessions: sessions.length,
    metaLine: `${sessions.length} sessions`,
    blockMeta: formatBlockMeta(ledger),
  };
}

// ─── Skill tracks ───────────────────────────────────────────────────────────

export type SkillStepState = "done" | "current" | "future";

export interface SkillTrackStep {
  id: string;
  label: string;
  sub: string;
  state: SkillStepState;
  muted: boolean;
  projection: {
    sessions: number | null;
    dateLabel: string | null;
    math: string | null;
  } | null;
}

export interface SkillTrackRow {
  id: string;
  name: string;
  metric: string;
  note: string | null;
  mobileCaption: string | null;
  currentReadout: string | null;
  projLabel: string | null;
  projSub: string | null;
  steps: SkillTrackStep[];
  available: boolean;
}

export interface SkillTracksSnapshot {
  available: boolean;
  tracks: SkillTrackRow[];
}

function buildMobileCaption(steps: SkillTrackStep[]): string | null {
  const current = steps.find((step) => step.state === "current");
  const nextFuture = steps.find(
    (step) => step.state === "future" && (step.sub || step.projection?.sessions),
  );
  const parts: string[] = [];

  if (current) {
    const nowValue = current.sub.replace(/^NOW · /, "");
    parts.push(nowValue ? `NOW ${current.label} · ${nowValue}` : `NOW ${current.label}`);
  }

  if (nextFuture?.sub) {
    parts.push(`${nextFuture.label} ${nextFuture.sub}`.replace(/SESSIONS\b/g, "SESS"));
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

function buildSkillTrackRow(
  ladder: (typeof SKILL_LADDERS)[number],
  ledger: SplitLedger,
): SkillTrackRow {
  const milestone = ladder.milestoneId ? findMilestone(ledger, ladder.milestoneId) : undefined;
  const hasMilestone = Boolean(milestone);
  const currentStepIndex =
    hasMilestone && ladder.currentStepId
      ? ladder.steps.findIndex((step) => step.id === ladder.currentStepId)
      : -1;

  const steps: SkillTrackStep[] = [];

  for (let index = 0; index < ladder.steps.length; index += 1) {
    const step = ladder.steps[index];
    let state: SkillStepState = "future";
    if (currentStepIndex >= 0) {
      if (index < currentStepIndex) state = "done";
      else if (index === currentStepIndex) state = "current";
    }

    let sub = "";
    if (state === "current" && milestone) {
      const unitStr = milestone.unit ?? "";
      sub = `NOW · ${milestone.current}${unitStr}`;
    } else if (state === "future" && step.muted) {
      sub = "—";
    }

    steps.push({
      id: step.id,
      label: step.label,
      sub,
      state,
      muted: step.muted ?? false,
      projection: null,
    });
  }

  let projLabel: string | null = null;
  let projSub: string | null = null;
  const note = ladder.displayNote;

  if (ladder.id === "press_handstand") {
    projSub = "COMPRESSION-GATED";
  }

  let metric = ladder.fallbackMetric;
  if (ladder.id === "press_handstand" && ledger.quests?.main_quest?.skill_cap !== undefined) {
    metric = `CAP ${ledger.quests.main_quest.skill_cap} SKILL SESS/WK`;
  } else if (milestone) {
    const unitStr = milestone.unit ?? "";
    metric =
      ladder.id === "front_lever"
        ? `BEST SL HOLD ${milestone.current}${unitStr}`
        : `BEST ${milestone.current}${unitStr}`;
  }

  return {
    id: ladder.id,
    name: ladder.name,
    metric,
    note,
    mobileCaption: buildMobileCaption(steps),
    currentReadout: null,
    projLabel,
    projSub,
    steps,
    available: true,
  };
}

function buildSkillTracks(ledger: SplitLedger): SkillTracksSnapshot {
  return {
    available: true,
    tracks: SKILL_LADDERS.map((ladder) => buildSkillTrackRow(ladder, ledger)),
  };
}

// ─── Am I improving ─────────────────────────────────────────────────────────

export interface CalisthenicsBenchmarkRow {
  name: string;
  startLabel: string;
  nowLabel: string;
  targetLabel: string;
  progressPercent: number | null;
  improving: boolean | null;
}

export interface CalisthenicsImprovingSnapshot {
  available: boolean;
  rows: CalisthenicsBenchmarkRow[];
  coachLine: string | null;
}

function buildImproving(ledger: SplitLedger): CalisthenicsImprovingSnapshot {
  const rows: CalisthenicsBenchmarkRow[] = [];

  for (const progression of ledger.progressions?.progressions ?? []) {
    if (!CALISTHENICS_BENCHMARK_IDS.has(progression.id)) continue;
    const unitStr = progression.unit ?? "";
    rows.push({
      name: progression.name,
      startLabel: "—", // baseline_value dropped in split ledger
      nowLabel: `${progression.current}${unitStr}`,
      targetLabel: `${progression.target}${unitStr}`,
      progressPercent: null, // dropped in split ledger
      improving: null,
    });
  }

  if (rows.length === 0) return { available: false, rows: [], coachLine: null };

  const coachLine = "The long-run truths we agreed on day one — everything else is noise. — Coach";

  return { available: true, rows, coachLine };
}

// ─── Tested e1RM ────────────────────────────────────────────────────────────

export interface E1rmTestPoint {
  date: string;
  dateLabel: string;
  e1rmKg: number;
  note: string;
  isPr: boolean;
}

export interface TestedE1rmSnapshot {
  available: boolean;
  currentKg: number | null;
  blockDeltaKg: number | null;
  prDateLabel: string | null;
  points: E1rmTestPoint[];
  hoverNote: string | null;
}

function buildTestedE1rm(_activities: Activity[], ledger: SplitLedger): TestedE1rmSnapshot {
  const progression = findMilestone(ledger, "weighted_pullups");
  if (!progression?.history?.length) {
    return {
      available: false,
      currentKg: null,
      blockDeltaKg: null,
      prDateLabel: null,
      points: [],
      hoverNote: null,
    };
  }

  const points: E1rmTestPoint[] = progression.history.map((point: any) => ({
    date: point.date,
    dateLabel: formatProjectedDateShort(point.date),
    e1rmKg: Number(point.value),
    note: `${point.value}${progression.unit ?? ""} logged`,
    isPr: false,
  }));

  let best = points[0];
  for (const point of points) {
    if (point.e1rmKg > best.e1rmKg) best = point;
  }
  best.isPr = true;

  const blockDelta = null; // baseline_value dropped in split ledger

  return {
    available: points.length > 0,
    currentKg: Number(progression.current),
    blockDeltaKg: blockDelta,
    prDateLabel: best.isPr ? best.dateLabel : null,
    points,
    hoverNote: null,
  };
}

// ─── Consistency ────────────────────────────────────────────────────────────

export interface ConsistencyWeekCell {
  weekKey: string;
  hitFloor: boolean;
  sessionCount: number;
}

export interface ConsistencySnapshot {
  available: boolean;
  streakWeeks: number;
  floorMetCount: number;
  weeks: ConsistencyWeekCell[];
  coachLine: string | null;
}

function buildConsistency(activities: Activity[], now: number): ConsistencySnapshot {
  const calSessions = activities.filter((a) => getTrainingCategory(a) === "calisthenics");
  if (calSessions.length === 0) {
    return {
      available: false,
      streakWeeks: 0,
      floorMetCount: 0,
      weeks: [],
      coachLine: null,
    };
  }

  const currentWeekKey = weekStartKey(localDateKey(new Date(now)));
  const weekKeys = calendarWeekKeysEndingAt(currentWeekKey, TWELVE_WEEKS);
  const byWeek = new Map<string, number>();

  for (const activity of calSessions) {
    const key = weekStartKey(activity.start_date_local.slice(0, 10));
    byWeek.set(key, (byWeek.get(key) ?? 0) + 1);
  }

  const floor = 1;
  const weeks = weekKeys.map((weekKey) => {
    const sessionCount = byWeek.get(weekKey) ?? 0;
    return { weekKey, hitFloor: sessionCount >= floor, sessionCount };
  });

  const floorMetCount = weeks.filter((week) => week.hitFloor).length;
  const streakDateKeys = calSessions.map((a) => a.start_date_local.slice(0, 10));
  const streakWeeks = calculateWeeklyStreaks(streakDateKeys).current;

  const coachLine =
    floorMetCount >= 8
      ? `Consistency is the whole game here — floor met ${floorMetCount} of the last ${TWELVE_WEEKS} weeks. Skills grow on repetition, not intensity. — Coach`
      : null;

  return {
    available: true,
    streakWeeks,
    floorMetCount,
    weeks,
    coachLine,
  };
}

// ─── Coach read ─────────────────────────────────────────────────────────────

export interface CalisthenicsCoachReadSnapshot {
  available: boolean;
  text: string;
}

function buildCoachRead(
  improving: CalisthenicsImprovingSnapshot,
  consistency: ConsistencySnapshot,
  ledger: SplitLedger,
): CalisthenicsCoachReadSnapshot {
  const reads: string[] = [];

  const fl = findMilestone(ledger, "fl_single_leg");
  if (fl?.history && fl.history.length >= 2) {
    reads.push(`Front lever is tracking toward ${fl.target}.`);
  }

  const hs = findMilestone(ledger, "handstand_free");
  if (hs?.history?.length && hs.current === hs.history[0]?.value) {
    reads.push(
      "Freestanding balance hasn't moved yet — compression and wrist prep stay the priority before chasing longer holds.",
    );
  }

  if (consistency.available && consistency.streakWeeks >= 4) {
    reads.push(
      `${consistency.streakWeeks}-week calisthenics streak — the repetition is doing the work.`,
    );
  }

  if (reads.length === 0 && improving.available) {
    const top = improving.rows.find((row) => row.improving === true);
    if (top) reads.push(`${top.name} is ahead of baseline — keep the protocol honest.`);
  }

  if (reads.length === 0) return { available: false, text: "" };
  return { available: true, text: `${reads[0]} — Coach` };
}

// ─── Activity heatmap (spine) ───────────────────────────────────────────────

export type CalisthenicsHeatmapCell = "empty" | "calisthenics";

export interface CalisthenicsActivityHeatmapSnapshot {
  rangeLabel: string;
  months: Array<{
    label: string;
    cells: CalisthenicsHeatmapCell[];
    dates: Array<string | null>;
  }>;
  sessionCount52w: number;
  currentWeeklyStreak: number;
  longestWeeklyStreak: number;
}

export function buildCalisthenicsActivityHeatmap(
  activities: Activity[],
  now: number = Date.now(),
): CalisthenicsActivityHeatmapSnapshot {
  const end = new Date(now);
  const start = new Date(end.getFullYear(), end.getMonth() - 11, 1);
  const cutoff52 = now - FIFTY_TWO_WEEKS_MS;
  const byDate = new Set<string>();
  const streakDateKeys: string[] = [];
  let sessionCount52w = 0;

  for (const activity of activities) {
    if (getTrainingCategory(activity) !== "calisthenics") continue;
    const date = parseLocal(activity.start_date_local);
    const timestamp = date.getTime();
    const key = localDateKey(date);
    streakDateKeys.push(key);
    if (timestamp >= cutoff52 && timestamp <= now) sessionCount52w += 1;
    if (date < start || date > end) continue;
    byDate.add(key);
  }

  const months = Array.from({ length: 12 }, (_, index) => {
    const monthDate = new Date(start.getFullYear(), start.getMonth() + index, 1);
    const dates = Array.from({ length: 28 }, (_, dayIndex) => {
      const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), dayIndex + 1);
      return date.getMonth() === monthDate.getMonth() && date <= end ? localDateKey(date) : null;
    });
    const cells = dates.map((dateKey) =>
      dateKey && byDate.has(dateKey) ? "calisthenics" : "empty",
    );
    return {
      label: monthDate.toLocaleDateString("en-GB", { month: "short" }).toUpperCase(),
      cells,
      dates,
    };
  });

  const streaks = calculateWeeklyStreaks(streakDateKeys);
  const visibleMonths = months.slice(-3);

  return {
    rangeLabel: `${visibleMonths[0]?.label ?? ""}–${visibleMonths.at(-1)?.label ?? ""}`,
    months,
    sessionCount52w,
    currentWeeklyStreak: streaks.current,
    longestWeeklyStreak: streaks.longest,
  };
}

// ─── Assembled snapshot ─────────────────────────────────────────────────────

export interface CalisthenicsLensSnapshot {
  header: CalisthenicsHeaderStats;
  skillTracks: SkillTracksSnapshot;
  improving: CalisthenicsImprovingSnapshot;
  testedE1rm: TestedE1rmSnapshot;
  consistency: ConsistencySnapshot;
  coachRead: CalisthenicsCoachReadSnapshot;
}

export function buildCalisthenicsLensModel(
  activities: Activity[],
  ledger: SplitLedger,
  now: number = Date.now(),
): CalisthenicsLensSnapshot {
  const skillTracks = buildSkillTracks(ledger);
  const improving = buildImproving(ledger);
  const testedE1rm = buildTestedE1rm(activities, ledger);
  const consistency = buildConsistency(activities, now);
  const coachRead = buildCoachRead(improving, consistency, ledger);

  return {
    header: buildHeaderStats(activities, ledger),
    skillTracks,
    improving,
    testedE1rm,
    consistency,
    coachRead,
  };
}
