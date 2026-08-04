import { describe, it, expect, vi, afterEach } from "vitest";
import { needsLiveRecomputation } from "../_lib/generate-widget-snapshots-from-aggregate.js";

// Regression coverage for the stale current_week bug: a "placeholder" week (the real value the
// ledger ships once the coach has planned a week) used to pass straight through unmodified even
// once its start_date/end_date no longer covered today, leaking a prior week's data into Home's
// Weekly Log and Main Quest widgets. needsLiveRecomputation now also triggers a live recompute
// for a stale placeholder, while leaving a still-accurate one untouched.
describe("needsLiveRecomputation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is true when there is no week at all", () => {
    expect(needsLiveRecomputation(undefined)).toBe(true);
  });

  it("is true for an unavailable week", () => {
    expect(needsLiveRecomputation({ data_status: "unavailable" })).toBe(true);
  });

  it("is false for a placeholder week whose stored range brackets today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00Z"));
    expect(
      needsLiveRecomputation({
        data_status: "placeholder",
        week: { start_date: "2026-08-03", end_date: "2026-08-09" },
      } as never),
    ).toBe(false);
  });

  it("is true for a placeholder week whose stored range is a prior week", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00Z"));
    expect(
      needsLiveRecomputation({
        data_status: "placeholder",
        week: { start_date: "2026-07-27", end_date: "2026-08-02" },
      } as never),
    ).toBe(true);
  });

  it("is true for a placeholder week whose stored range is in the future", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00Z"));
    expect(
      needsLiveRecomputation({
        data_status: "placeholder",
        week: { start_date: "2026-08-10", end_date: "2026-08-16" },
      } as never),
    ).toBe(true);
  });
});
