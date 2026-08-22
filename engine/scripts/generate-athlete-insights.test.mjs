import assert from "node:assert/strict";
import test from "node:test";
import { buildAthleteInsights } from "./generate-athlete-insights.mjs";

const now = new Date("2026-08-20T00:00:00Z");
const activity = (sport, date) => ({ sport_type: sport, start_date_local: `${date}T08:00:00` });

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
    duration_buckets: { under_30m: 0, "30_to_60m": 0, "60_to_120m": 0, over_120m: 0 },
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

test("buckets on sport_type and ignores the category sub-tag", () => {
  const tagged = (category, date) => ({
    sport_type: "Badminton", category, start_date_local: `${date}T08:00:00`,
  });
  const result = buildAthleteInsights([
    tagged("RNK", "2026-08-17"), tagged("FRN", "2026-08-18"), tagged("CAS", "2026-08-19"),
  ], now);
  assert.deepEqual(Object.keys(result.sports), ["badminton"]);
  assert.equal(result.sports.badminton.sessions_365d, 3);
});

test("skips activities with no sport_type rather than falling back to category", () => {
  const result = buildAthleteInsights([
    { category: "RDE", start_date_local: "2026-08-18T08:00:00" },
    activity("Ride", "2026-08-19"),
  ], now);
  assert.deepEqual(Object.keys(result.sports), ["ride"]);
  assert.equal(result.sports.ride.sessions_365d, 1);
});

test("splits camelCase sport names so they render as two words", () => {
  const result = buildAthleteInsights([activity("WeightTraining", "2026-08-19")], now);
  assert.deepEqual(Object.keys(result.sports), ["weight_training"]);
});

test("counts sessions into duration buckets from elapsed_time seconds", () => {
  const timed = (elapsed, date) => ({ ...activity("Run", date), elapsed_time: elapsed });
  const result = buildAthleteInsights([
    timed(1799, "2026-08-19"),
    timed(1800, "2026-08-18"),
    timed(3599, "2026-08-17"),
    timed(3600, "2026-08-16"),
    timed(7199, "2026-08-15"),
    timed(7200, "2026-08-14"),
  ], now);
  assert.deepEqual(result.sports.run.duration_buckets, {
    under_30m: 1, "30_to_60m": 2, "60_to_120m": 2, over_120m: 1,
  });
  assert.equal(result.sports.run.sessions_365d, 6);
});

test("skips missing or non-numeric elapsed_time from the histogram only", () => {
  const result = buildAthleteInsights([
    { ...activity("Ride", "2026-08-19"), elapsed_time: 2400 },
    activity("Ride", "2026-08-18"),
    { ...activity("Ride", "2026-08-17"), elapsed_time: "3600" },
    { ...activity("Ride", "2026-08-16"), elapsed_time: Number.NaN },
  ], now);
  assert.equal(result.sports.ride.sessions_365d, 4);
  assert.deepEqual(result.sports.ride.duration_buckets, {
    under_30m: 0, "30_to_60m": 1, "60_to_120m": 0, over_120m: 0,
  });
});
