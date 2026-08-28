import type { Milestone, MilestoneProgress } from "@/lib/challenge";

const DAY_MS = 24 * 60 * 60 * 1000;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function progressFromRange(baseline: number, current: number, target: number): number | null {
  const span = target - baseline;
  if (span === 0) {
    return current >= target ? 100 : 0;
  }
  return clamp(((current - baseline) / span) * 100, 0, 100);
}

function parseLocalDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`);
}

function toDateStr(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function computeMilestoneProgress(milestone: Milestone): number | null {
  const progress = milestone.progress;
  if (!progress) return null;
  return progressFromRange(progress.baseline_value, progress.current_value, progress.target_value);
}

function extrapolateProjectedDate(progress: MilestoneProgress): string | null {
  const history = progress.history ?? [];
  if (history.length < 2) return null;

  const sorted = [...history].sort((left, right) => left.date.localeCompare(right.date));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const firstValue = first.value;
  const lastValue = last.value;
  const target = progress.target_value;

  if (lastValue >= target) return last.date;

  const elapsedDays =
    (parseLocalDate(last.date).getTime() - parseLocalDate(first.date).getTime()) / DAY_MS;
  if (elapsedDays <= 0) return null;

  const rate = (lastValue - firstValue) / elapsedDays;
  if (rate <= 0) return null;

  const eta = new Date(
    parseLocalDate(last.date).getTime() + ((target - lastValue) / rate) * DAY_MS,
  );
  return toDateStr(eta);
}

export function resolveMilestoneProjectedDate(milestone: Milestone): string | null {
  const progress = milestone.progress;
  if (!progress) return null;
  if (progress.projected_date) return progress.projected_date;
  return extrapolateProjectedDate(progress);
}

export function formatProjectedDateLabel(dateStr: string): string {
  return parseLocalDate(dateStr)
    .toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    .toUpperCase();
}

export function formatProjectedDateShort(dateStr: string): string {
  return parseLocalDate(dateStr)
    .toLocaleDateString("en-GB", { month: "short", day: "numeric" })
    .toUpperCase()
    .replace(" ", " ");
}

/** Sessions/week implied by milestone history span — used for ladder step math. */
export function estimateSessionsPerWeek(progress: MilestoneProgress): number | null {
  const history = progress.history ?? [];
  if (history.length < 2) return null;
  const sorted = [...history].sort((left, right) => left.date.localeCompare(right.date));
  const elapsedDays =
    (parseLocalDate(sorted.at(-1)!.date).getTime() - parseLocalDate(sorted[0].date).getTime()) /
    DAY_MS;
  if (elapsedDays <= 0) return null;
  const sessions = history.length - 1;
  const weeks = elapsedDays / 7;
  if (weeks <= 0) return null;
  return Math.max(0.5, sessions / weeks);
}

export function estimateProgressPerSession(progress: MilestoneProgress): number | null {
  const history = progress.history ?? [];
  if (history.length < 2) return null;
  const sorted = [...history].sort((left, right) => left.date.localeCompare(right.date));
  const delta = sorted.at(-1)!.value - sorted[0].value;
  const sessions = history.length - 1;
  if (sessions <= 0 || delta <= 0) return null;
  return delta / sessions;
}

export interface StepProjection {
  sessions: number;
  date: string | null;
  math: string;
}

/** Project sessions + ETA to reach `targetValue` from `currentValue` using milestone history. */
export function projectStepTarget(
  progress: MilestoneProgress,
  currentValue: number,
  targetValue: number,
): StepProjection | null {
  if (currentValue >= targetValue) {
    return { sessions: 0, date: null, math: "At target" };
  }

  const perSession = estimateProgressPerSession(progress);
  const sessionsPerWeek = estimateSessionsPerWeek(progress);
  if (perSession === null || sessionsPerWeek === null) return null;

  const sessions = Math.ceil((targetValue - currentValue) / perSession);
  const weeks = sessions / sessionsPerWeek;
  const lastDate = [...(progress.history ?? [])]
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1)?.date;
  const date =
    lastDate === undefined
      ? null
      : toDateStr(new Date(parseLocalDate(lastDate).getTime() + weeks * 7 * DAY_MS));

  const math = `+${(targetValue - currentValue).toFixed(1)}${progress.unit} ÷ ${perSession.toFixed(1)}/${progress.unit}/sess ≈ ${sessions} sess @ ${sessionsPerWeek.toFixed(1)}/wk`;

  return { sessions, date, math };
}
