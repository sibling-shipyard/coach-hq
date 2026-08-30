import { describe, it, expect } from "vitest";
import { renderCoachContext } from "../_lib/coachContext.js";
import type {
  ProfileJson,
  MemoryJson,
  InjuriesJson,
  CoachLogJson,
} from "../_lib/coachMemoryFiles.js";

// Part 1 of the coach-memory redesign (coach-redesign-part1-memory.md) replaced state.md's raw
// prose with profile.json/memory.json/injuries.json/coach_log.json. This is no longer a byte-for-
// byte snapshot against the old buildDynamicText output (that safety bar applied only to Step 1,
// before any file actually moved) - it now checks the section shape SOUL expects still comes out:
// same headers, populated from the new files.
describe("renderCoachContext section shape", () => {
  const profile: ProfileJson = {
    version: 1,
    coach_since: "2026-03-14",
    name: "Test Athlete",
    dob: "1993-05-14",
    timezone: "Asia/Kolkata",
    height_cm: 178,
    weight_kg: 74,
  };

  const memory: MemoryJson = {
    version: 1,
    _meta: { updated_at: "2026-08-18", updated_by: "model", trace_id: "t1" },
    sports: ["badminton", "strength"],
    notes: {
      fitness_baseline: {
        text: "Comfortable at moderate volume.",
        updated_at: "2026-08-01",
        trace_id: "t0",
      },
      coaching_priorities: {
        text: "Rebuild consistency.",
        updated_at: "2026-08-01",
        trace_id: "t0",
      },
      "learned_patterns.training": {
        text: "Responds well to short intervals.",
        updated_at: "2026-08-01",
        trace_id: "t0",
      },
      "learned_patterns.nutrition": {
        text: "Under-eats on heavy training days.",
        updated_at: "2026-08-01",
        trace_id: "t0",
      },
      "learned_patterns.mental": {
        text: "Motivation dips mid-week.",
        updated_at: "2026-08-01",
        trace_id: "t0",
      },
      equipment: {
        text: "Home gym: rack, barbell, dumbbells.",
        updated_at: "2026-08-01",
        trace_id: "t0",
      },
    },
  };

  const injuries: InjuriesJson = {
    flags: [
      {
        id: "inj_knee",
        text: "Right knee soreness after long runs.",
        status: "active",
        opened_at: "2026-08-01",
        resolved_at: null,
      },
      {
        id: "inj_elbow",
        text: "Old elbow strain.",
        status: "resolved",
        opened_at: "2026-07-01",
        resolved_at: "2026-07-20",
      },
    ],
  };

  const coachLog: CoachLogJson = {
    version: 1,
    rows: [
      {
        id: "sess_2026-08-12_a",
        date: "2026-08-12",
        ts: "2026-08-12T00:00:00Z",
        type: "chat",
        text: "Easy recovery ride.",
        trace_id: "t0",
      },
      {
        id: "sess_2026-08-13_b",
        date: "2026-08-13",
        ts: "2026-08-13T00:00:00Z",
        type: "chat",
        text: "Mobility and stretching.",
        trace_id: "t0",
      },
      {
        id: "sess_2026-08-14_a",
        date: "2026-08-14",
        ts: "2026-08-14T00:00:00Z",
        type: "chat",
        text: "Rest day.",
        trace_id: "t0",
      },
      {
        id: "sess_2026-08-15_b",
        date: "2026-08-15",
        ts: "2026-08-15T00:00:00Z",
        type: "chat",
        text: "Ran intervals, felt strong.",
        trace_id: "t0",
      },
      {
        id: "sess_2026-08-16_c",
        date: "2026-08-16",
        ts: "2026-08-16T00:00:00Z",
        type: "chat",
        text: "Strength session, all sets hit.",
        trace_id: "t0",
      },
      {
        id: "sess_2026-08-17_d",
        date: "2026-08-17",
        ts: "2026-08-17T00:00:00Z",
        type: "chat",
        text: "Badminton match, won 2-1.",
        trace_id: "t0",
      },
    ],
  };

  it("produces every section header Coach/SOUL expects to find by name", () => {
    const text = renderCoachContext({ profile, memory, injuries, coachLog, athleteInsights: null });
    for (const header of [
      "## Athlete Profile",
      "## Equipment",
      "## Recent Session Notes",
      "## Fitness Baseline",
      "## Active Injury Flags",
      "## Coaching Priorities",
      "## Learned Patterns",
    ]) {
      expect(text).toContain(header);
    }
  });

  it("fills the Athlete Profile section from profile.json + memory.json", () => {
    const text = renderCoachContext({ profile, memory, injuries, coachLog, athleteInsights: null });
    expect(text).toContain("- **Name:** Test Athlete");
    expect(text).toContain("- **Sport(s) / Activities:** badminton, strength");
    expect(text).toContain("- **Timezone:** Asia/Kolkata");
    expect(text).toContain("- **Height:** 178 cm");
    expect(text).toContain("- **Weight:** 74 kg");
  });

  it("only lists active injury flags, using the exact flag_id", () => {
    const text = renderCoachContext({ profile, memory, injuries, coachLog, athleteInsights: null });
    expect(text).toContain("inj_knee");
    expect(text).not.toContain("inj_elbow");
  });

  it("windows Recent Session Notes to the last 5 rows, most recent first", () => {
    const text = renderCoachContext({ profile, memory, injuries, coachLog, athleteInsights: null });
    const section = text.split("## Recent Session Notes")[1].split("## Fitness Baseline")[0];
    expect(section).toContain("2026-08-17");
    expect(section).toContain("2026-08-16");
    expect(section).toContain("2026-08-15");
    expect(section).toContain("2026-08-14");
    expect(section).toContain("2026-08-13");
    expect(section).not.toContain("2026-08-12"); // oldest, outside the 5-row window
    // most recent first
    expect(section.indexOf("2026-08-17")).toBeLessThan(section.indexOf("2026-08-16"));
  });

  it("renders the three Learned Patterns subsections from their three separate notes labels", () => {
    const text = renderCoachContext({ profile, memory, injuries, coachLog, athleteInsights: null });
    expect(text).toContain("Responds well to short intervals.");
    expect(text).toContain("Under-eats on heavy training days.");
    expect(text).toContain("Motivation dips mid-week.");
  });

  it("degrades gracefully when every file is null (new/unmigrated athlete)", () => {
    const text = renderCoachContext({
      profile: null,
      memory: null,
      injuries: null,
      coachLog: null,
      athleteInsights: null,
    });
    expect(text).toContain("## Athlete Profile");
    expect(text).toContain("- **Timezone:** UTC");
    expect(text).toContain("*(Empty)*");
  });

  it("renders a compact fitness snapshot for populated athlete insights", () => {
    const text = renderCoachContext({
      profile,
      memory,
      injuries,
      coachLog,
      athleteInsights: {
        schema_version: 1,
        generated_at: "2026-08-20T00:00:00Z",
        window_days: 365,
        sports: {
          badminton: {
            sessions_365d: 120,
            sessions_per_week_recent_4w: 3,
            sessions_per_week_prior_12w: 2.25,
            longest_gap_days_365d: 9,
            days_since_last_session: 2,
            duration_buckets: { under_30m: 10, "30_to_60m": 40, "60_to_120m": 50, over_120m: 20 },
          },
        },
      },
    });
    expect(text).toContain("## Fitness Snapshot (last 365 days)");
    expect(text).toContain(
      "**Badminton:** 120 sessions in the window; ~3x/week recently (~2.3x/week in the prior 12 weeks)",
    );
    expect(text).toContain(
      "longest gap 9 days; last session 2 days ago; 10 under 30m, 40 30-60m, 50 60-120m, 20 over 120m.",
    );
  });

  it("uses singular 'session' when count is 1", () => {
    const text = renderCoachContext({
      profile,
      memory,
      injuries,
      coachLog,
      athleteInsights: {
        schema_version: 1,
        generated_at: "2026-08-20T00:00:00Z",
        window_days: 365,
        sports: {
          run: {
            sessions_365d: 1,
            sessions_per_week_recent_4w: 0,
            sessions_per_week_prior_12w: 0,
            longest_gap_days_365d: 0,
            days_since_last_session: 3,
            duration_buckets: { under_30m: 1, "30_to_60m": 0, "60_to_120m": 0, over_120m: 0 },
          },
        },
      },
    });
    expect(text).toContain("1 session in the window");
    expect(text).not.toContain("1 sessions");
  });

  it("sorts sports descending by session count, alphabetical for ties", () => {
    const text = renderCoachContext({
      profile,
      memory,
      injuries,
      coachLog,
      athleteInsights: {
        schema_version: 1,
        generated_at: "2026-08-20T00:00:00Z",
        window_days: 365,
        sports: {
          yoga: {
            sessions_365d: 10,
            sessions_per_week_recent_4w: 0.5,
            sessions_per_week_prior_12w: 0.3,
            longest_gap_days_365d: 7,
            days_since_last_session: 2,
            duration_buckets: { under_30m: 0, "30_to_60m": 10, "60_to_120m": 0, over_120m: 0 },
          },
          badminton: {
            sessions_365d: 50,
            sessions_per_week_recent_4w: 2,
            sessions_per_week_prior_12w: 1.5,
            longest_gap_days_365d: 5,
            days_since_last_session: 1,
            duration_buckets: { under_30m: 5, "30_to_60m": 40, "60_to_120m": 5, over_120m: 0 },
          },
          run: {
            sessions_365d: 10,
            sessions_per_week_recent_4w: 0.5,
            sessions_per_week_prior_12w: 0.3,
            longest_gap_days_365d: 10,
            days_since_last_session: 4,
            duration_buckets: { under_30m: 2, "30_to_60m": 8, "60_to_120m": 0, over_120m: 0 },
          },
        },
      },
    });
    const snapshot = text.split("## Fitness Snapshot")[1].split("## Fitness Baseline")[0];
    const badmintonPos = snapshot.indexOf("Badminton");
    const runPos = snapshot.indexOf("Run");
    const yogaPos = snapshot.indexOf("Yoga");
    // badminton (50) must come first; run and yoga tied at 10 — run < yoga alphabetically
    expect(badmintonPos).toBeLessThan(runPos);
    expect(runPos).toBeLessThan(yogaPos);
  });

  it("caps output at 5 sports and appends an overflow line", () => {
    const sports = Object.fromEntries(
      ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"].map((s, i) => [
        s,
        {
          sessions_365d: 10 - i,
          sessions_per_week_recent_4w: 1,
          sessions_per_week_prior_12w: 1,
          longest_gap_days_365d: 5,
          days_since_last_session: 1,
          duration_buckets: { under_30m: 1, "30_to_60m": 2, "60_to_120m": 1, over_120m: 0 },
        },
      ]),
    );
    const text = renderCoachContext({
      profile,
      memory,
      injuries,
      coachLog,
      athleteInsights: {
        schema_version: 1,
        generated_at: "2026-08-20T00:00:00Z",
        window_days: 365,
        sports,
      },
    });
    expect(text).toContain("(+ 1 more sport)");
    expect(text).not.toContain("Zeta"); // 6th sport capped
  });

  it("still renders a sport when older insights omit duration_buckets", () => {
    const text = renderCoachContext({
      profile,
      memory,
      injuries,
      coachLog,
      athleteInsights: {
        schema_version: 1,
        generated_at: "2026-08-20T00:00:00Z",
        window_days: 365,
        sports: {
          run: {
            sessions_365d: 20,
            sessions_per_week_recent_4w: 1,
            sessions_per_week_prior_12w: 0.5,
            longest_gap_days_365d: 14,
            days_since_last_session: 5,
          },
        },
      } as never,
    });
    expect(text).toContain("**Run:** 20 sessions in the window");
    expect(text).toContain("longest gap 14 days; last session 5 days ago.");
    expect(text).not.toContain("under 30m");
  });

  it("uses the insight file's own window_days in the section heading", () => {
    const text = renderCoachContext({
      profile,
      memory,
      injuries,
      coachLog,
      athleteInsights: {
        schema_version: 1,
        generated_at: "2026-08-20T00:00:00Z",
        window_days: 90,
        sports: {
          run: {
            sessions_365d: 20,
            sessions_per_week_recent_4w: 1,
            sessions_per_week_prior_12w: 0.5,
            longest_gap_days_365d: 14,
            days_since_last_session: 5,
            duration_buckets: { under_30m: 5, "30_to_60m": 10, "60_to_120m": 4, over_120m: 1 },
          },
        },
      },
    });
    expect(text).toContain("## Fitness Snapshot (last 90 days)");
  });

  it.each([
    ["absent", null],
    [
      "missing schema_version",
      {
        generated_at: "2026-08-20T00:00:00Z",
        window_days: 365,
        sports: {
          run: {
            sessions_365d: 20,
            sessions_per_week_recent_4w: 1,
            sessions_per_week_prior_12w: 0.5,
            longest_gap_days_365d: 14,
            days_since_last_session: 5,
            duration_buckets: { under_30m: 0, "30_to_60m": 5, "60_to_120m": 10, over_120m: 5 },
          },
        },
      },
    ],
    [
      "wrong schema_version",
      { schema_version: 2, generated_at: "2026-08-20T00:00:00Z", window_days: 365, sports: {} },
    ],
    [
      "empty sports",
      { schema_version: 1, generated_at: "2026-08-20T00:00:00Z", window_days: 365, sports: {} },
    ],
    [
      "malformed",
      {
        schema_version: 1,
        generated_at: "",
        window_days: 365,
        sports: { run: { sessions_365d: "many" } },
      },
    ],
    [
      "unparseable generated_at",
      {
        schema_version: 1,
        generated_at: "not-a-date",
        window_days: 365,
        sports: {
          run: {
            sessions_365d: 20,
            sessions_per_week_recent_4w: 1,
            sessions_per_week_prior_12w: 0.5,
            longest_gap_days_365d: 14,
            days_since_last_session: 5,
            duration_buckets: { under_30m: 0, "30_to_60m": 5, "60_to_120m": 10, over_120m: 5 },
          },
        },
      },
    ],
  ])("cleanly omits the fitness snapshot when insights are %s", (_case, athleteInsights) => {
    const text = renderCoachContext({
      profile,
      memory,
      injuries,
      coachLog,
      athleteInsights: athleteInsights as never,
    });
    expect(text).not.toContain("Fitness Snapshot");
  });
});
