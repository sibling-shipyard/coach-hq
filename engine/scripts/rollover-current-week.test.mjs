import assert from "node:assert/strict";
import test from "node:test";
import { buildRolloverPlaceholder, needsRollover } from "./rollover-current-week.mjs";
import { parseCurrentWeek } from "../lib/current-week.mts";

function isoWeekId(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const daysSinceYearStart = Math.floor((date.getTime() - yearStart.getTime()) / 86_400_000) + 1;
  const week = Math.ceil(daysSinceYearStart / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

function liveWeek(startDate, endDate) {
  return {
    schema_version: 1,
    data_status: "live",
    timezone: "UTC",
    week: { id: isoWeekId(startDate), start_date: startDate, end_date: endDate, focus: null, guardrails: [] },
    coach_read: { headline: "h", body: "b", valid_from: startDate, valid_until: endDate },
    days: Array.from({ length: 7 }, (_, i) => {
      const date = new Date(`${startDate}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + i);
      return { date: date.toISOString().slice(0, 10), intent: null, coach_note: null, sessions: [] };
    }),
    updated_at: `${startDate}T00:00:00Z`,
    updated_by: "model",
    trace_id: "t",
  };
}

function placeholderWeek(startDate, endDate) {
  const w = liveWeek(startDate, endDate);
  return { ...w, data_status: "placeholder", coach_read: null };
}

test("buildRolloverPlaceholder produces schema-valid output", () => {
  const now = new Date("2026-09-11T12:00:00Z");
  const placeholder = buildRolloverPlaceholder("UTC", "2026-09-11", now);
  const runtime = parseCurrentWeek(placeholder, now);
  assert.deepEqual(runtime.issues, []);
  assert.ok(runtime.data);
});

test("buildRolloverPlaceholder anchors the week to the Monday on or before today", () => {
  // 2026-09-11 is a Friday
  const placeholder = buildRolloverPlaceholder("UTC", "2026-09-11", new Date("2026-09-11T12:00:00Z"));
  assert.equal(placeholder.week.start_date, "2026-09-07");
  assert.equal(placeholder.week.end_date, "2026-09-13");
  assert.equal(placeholder.days.length, 7);
  assert.equal(placeholder.days[0].date, "2026-09-07");
});

test("buildRolloverPlaceholder anchors correctly when today IS the Monday", () => {
  const placeholder = buildRolloverPlaceholder("UTC", "2026-09-07", new Date("2026-09-07T12:00:00Z"));
  assert.equal(placeholder.week.start_date, "2026-09-07");
});

test("needsRollover: a live week past its grace period needs rollover", () => {
  const now = new Date("2026-09-01T12:00:00Z"); // well past 2026-08-23 + 1 day grace
  const runtime = parseCurrentWeek(liveWeek("2026-08-17", "2026-08-23"), now);
  assert.equal(runtime.availability.status, "stale");
  assert.equal(needsRollover(runtime, "2026-09-01"), true);
});

test("needsRollover: a live week still current or in grace does not need rollover", () => {
  const now = new Date("2026-08-20T12:00:00Z");
  const runtime = parseCurrentWeek(liveWeek("2026-08-17", "2026-08-23"), now);
  assert.equal(needsRollover(runtime, "2026-08-20"), false);
});

test("needsRollover: a placeholder week for a past period needs rollover, even though availability never reports stale", () => {
  const now = new Date("2026-09-01T12:00:00Z");
  const runtime = parseCurrentWeek(placeholderWeek("2026-01-05", "2026-01-11"), now);
  assert.equal(runtime.availability.status, "placeholder");
  assert.equal(needsRollover(runtime, "2026-09-01"), true);
});

test("needsRollover: a placeholder week still covering today does not need rollover", () => {
  const now = new Date("2026-08-19T12:00:00Z");
  const runtime = parseCurrentWeek(placeholderWeek("2026-08-17", "2026-08-23"), now);
  assert.equal(needsRollover(runtime, "2026-08-19"), false);
});

test("needsRollover: no data (invalid/missing) never needs rollover", () => {
  const now = new Date("2026-09-01T12:00:00Z");
  const runtime = parseCurrentWeek({ not: "a real week" }, now);
  assert.equal(needsRollover(runtime, "2026-09-01"), false);
});
