import { describe, it, expect } from "vitest";
import { applyWeekPlan, applySessionReconcile, applyPlanEdit, CURRENT_WEEK_PATH, type WeekPlan } from "../_lib/coachWeekFiles.js";
import { parseCurrentWeek } from "../../../../engine/lib/current-week.mts";

// coach-redesign workout-backend-wiring §5: week_plan/session_reconcile action fields. Covers the
// bookkeeping applyWeekPlan computes (week id/bounds, session ids, coach_read window), the
// Monday/7-day guards, the lenient template_id-nulling judgment call, and applySessionReconcile's
// upsert-by-id patch plus its throw-on-hallucinated-id discipline (mirrors applyQuestEvent).

function validPlan(overrides: Partial<WeekPlan> = {}): WeekPlan {
  const days = ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23"].map((date, i) => ({
    date,
    intent: i === 0 ? "Build" : null,
    sessions:
      i === 0
        ? [{ discipline: "run", kind: "easy", title: "Easy 5k", priority: "anchor" as const, planned_duration_min: 30, template_id: "strength_b" }]
        : [],
  }));
  return {
    focus: "Base building",
    guardrails: ["No back-to-back hard days"],
    headline: "Steady week ahead.",
    body: "Focus on consistency over intensity this week.",
    days,
    ...overrides,
  };
}

describe("CURRENT_WEEK_PATH", () => {
  it("points at the ledger path", () => {
    expect(CURRENT_WEEK_PATH).toBe("user_data/ledger/current_week.json");
  });
});

describe("applyWeekPlan", () => {
  const validTemplateIds = new Set(["strength_b"]);
  const now = new Date("2026-08-18T18:00:00Z");

  it("computes week id/bounds and session bookkeeping, and produces schema-valid output", () => {
    const content = applyWeekPlan(validPlan(), validTemplateIds, "America/New_York", "t1", now);
    const parsed = JSON.parse(content);
    expect(parsed.week).toMatchObject({ id: "2026-W34", start_date: "2026-08-17", end_date: "2026-08-23", focus: "Base building" });
    expect(parsed.days).toHaveLength(7);
    const firstSession = parsed.days[0].sessions[0];
    expect(firstSession.id).toBe("sess_20260817_1");
    expect(firstSession).toMatchObject({ origin: "planned", status: "planned", session_file: null, planned_load: null, template_id: "strength_b" });
    expect(parsed.coach_comments).toEqual([]);
    expect(parsed.coach_read).toMatchObject({ headline: "Steady week ahead.", valid_until: "2026-08-23" });
    expect(parsed._meta).toBeUndefined();
    expect(parsed.updated_by).toBe("model");
    expect(parsed.trace_id).toBe("t1");

    const runtime = parseCurrentWeek(parsed, now);
    expect(runtime.issues).toEqual([]);
    expect(runtime.data).not.toBeNull();
  });

  it("defaults a session's priority to support when Gemini leaves it blank", () => {
    const plan = validPlan();
    delete (plan.days[0].sessions[0] as any).priority;
    const content = applyWeekPlan(plan, validTemplateIds, "America/New_York", "t1", now);
    const parsed = JSON.parse(content);
    expect(parsed.days[0].sessions[0].priority).toBe("support");
  });

  it("nulls out a hallucinated template_id instead of throwing", () => {
    const plan = validPlan();
    plan.days[0].sessions[0].template_id = "made_up_id";
    const content = applyWeekPlan(plan, validTemplateIds, "America/New_York", "t1", now);
    const parsed = JSON.parse(content);
    expect(parsed.days[0].sessions[0].template_id).toBeNull();
  });

  it("throws when days isn't exactly 7", () => {
    const plan = validPlan();
    plan.days = plan.days.slice(0, 6);
    expect(() => applyWeekPlan(plan, validTemplateIds, "America/New_York", "t1", now)).toThrow("expected exactly 7 days");
  });

  it("throws when headline or body is missing", () => {
    const plan = validPlan({ headline: "" });
    expect(() => applyWeekPlan(plan, validTemplateIds, "America/New_York", "t1", now)).toThrow("headline and body are required");
  });

  it("throws when the first day isn't a Monday", () => {
    const plan = validPlan();
    plan.days[0] = { ...plan.days[0], date: "2026-08-18" };
    expect(() => applyWeekPlan(plan, validTemplateIds, "America/New_York", "t1", now)).toThrow("must be a Monday");
  });

  it("throws when days aren't consecutive from Monday", () => {
    const plan = validPlan();
    plan.days[3] = { ...plan.days[3], date: "2026-08-25" };
    expect(() => applyWeekPlan(plan, validTemplateIds, "America/New_York", "t1", now)).toThrow("must be consecutive from Monday");
  });

  it("throws when a day date isn't a real date", () => {
    const plan = validPlan();
    plan.days[0] = { ...plan.days[0], date: "not-a-date" };
    expect(() => applyWeekPlan(plan, validTemplateIds, "America/New_York", "t1", now)).toThrow("not a real YYYY-MM-DD date");
  });
});

