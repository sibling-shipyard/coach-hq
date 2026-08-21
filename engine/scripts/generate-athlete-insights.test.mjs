import assert from "node:assert/strict";
import test from "node:test";
import { buildAthleteInsights } from "./generate-athlete-insights.mjs";

const now = new Date("2026-08-20T00:00:00Z");
const activity = (sport, date) => ({ category: sport, start_date_local: `${date}T08:00:00` });

test("zero activities produces an empty sports map", () => {
  assert.deepEqual(buildAthleteInsights([], now).sports, {});
});

test("one activity has stable small-sample math", () => {
  assert.deepEqual(buildAthleteInsights([activity("Run", "2026-08-18")], now).sports.run, {
    sessions_365d: 1,
    sessions_per_week_recent_4w: 0.25,
    sessions_per_week_prior_12w: 0,
    longest_gap_days_365d: 0,
    days_since_last_session: 2,
  });
});

test("reports a long gap", () => {
  const result = buildAthleteInsights([
    activity("Badminton", "2026-01-01"), activity("Badminton", "2026-05-01"), activity("Badminton", "2026-08-19"),
  ], now);
  assert.equal(result.sports.badminton.longest_gap_days_365d, 120);
});

test("separates increasing recent frequency from the prior window", () => {
  const recent = [1, 3, 5, 7, 9, 11, 13, 15].map((days) => activity("Swim", `2026-08-${String(20 - days).padStart(2, "0")}`));
  const prior = ["2026-06-01", "2026-07-01"].map((date) => activity("Swim", date));
  const result = buildAthleteInsights([...recent, ...prior], now).sports.swim;
  assert.equal(result.sessions_per_week_recent_4w, 2);
  assert.equal(result.sessions_per_week_prior_12w, 0.17);
});
