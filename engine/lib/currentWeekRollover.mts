/**
 * currentWeekRollover.mts — the pure decision logic behind current_week.json's rollover.
 *
 * needsRollover and buildRolloverPlaceholder depend only on a parsed CurrentWeekRuntime and
 * today's date, never on the local git checkout, so they live here rather than in
 * rollover-current-week.mjs itself: this file is importable from a plain Node script and (via
 * ui/scripts/bundle-current-week-api.mjs, the same way current-week.mts already is) from the
 * coach-chat Vercel function, once that consumer lands.
 */
import type { CurrentWeekRuntime } from "./current-week.mts";

function addDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mondayOnOrBefore(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDay() || 7; // Sunday is 0 -> treat as 7
  return addDays(dateString, 1 - day);
}

function getIsoWeekId(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const daysSinceYearStart = Math.floor((date.getTime() - yearStart.getTime()) / 86_400_000) + 1;
  const week = Math.ceil(daysSinceYearStart / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/**
 * A live week rolls over once it's past its one-day grace period (parseCurrentWeek's own
 * "stale" availability). A placeholder week's availability is always "placeholder" regardless of
 * its dates, never "stale" - so a placeholder rolls over on a direct date check instead: once
 * today falls past its own end_date.
 */
export function needsRollover(runtime: CurrentWeekRuntime, todayDateStr: string): boolean {
  const data = runtime.data;
  if (!data) return false;
  if (data.data_status === "live" && runtime.availability.status === "stale") return true;
  if (data.data_status === "placeholder" && todayDateStr > data.week.end_date) return true;
  return false;
}

export function buildRolloverPlaceholder(timezone: string, todayDateStr: string, now: Date) {
  const startDate = mondayOnOrBefore(todayDateStr);
  const endDate = addDays(startDate, 6);
  const days = Array.from({ length: 7 }, (_, i) => ({
    date: addDays(startDate, i),
    intent: null,
    coach_note: null,
    sessions: [],
  }));
  return {
    schema_version: 1,
    data_status: "placeholder",
    timezone,
    week: {
      id: getIsoWeekId(startDate),
      start_date: startDate,
      end_date: endDate,
      focus: null,
      guardrails: [],
    },
    coach_read: null,
    days,
    updated_at: now.toISOString(),
    updated_by: "rollover",
    trace_id: "rollover",
  };
}