describe("applySessionReconcile", () => {
  const EXISTING: string = JSON.stringify({
    schema_version: 1,
    data_status: "live",
    timezone: "America/New_York",
    week: { id: "2026-W34", start_date: "2026-08-17", end_date: "2026-08-23", focus: null, guardrails: [] },
    coach_read: { headline: "Steady week ahead.", body: "Focus on consistency.", valid_from: "2026-08-17", valid_until: "2026-08-23" },
    days: [
      {
        date: "2026-08-17",
        intent: null,
        coach_note: null,
        sessions: [
          {
            id: "sess_20260817_1",
            origin: "planned",
            discipline: "run",
            kind: "easy",
            title: "Easy 5k",
            priority: "anchor",
            status: "planned",
            planned_duration_min: 30,
            planned_load: null,
            template_id: null,
            session_file: null,
            coach_note: null,
            original_date: null,
            completion_activity_ids: [],
          },
        ],
      },
      ...["2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23"].map((date) => ({
        date,
        intent: null,
        coach_note: null,
        sessions: [],
      })),
    ],
    coach_comments: [],
    updated_at: "2026-08-17T12:00:00.000Z",
    updated_by: "model",
    trace_id: "old",
  });

  const now = new Date("2026-08-18T18:00:00Z");

  it("throws when current_week.json content can't be read", () => {
    expect(() => applySessionReconcile(null, [{ session_id: "sess_20260817_1", status: "done" }], new Set(), "t1", now)).toThrow(
      "current_week.json could not be read",
    );
  });

  it("throws a descriptive error instead of a raw TypeError when days isn't an array", () => {
    const malformed = JSON.stringify({ ...JSON.parse(EXISTING), days: "not-an-array" });
    expect(() => applySessionReconcile(malformed, [{ session_id: "sess_20260817_1", status: "done" }], new Set(), "t1", now)).toThrow(
      "current_week.json is malformed (days is not an array)",
    );
  });

  it("throws a descriptive error instead of a raw TypeError when a day's sessions isn't an array", () => {
    const parsed = JSON.parse(EXISTING);
    parsed.days[0].sessions = null;
    expect(() => applySessionReconcile(JSON.stringify(parsed), [{ session_id: "sess_20260817_1", status: "done" }], new Set(), "t1", now)).toThrow(
      "current_week.json is malformed (days[0].sessions is not an array)",
    );
  });

  it("throws with the hallucinated-id message when session_id isn't found across any day", () => {
    expect(() => applySessionReconcile(EXISTING, [{ session_id: "made_up", status: "done" }], new Set(), "t1", now)).toThrow(
      'no session with id "made_up" in current_week.json',
    );
  });

  it("applies a partial patch to no sessions when one event in the batch has a bad id (fails whole call)", () => {
    expect(() =>
      applySessionReconcile(EXISTING, [{ session_id: "sess_20260817_1", status: "done" }, { session_id: "bad", status: "done" }], new Set(), "t1", now),
    ).toThrow('no session with id "bad"');
  });

  it("patches status and qualifies activity_ids with chat: prefix, leaving everything else untouched", () => {
    const content = applySessionReconcile(EXISTING, [{ session_id: "sess_20260817_1", status: "done", activity_ids: ["abc123"] }], new Set(), "t2", now);
    const parsed = JSON.parse(content);
    const session = parsed.days[0].sessions[0];
    expect(session.status).toBe("done");
    expect(session.completion_activity_ids).toEqual(["chat:abc123"]);
    expect(session.title).toBe("Easy 5k");
    expect(parsed.trace_id).toBe("t2");
    expect(parsed.updated_at).toBe("2026-08-18T18:00:00.000Z");
    expect(parsed.week.id).toBe("2026-W34");
  });

  it("passes through an already-qualified activity id unchanged", () => {
    const content = applySessionReconcile(EXISTING, [{ session_id: "sess_20260817_1", status: "done", activity_ids: ["healthkit:xyz"] }], new Set(), "t2", now);
    const parsed = JSON.parse(content);
    expect(parsed.days[0].sessions[0].completion_activity_ids).toEqual(["healthkit:xyz"]);
  });

  it("clears completion_activity_ids for a skipped session even if activity_ids was passed", () => {
    const content = applySessionReconcile(EXISTING, [{ session_id: "sess_20260817_1", status: "skipped", activity_ids: ["abc"] }], new Set(), "t2", now);
    const parsed = JSON.parse(content);
    expect(parsed.days[0].sessions[0].status).toBe("skipped");
    expect(parsed.days[0].sessions[0].completion_activity_ids).toEqual([]);
  });

  it("produces schema-valid output", () => {
    const content = applySessionReconcile(EXISTING, [{ session_id: "sess_20260817_1", status: "done" }], new Set(), "t2", now);
    const runtime = parseCurrentWeek(JSON.parse(content), now);
    expect(runtime.issues).toEqual([]);
    expect(runtime.data).not.toBeNull();
  });

  it("treats malformed JSON as unreadable, throwing rather than silently starting empty", () => {
    expect(() => applySessionReconcile("{not valid json", [{ session_id: "sess_20260817_1", status: "done" }], new Set(), "t1", now)).toThrow(
      "could not be read",
    );
  });

  it("throws on an id that doesn't exist in the given content, regardless of caller", () => {
    // PR #421 review, round 2: applyWeekPlan's session ids are synthesized purely from
    // date + array-index (see applyWeekPlan above), with no dependence on session content - a
    // same-day re-plan can coincidentally regenerate the exact same id string for an unrelated
    // session. That's why coach-chat.ts no longer chains week_plan's rebuilt output straight into
    // applySessionReconcile when Gemini sets both in one turn (a coincidental id match there would
    // silently misattribute the reconcile to the wrong session) - week_plan wins outright and
    // session_reconcile is dropped for that turn instead. This applier-level test just documents
    // the narrower, still-true fact: applySessionReconcile itself throws on any id genuinely
    // absent from its input, which is what protects every OTHER caller of this function.
    const rebuilt = applyWeekPlan(validPlan(), new Set(), "Asia/Kolkata", "t1", now);
    expect(() => applySessionReconcile(rebuilt, [{ session_id: "sess_genuinely_absent", status: "done" }], new Set(), "t1", now)).toThrow(
      /no session with id "sess_genuinely_absent"/,
    );
  });

  // actual: relabels a session to what really happened, when it differs from the plan
  // ("planned a run, actually played badminton"), per direction.
  it("relabels discipline/kind/title when actual is given, alongside the status patch", () => {
    const content = applySessionReconcile(
      EXISTING,
      [{ session_id: "sess_20260817_1", status: "done", actual: { discipline: "badminton", kind: "sport", title: "Badminton" } }],
      new Set(),
      "t2",
      now,
    );
    const session = JSON.parse(content).days[0].sessions[0];
    expect(session).toMatchObject({ status: "done", discipline: "badminton", kind: "sport", title: "Badminton", template_id: null });
  });

  it("links a real template_id in actual, but nulls out a hallucinated one", () => {
    const validIds = new Set(["strength_b"]);
    const linked = applySessionReconcile(
      EXISTING,
      [{ session_id: "sess_20260817_1", status: "done", actual: { discipline: "strength", kind: "gym", title: "Strength B", template_id: "strength_b" } }],
      validIds,
      "t2",
      now,
    );
    expect(JSON.parse(linked).days[0].sessions[0].template_id).toBe("strength_b");

    const hallucinated = applySessionReconcile(
      EXISTING,
      [{ session_id: "sess_20260817_1", status: "done", actual: { discipline: "strength", kind: "gym", title: "Strength B", template_id: "made_up" } }],
      validIds,
      "t2",
      now,
    );
    expect(JSON.parse(hallucinated).days[0].sessions[0].template_id).toBeNull();
  });

  it("leaves discipline/kind/title untouched when actual is omitted", () => {
    const content = applySessionReconcile(EXISTING, [{ session_id: "sess_20260817_1", status: "done" }], new Set(), "t2", now);
    const session = JSON.parse(content).days[0].sessions[0];
    expect(session).toMatchObject({ discipline: "run", kind: "easy", title: "Easy 5k" });
  });
});

