import { describe, it, expect } from "vitest";
import { adaptCurrentWeek } from "./currentWeekAdapter";
import type { CurrentWeek, CurrentWeekAvailability } from "@/lib/currentWeek";
import type { Activity } from "@/lib/activities";

describe("currentWeekAdapter completion matching", () => {
  const mockAvailability: CurrentWeekAvailability = {
    status: "current",
    available: true,
    reason: "current week plan is available",
  };

  const baseRuntime: CurrentWeek = {
    schema_version: 1,
    data_status: "live",
    timezone: "UTC",
    week: {
      id: "2026-w31",
      start_date: "2026-08-01",
      end_date: "2026-08-07",
      phase_name: "Base",
      block_name: "Block 1",
      focus: "Build baseline fitness",
      guardrails: [],
    },
    coach_read: null,
    coach_comments: [],
    updated_at: "2026-08-01T00:00:00Z",
    updated_by: "coach",
    days: [
      {
        date: "2026-08-02",
        intent: "train",
        coach_note: null,
        sessions: [
          {
            id: "session-1",
            origin: "planned",
            discipline: "run",
            kind: "run",
            title: "Sunday Long Run",
            priority: "anchor",
            status: "done",
            planned_duration_min: 60,
            planned_load: 100,
            template_id: null,
            session_file: null,
            coach_note: null,
            original_date: null,
            completion_activity_ids: ["healthkit:8F3A-E2C1-4D90-A875-5A36A0FB954C"],
          },
          {
            id: "session-2",
            origin: "planned",
            discipline: "badminton",
            kind: "badminton",
            title: "Badminton Session",
            priority: "support",
            status: "done",
            planned_duration_min: 90,
            planned_load: 150,
            template_id: null,
            session_file: null,
            coach_note: null,
            original_date: null,
            completion_activity_ids: ["123456789"],
          }
        ],
      },
    ],
  };

  it("should match HealthKit UUID string IDs correctly", () => {
    const activities: Activity[] = [
      {
        id: "8F3A-E2C1-4D90-A875-5A36A0FB954C",
        name: "Morning Run",
        sport_type: "Run",
        start_date_local: "2026-08-02T08:00:00",
        elapsed_time: 3600,
        moving_time: 3600,
        calories: 600,
        distance: 10000,
        total_elevation_gain: 50,
        average_heartrate: 150,
        max_heartrate: 170,
        has_heartrate: true,
        hr_zones: null,
        description: null,
        max_speed: 4.0,
        device_name: "Apple Watch",
      },
    ];

    const result = adaptCurrentWeek(baseRuntime, mockAvailability, activities);
    
    // The session should retain its mapped completion_activity_ids (stripped prefix)
    expect(result.days[0].sessions[0].completion_activity_ids).toEqual(["8F3A-E2C1-4D90-A875-5A36A0FB954C"]);
    
    // The activity should be successfully claimed, so no overlay sessions should be created for it
    const overlays = result.days[0].sessions.filter(s => s.id.startsWith("activity-"));
    expect(overlays).toHaveLength(0);
  });

  it("should match legacy Strava numeric IDs correctly", () => {
    const activities: Activity[] = [
      {
        id: 123456789,
        name: "Badminton friendly",
        sport_type: "Badminton",
        start_date_local: "2026-08-02T18:00:00",
        elapsed_time: 5400,
        moving_time: 5400,
        calories: 800,
        distance: 0,
        total_elevation_gain: 0,
        average_heartrate: 140,
        max_heartrate: 160,
        has_heartrate: true,
        hr_zones: null,
        description: null,
        max_speed: 0,
        device_name: "Garmin",
      },
    ];

    const result = adaptCurrentWeek(baseRuntime, mockAvailability, activities);

    expect(result.days[0].sessions[1].completion_activity_ids).toEqual(["123456789"]);
    
    const overlays = result.days[0].sessions.filter(s => s.id.startsWith("activity-"));
    expect(overlays).toHaveLength(0);
  });
});
