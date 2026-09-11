#!/usr/bin/env node
/**
 * rollover-current-week.mjs — the scheduled rollover ADR 0039/finding 8 calls for.
 *
 * current_week.json only ever refreshes when the model writes it: one day of grace past a live
 * week's end, parseCurrentWeek reports it "stale," and an athlete who doesn't chat opens a week
 * that still points at last week's dates. This job runs in the sync pipeline (not chat-triggered)
 * and replaces an aged-out week with a fresh placeholder frame for the real current week, so the
 * file always names the right week even before Coach has had the real kickoff conversation. It
 * does not compile a plan - that's W3 (blocks in seasons.json), still gated. This only keeps the
 * frame current.
 *
 * Usage:
 *   node engine/scripts/rollover-current-week.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ledgerDir, repoRoot } from "../lib/repo-layout.mjs";
import { parseCurrentWeek } from "../lib/current-week.mts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = repoRoot(__dirname);

// Self-contained copies, same reasoning as coachWeekFiles.ts's own local date helpers - engine/
// doesn't export these from current-week.mts, and this script has no other dependency on that
// file's internals.
function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mondayOnOrBefore(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDay() || 7; // Sunday is 0 -> treat as 7
  return addDays(dateString, 1 - day);
}

function getIsoWeekId(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const daysSinceYearStart = Math.floor((date.getTime() - yearStart.getTime()) / 86_400_000) + 1;
  const week = Math.ceil(daysSinceYearStart / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

function todayInTimeZone(timeZone, now) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(now);
  }
}

/**
 * A live week rolls over once it's past its one-day grace period (parseCurrentWeek's own
 * "stale" availability). A placeholder week's availability is always "placeholder" regardless of
 * its dates, never "stale" - so a placeholder rolls over on a direct date check instead: once
 * today falls past its own end_date.
 */
export function needsRollover(runtime, todayDateStr) {
  const data = runtime.data;
  if (!data) return false;
  if (data.data_status === "live" && runtime.availability.status === "stale") return true;
  if (data.data_status === "placeholder" && todayDateStr > data.week.end_date) return true;
  return false;
}

export function buildRolloverPlaceholder(timezone, todayDateStr, now) {
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

export function main(repoRootPath = REPO_ROOT, now = new Date()) {
  const currentWeekPath = path.join(ledgerDir(repoRootPath), "current_week.json");
  if (!fs.existsSync(currentWeekPath)) {
    console.log("[rollover] no current_week.json - nothing to roll over");
    return;
  }
  const raw = JSON.parse(fs.readFileSync(currentWeekPath, "utf-8"));
  const runtime = parseCurrentWeek(raw, now);
  if (!runtime.data) {
    console.log("[rollover] current_week.json isn't schema-valid - leaving it untouched");
    return;
  }

  const today = todayInTimeZone(runtime.data.timezone, now);
  if (!needsRollover(runtime, today)) {
    console.log("[rollover] week is still current - nothing to do");
    return;
  }

  const placeholder = buildRolloverPlaceholder(runtime.data.timezone, today, now);
  const validated = parseCurrentWeek(placeholder, now);
  if (!validated.data) {
    throw new Error(
      `rollover-current-week: placeholder failed validation, refusing to write: ${validated.issues.join("; ")}`,
    );
  }
  fs.writeFileSync(currentWeekPath, JSON.stringify(placeholder, null, 2) + "\n");
  console.log(
    `[rollover] rolled current_week.json to ${placeholder.week.id} (${placeholder.week.start_date}..${placeholder.week.end_date})`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