describe("applyPlanEdit", () => {
  const EXISTING: string = JSON.stringify({
    schema_version: 1,
    data_status: "live",
    timezone: "America/New_York",
    week: { id: "2026-W34", start_date: "2026-08-17", end_date: "2026-08-23", focus: null, guardrails: [] },
    coach_read: { headline: "Steady week ahead.", body: "Focus on consistency.", valid_from: "2026-08-17", valid_until: "2026-08-23" },
    days: [
      {
        date: "2026-08-17",
        intent: null,
        coach_note: null,
        sessions: [
          {
            id: "sess_20260817_1",
            origin: "planned",
            discipline: "football",
            kind: "sport",
            title: "Football",
            priority: "support",
            status: "planned",
            planned_duration_min: null,
            planned_load: null,
            template_id: null,
            session_file: null,
            coach_note: null,
            original_date: null,
            completion_activity_ids: [],
          },
        ],
      },
      ...["2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23"].map((date) => ({
        date,
        intent: null,
        coach_note: null,
        sessions: [],
      })),
    ],
    coach_comments: [],
    updated_at: "2026-08-17T12:00:00.000Z",
    updated_by: "model",
    trace_id: "old",
  });

  const now = new Date("2026-08-18T18:00:00Z");

  it("throws a descriptive error instead of a raw TypeError when days isn't an array", () => {
    const malformed = JSON.stringify({ ...JSON.parse(EXISTING), days: "not-an-array" });
    expect(() =>
      applyPlanEdit(malformed, [{ session_id: "sess_20260817_1", discipline: "badminton", kind: "sport", title: "Badminton" }], new Set(), "t1", now),
    ).toThrow("current_week.json is malformed (days is not an array)");
  });

  it("throws a descriptive error instead of a raw TypeError when a day's sessions isn't an array", () => {
    const parsed = JSON.parse(EXISTING);
    parsed.days[0].sessions = null;
    expect(() =>
      applyPlanEdit(JSON.stringify(parsed), [{ session_id: "sess_20260817_1", discipline: "badminton", kind: "sport", title: "Badminton" }], new Set(), "t1", now),
    ).toThrow("current_week.json is malformed (days[0].sessions is not an array)");
  });

  it("swaps a session's discipline/kind/title, leaving status untouched", () => {
    const content = applyPlanEdit(
      EXISTING,
      [{ session_id: "sess_20260817_1", discipline: "badminton", kind: "sport", title: "Badminton" }],
      new Set(),
      "t1",
      now,
    );
    const session = JSON.parse(content).days[0].sessions[0];
    expect(session).toMatchObject({ discipline: "badminton", kind: "sport", title: "Badminton", status: "planned" });
  });

  it("links a real template_id, but nulls out a hallucinated one", () => {
    const validIds = new Set(["strength_a"]);
    const linked = applyPlanEdit(EXISTING, [{ session_id: "sess_20260817_1", discipline: "strength", kind: "gym", title: "Strength A", template_id: "strength_a" }], validIds, "t1", now);
    expect(JSON.parse(linked).days[0].sessions[0].template_id).toBe("strength_a");

    const hallucinated = applyPlanEdit(EXISTING, [{ session_id: "sess_20260817_1", discipline: "strength", kind: "gym", title: "Strength A", template_id: "made_up" }], validIds, "t1", now);
    expect(JSON.parse(hallucinated).days[0].sessions[0].template_id).toBeNull();
  });

  it("throws with the hallucinated-id message when session_id isn't found across any day", () => {
    expect(() =>
      applyPlanEdit(EXISTING, [{ session_id: "made_up", discipline: "badminton", kind: "sport", title: "Badminton" }], new Set(), "t1", now),
    ).toThrow('no session with id "made_up" in current_week.json');
  });

  it("throws when current_week.json content can't be read", () => {
    expect(() =>
      applyPlanEdit(null, [{ session_id: "sess_20260817_1", discipline: "badminton", kind: "sport", title: "Badminton" }], new Set(), "t1", now),
    ).toThrow("could not be read");
  });

  it("produces schema-valid output", () => {
    const content = applyPlanEdit(EXISTING, [{ session_id: "sess_20260817_1", discipline: "badminton", kind: "sport", title: "Badminton" }], new Set(), "t1", now);
    const runtime = parseCurrentWeek(JSON.parse(content), now);
    expect(runtime.issues).toEqual([]);
    expect(runtime.data).not.toBeNull();
  });
});
