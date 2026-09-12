/**
 * A3 (#727): the first-week compile step. Runs in the same profile-complete transition as the
 * benchmark (coachFirstSessionBenchmark.ts), placing the benchmark and other sport-appropriate
 * anchor sessions onto the athlete's stated training days - never a premade session, and never
 * Gemini-authored (this is code, deterministic, same "server owns bookkeeping" split as every
 * other applier in this pipeline). Builds a WeekUpdate and hands it to applyWeekUpdate
 * (coachWeekFiles.ts) exactly the way a real week_update kickoff would - reusing that machinery
 * rather than reinventing current_week.json's bookkeeping (week id, session ids, coach_read
 * bounds) a second time.
 *
 * An athlete who stated zero (or no) training days still gets a real seven-day week back -
 * every day present, no sessions on any of them, not an error - since applyFullWeekKickoff only
 * ever requires exactly seven consecutive days from a Monday plus a non-empty headline/body, both
 * of which this always supplies.
 */
import type { WeekUpdate, WeekUpdateDay, WeekUpdateSessionPatch } from "./coachWeekFiles.js";
import type { TrainingAvailability, Weekday } from "./coachMemoryFiles.js";
import { WEEKDAYS } from "./coachMemoryFiles.js";

function isRealDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Monday of the ISO week containing `dateString` - the same "week starts Monday" contract
// applyFullWeekKickoff enforces. A first-week compile that runs mid-week still plans the whole
// week it's already in, not the next one; days already in the past just carry no sessions.
export function mondayOfWeekContaining(dateString: string): string {
  if (!isRealDateString(dateString)) {
    throw new Error(`firstWeekCompile: "${dateString}" is not a real YYYY-MM-DD date`);
  }
  const date = new Date(`${dateString}T00:00:00Z`);
  const isoDay = date.getUTCDay() || 7; // Mon=1..Sun=7
  return addDays(dateString, -(isoDay - 1));
}

// Nothing ever parsed (inferTrainingAvailability returned null): a reasonable, always-available
// default rather than a blank week - three days, spread through the week, no equipment or
// schedule assumptions baked in. Judgment call, documented per this pipeline's convention for a
// "never throw, degrade to something sane" default (same spirit as the deleted template
// selector's old general_fitness fallback).
const DEFAULT_AVAILABILITY: TrainingAvailability = {
  days_per_week: 3,
  preferred_days: [],
};

// Evenly spaces `count` picks across the 7-day week (Monday-first) when the athlete named a
// count but no specific days - e.g. 3 -> monday/thursday/saturday-ish spacing, not three days
// bunched at the start of the week.
function evenlySpacedDays(count: number): Weekday[] {
  if (count <= 0) return [];
  const picks = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    picks.add(Math.floor((i * 7) / count));
  }
  return [...picks].sort((a, b) => a - b).map((i) => WEEKDAYS[i]);
}

// Resolves which weekdays actually get a session: preferred_days wins when the athlete named
// real days (capped at days_per_week, in week order); otherwise falls back to an even spread.
function resolveTrainingDays(availability: TrainingAvailability): Weekday[] {
  if (availability.days_per_week <= 0) return [];
  if (availability.preferred_days.length > 0) {
    const ordered = WEEKDAYS.filter((d) => availability.preferred_days.includes(d));
    return ordered.slice(0, availability.days_per_week);
  }
  return evenlySpacedDays(availability.days_per_week);
}

// Coarse discipline guess from the athlete's recorded sports, matched against current-week's own
// closed enum (SESSION_DISCIPLINES) - week_update's own coerceDiscipline in coachWeekFiles.ts
// applies the same near-miss/"other" fallback downstream, so an unmatched sport still lands
// safely rather than throwing.
const KNOWN_DISCIPLINES = new Set([
  "badminton",
  "calisthenics",
  "cycling",
  "foundation",
  "recovery",
  "run",
  "strength",
  "weight_training",
  "hike",
  "walk",
  "cricket",
  "football",
  "workout",
  "swim",
]);

export function primaryDiscipline(sports: string[]): string {
  for (const sport of sports) {
    const normalized = sport.trim().toLowerCase();
    if (KNOWN_DISCIPLINES.has(normalized)) return normalized;
  }
  return "strength";
}

export interface FirstWeekCompileParams {
  today: string;
  availability: TrainingAvailability | null;
  benchmarkRoutineId: string;
  benchmarkTitle: string;
  sports: string[];
}

export function compileFirstWeek(params: FirstWeekCompileParams): WeekUpdate {
  const { today, benchmarkRoutineId, benchmarkTitle, sports } = params;
  const availability = params.availability ?? DEFAULT_AVAILABILITY;
  const trainingDays = resolveTrainingDays(availability);
  const discipline = primaryDiscipline(sports);
  const startDate = mondayOfWeekContaining(today);

  // The benchmark (and every anchor session) only ever lands on today or a later day this week.
  // A training day earlier in the week than today has already passed - the UI's today-band
  // selector matches on date === today, so a session placed there would be permanently
  // unreachable (P0, #727 review). If every training day this week is already in the past, the
  // benchmark routine still gets written and committed - it's just not scheduled on this week's
  // calendar, same as any other day with nothing scheduled.
  let benchmarkPlaced = false;
  const days: WeekUpdateDay[] = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(startDate, i);
    const weekday = WEEKDAYS[i];
    const sessions: WeekUpdateSessionPatch[] = [];
    if (trainingDays.includes(weekday) && date >= today) {
      const isBenchmarkDay = !benchmarkPlaced;
      if (isBenchmarkDay) benchmarkPlaced = true;
      sessions.push(
        isBenchmarkDay
          ? {
              discipline: "foundation",
              kind: "benchmark",
              title: benchmarkTitle,
              priority: "anchor",
              template_id: benchmarkRoutineId,
            }
          : {
              discipline,
              kind: "strength",
              title: "Anchor strength session",
              priority: "support",
            },
      );
    }
    return { date, sessions };
  });

  const body =
    trainingDays.length > 0
      ? `First week, built from your benchmark. Sessions land on ${trainingDays.join(", ")} - the days you said you train.`
      : "First week. No training days stated yet, so nothing's scheduled - say when you train and next week will use it.";

  return {
    headline: "Your first week",
    body,
    days,
  };
}
