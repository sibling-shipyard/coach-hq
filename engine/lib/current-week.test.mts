import { describe, it, expect } from "vitest";

import { parseCurrentWeek, type CurrentWeek } from "./current-week.mts";

// Discipline is a closed enum (ADR 0042, docs/eng-docs/coach-data-schema.md), not free text.
// This covers the enum itself at the schema-validator level: an unusual-but-valid value is
// accepted and preserved, and a value outside the fifteen is rejected rather than silently let
// through.

function validCurrentWeek(discipline: string): CurrentWeek {
  return {
    schema_version: 1,
    data_status: "live",
    timezone: "America/New_York",
    week: {
      id: "2026-W34",
      start_date: "2026-08-17",
      end_date: "2026-08-23",
      focus: null,
      guardrails: [],
    },
    coach_read: {
      headline: "Steady week ahead.",
      body: "Focus on consistency.",
      valid_from: "2026-08-17",
      valid_until: "2026-08-23",
    },
    days: [
      {
        date: "2026-08-17",
        intent: null,
        coach_note: null,
        sessions: [
          {
            id: "sess_20260817_1",
            origin: "planned",
            discipline: discipline as CurrentWeek["days"][number]["sessions"][number]["discipline"],
            kind: "easy",
            title: "Session",
            priority: "anchor",
            status: "planned",
            planned_duration_min: 30,
            template_id: null,
            session_file: null,
            coach_note: null,
            original_date: null,
            completion_activity_ids: [],
          },
        ],
      },
      ...["2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23"].map(
        (date) => ({
          date,
          intent: null,
          coach_note: null,
          sessions: [],
        }),
      ),
    ],
    updated_at: "2026-08-17T12:00:00.000Z",
    updated_by: "model",
    trace_id: "trace-1",
  };
}

describe("parseCurrentWeek discipline enum", () => {
  it("accepts an unusual-but-valid discipline (badminton) and keeps it", () => {
    const result = parseCurrentWeek(validCurrentWeek("badminton"));
    expect(result.issues).toEqual([]);
    expect(result.data?.days[0].sessions[0].discipline).toBe("badminton");
  });

  it("accepts another unusual-but-valid discipline (hike) and keeps it", () => {
    const result = parseCurrentWeek(validCurrentWeek("hike"));
    expect(result.issues).toEqual([]);
    expect(result.data?.days[0].sessions[0].discipline).toBe("hike");
  });

  it("rejects a discipline outside the closed enum", () => {
    const result = parseCurrentWeek(validCurrentWeek("yoga"));
    expect(result.data).toBeNull();
    expect(result.issues.some((issue) => issue.includes("discipline"))).toBe(true);
  });
});
