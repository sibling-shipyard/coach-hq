import { describe, it, expect } from "vitest";
import {
  applyWeekUpdate,
  assertCurrentWeekCommitReady,
  weekSessionsFromCurrentWeek,
  CURRENT_WEEK_PATH,
  type WeekUpdate,
} from "../../_lib/decide/coachWeekFiles.js";
import { parseCurrentWeek } from "../../../../../engine/lib/current-week.mts";

// ADR 0042: week_update replaces week_plan/session_reconcile/plan_edit. Covers the bookkeeping a
// full-week-kickoff computes (week id/bounds, session ids, coach_read window), the Monday/7-day
// guards, the lenient template_id/discipline-nulling judgment calls, and a patch's upsert-by-id
// behavior plus its throw-on-hallucinated-id discipline (mirrors applyQuestEvent).

function validKickoff(overrides: Partial<WeekUpdate> = {}): WeekUpdate {
  const days = [
    "2026-08-17",
    "2026-08-18",
    "2026-08-19",
    "2026-08-20",
    "2026-08-21",
    "2026-08-22",
    "2026-08-23",
  ].map((date, i) => ({
    date,
    intent: i === 0 ? "Build" : null,
    sessions:
      i === 0
        ? [
            {
              discipline: "run",
              kind: "easy",
              title: "Easy 5k",
              priority: "anchor" as const,
              planned_duration_min: 30,
              template_id: "strength_b",
            },
          ]
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

const EXISTING: string = JSON.stringify({
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
          discipline: "run",
          kind: "easy",
          title: "Easy 5k",
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
  trace_id: "old",
});

const now = new Date("2026-08-18T18:00:00Z");

describe("CURRENT_WEEK_PATH", () => {
  it("points at the ledger path", () => {
    expect(CURRENT_WEEK_PATH).toBe("user_data/ledger/current_week.json");
  });
});

describe("assertCurrentWeekCommitReady", () => {
  it("returns the same string when the file is schema-valid", () => {
    const content = applyWeekUpdate(
      null,
      validKickoff(),
      new Set(["strength_b"]),
      "America/New_York",
      "t1",
      now,
    );
    expect(assertCurrentWeekCommitReady(content, now)).toBe(content);
  });

  it("rejects invalid JSON and never treats it as success", () => {
    expect(() => assertCurrentWeekCommitReady("{not json", now)).toThrow("not valid JSON");
  });

  it("rejects a missing required field and never treats it as success", () => {
    const valid = JSON.parse(
      applyWeekUpdate(null, validKickoff(), new Set(["strength_b"]), "America/New_York", "t1", now),
    );
    delete valid.updated_by;
    expect(() => assertCurrentWeekCommitReady(JSON.stringify(valid), now)).toThrow(
      /failed validation:.*updated_by/,
    );
  });
});

describe("applyWeekUpdate - full-week kickoff", () => {
  const validTemplateIds = new Set(["strength_b"]);

  it("computes week id/bounds and session bookkeeping, and produces schema-valid output", () => {
    const content = applyWeekUpdate(
      null,
      validKickoff(),
      validTemplateIds,
      "America/New_York",
      "t1",
      now,
    );
    const parsed = JSON.parse(content);
    expect(parsed.week).toMatchObject({
      id: "2026-W34",
      start_date: "2026-08-17",
      end_date: "2026-08-23",
      focus: "Base building",
    });
    expect(parsed.days).toHaveLength(7);
    const firstSession = parsed.days[0].sessions[0];
    expect(firstSession.id).toBe("sess_20260817_1");
    expect(firstSession).toMatchObject({
      origin: "planned",
      status: "planned",
      session_file: null,
      template_id: "strength_b",
    });
    expect(parsed.coach_read).toMatchObject({
      headline: "Steady week ahead.",
      valid_until: "2026-08-23",
    });
    expect(parsed.updated_by).toBe("model");
    expect(parsed.trace_id).toBe("t1");

    const runtime = parseCurrentWeek(parsed, now);
    expect(runtime.issues).toEqual([]);
    expect(runtime.data).not.toBeNull();
  });

  it("defaults a session's priority to support when Gemini leaves it blank", () => {
    const kickoff = validKickoff();
    delete (kickoff.days[0].sessions![0] as any).priority;
    const content = applyWeekUpdate(null, kickoff, validTemplateIds, "America/New_York", "t1", now);
    const parsed = JSON.parse(content);
    expect(parsed.days[0].sessions[0].priority).toBe("support");
  });

  it("nulls out a hallucinated template_id instead of throwing", () => {
    const kickoff = validKickoff();
    kickoff.days[0].sessions![0].template_id = "made_up_id";
    const content = applyWeekUpdate(null, kickoff, validTemplateIds, "America/New_York", "t1", now);
    const parsed = JSON.parse(content);
    expect(parsed.days[0].sessions[0].template_id).toBeNull();
  });

  it("coerces an unrecognized discipline string to other instead of throwing", () => {
    const kickoff = validKickoff();
    kickoff.days[0].sessions![0].discipline = "underwater basket weaving";
    const content = applyWeekUpdate(null, kickoff, validTemplateIds, "America/New_York", "t1", now);
    expect(JSON.parse(content).days[0].sessions[0].discipline).toBe("other");
  });

  it("throws when days isn't exactly 7", () => {
    const kickoff = validKickoff();
    kickoff.days = kickoff.days.slice(0, 6);
    expect(() =>
      applyWeekUpdate(null, kickoff, validTemplateIds, "America/New_York", "t1", now),
    ).toThrow("expected exactly 7 days");
  });

  it("throws when headline or body is missing", () => {
    const kickoff = validKickoff({ headline: "" });
    expect(() =>
      applyWeekUpdate(null, kickoff, validTemplateIds, "America/New_York", "t1", now),
    ).toThrow("headline and body are required");
  });

  it("throws when the first day isn't a Monday", () => {
    const kickoff = validKickoff();
    kickoff.days[0] = { ...kickoff.days[0], date: "2026-08-18" };
    expect(() =>
      applyWeekUpdate(null, kickoff, validTemplateIds, "America/New_York", "t1", now),
    ).toThrow("must be a Monday");
  });

  it("throws when days aren't consecutive from Monday", () => {
    const kickoff = validKickoff();
    kickoff.days[3] = { ...kickoff.days[3], date: "2026-08-25" };
    expect(() =>
      applyWeekUpdate(null, kickoff, validTemplateIds, "America/New_York", "t1", now),
    ).toThrow("must be consecutive from Monday");
  });

  it("throws when a day date isn't a real date", () => {
    const kickoff = validKickoff();
    kickoff.days[0] = { ...kickoff.days[0], date: "not-a-date" };
    expect(() =>
      applyWeekUpdate(null, kickoff, validTemplateIds, "America/New_York", "t1", now),
    ).toThrow("not a real YYYY-MM-DD date");
  });

  it("throws when a kickoff session is missing discipline/kind/title", () => {
    const kickoff = validKickoff();
    delete (kickoff.days[0].sessions![0] as any).kind;
    expect(() =>
      applyWeekUpdate(null, kickoff, validTemplateIds, "America/New_York", "t1", now),
    ).toThrow("needs discipline, kind, and title");
  });

  // Review finding (P0): the JSON schema only requires `days`, so Gemini can legally send a
  // real kickoff attempt with headline/body omitted. Routing that to patch mode against a null
  // `content` used to throw "current_week.json could not be read" - confusing, and not the real
  // problem. isFullWeekKickoff's 7-day fallback signal must still route this to the kickoff
  // applier, which gives the correct, specific error.
  it("still routes a kickoff-shaped payload missing headline/body to the kickoff applier, not patch mode", () => {
    const kickoff = validKickoff();
    delete (kickoff as any).headline;
    delete (kickoff as any).body;
    expect(() =>
      applyWeekUpdate(null, kickoff, validTemplateIds, "America/New_York", "t1", now),
    ).toThrow("headline and body are required");
  });
});

describe("applyWeekUpdate - patch (status, content, moves)", () => {
  it("throws when current_week.json content can't be read", () => {
    expect(() =>
      applyWeekUpdate(
        null,
        {
          days: [
            { date: "2026-08-17", sessions: [{ session_id: "sess_20260817_1", status: "done" }] },
          ],
        },
        new Set(),
        "America/New_York",
        "t1",
        now,
      ),
    ).toThrow("current_week.json could not be read");
  });

  it("throws a descriptive error instead of a raw TypeError when days isn't an array", () => {
    const malformed = JSON.stringify({ ...JSON.parse(EXISTING), days: "not-an-array" });
    expect(() =>
      applyWeekUpdate(
        malformed,
        {
          days: [
            { date: "2026-08-17", sessions: [{ session_id: "sess_20260817_1", status: "done" }] },
          ],
        },
        new Set(),
        "America/New_York",
        "t1",
        now,
      ),
    ).toThrow("current_week.json is malformed (days is not an array)");
  });

  it("throws a descriptive error instead of a raw TypeError when a day's sessions isn't an array", () => {
    const parsed = JSON.parse(EXISTING);
    parsed.days[0].sessions = null;
    expect(() =>
      applyWeekUpdate(
        JSON.stringify(parsed),
        {
          days: [
            { date: "2026-08-17", sessions: [{ session_id: "sess_20260817_1", status: "done" }] },
          ],
        },
        new Set(),
        "America/New_York",
        "t1",
        now,
      ),
    ).toThrow("current_week.json is malformed (days[0].sessions is not an array)");
  });

  it("throws when the target day isn't in the current week", () => {
    expect(() =>
      applyWeekUpdate(
        EXISTING,
        {
          days: [
            { date: "2099-01-01", sessions: [{ session_id: "sess_20260817_1", status: "done" }] },
          ],
        },
        new Set(),
        "America/New_York",
        "t1",
        now,
      ),
    ).toThrow('no day "2099-01-01" in the current week');
  });

  it("throws with the hallucinated-id message when session_id isn't found across any day", () => {
    expect(() =>
      applyWeekUpdate(
        EXISTING,
        { days: [{ date: "2026-08-17", sessions: [{ session_id: "made_up", status: "done" }] }] },
        new Set(),
        "America/New_York",
        "t1",
        now,
      ),
    ).toThrow('no session with id "made_up" in current_week.json');
  });

  it("fails the whole call when one entry in the batch has a bad id (no partial patch)", () => {
    expect(() =>
      applyWeekUpdate(
        EXISTING,
        {
          days: [
            {
              date: "2026-08-17",
              sessions: [
                { session_id: "sess_20260817_1", status: "done" },
                { session_id: "bad", status: "done" },
              ],
            },
          ],
        },
        new Set(),
        "America/New_York",
        "t1",
        now,
      ),
    ).toThrow('no session with id "bad"');
  });

  it("patches status and qualifies activity_ids with chat: prefix, leaving everything else untouched", () => {
    const content = applyWeekUpdate(
      EXISTING,
      {
        days: [
          {
            date: "2026-08-17",
            sessions: [{ session_id: "sess_20260817_1", status: "done", activity_ids: ["abc123"] }],
          },
        ],
      },
      new Set(),
      "America/New_York",
      "t2",
      now,
    );
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
    const content = applyWeekUpdate(
      EXISTING,
      {
        days: [
          {
            date: "2026-08-17",
            sessions: [
              { session_id: "sess_20260817_1", status: "done", activity_ids: ["healthkit:xyz"] },
            ],
          },
        ],
      },
      new Set(),
      "America/New_York",
      "t2",
      now,
    );
    expect(JSON.parse(content).days[0].sessions[0].completion_activity_ids).toEqual([
      "healthkit:xyz",
    ]);
  });

  it("clears completion_activity_ids for a skipped session even if activity_ids was passed", () => {
    const content = applyWeekUpdate(
      EXISTING,
      {
        days: [
          {
            date: "2026-08-17",
            sessions: [{ session_id: "sess_20260817_1", status: "skipped", activity_ids: ["abc"] }],
          },
        ],
      },
      new Set(),
      "America/New_York",
      "t2",
      now,
    );
    const parsed = JSON.parse(content);
    expect(parsed.days[0].sessions[0].status).toBe("skipped");
    expect(parsed.days[0].sessions[0].completion_activity_ids).toEqual([]);
  });

  it("produces schema-valid output", () => {
    const content = applyWeekUpdate(
      EXISTING,
      {
        days: [
          { date: "2026-08-17", sessions: [{ session_id: "sess_20260817_1", status: "done" }] },
        ],
      },
      new Set(),
      "America/New_York",
      "t2",
      now,
    );
    const runtime = parseCurrentWeek(JSON.parse(content), now);
    expect(runtime.issues).toEqual([]);
    expect(runtime.data).not.toBeNull();
  });

  it("treats malformed JSON as unreadable, throwing rather than silently starting empty", () => {
    expect(() =>
      applyWeekUpdate(
        "{not valid json",
        {
          days: [
            { date: "2026-08-17", sessions: [{ session_id: "sess_20260817_1", status: "done" }] },
          ],
        },
        new Set(),
        "America/New_York",
        "t1",
        now,
      ),
    ).toThrow("could not be read");
  });

  // actual-differs-from-plan: relabels a session to what really happened, alongside the status
  // patch - one entry, not two, is the whole point of ADR 0042's collapse.
  it("relabels discipline/kind/title alongside the status patch, in one entry", () => {
    const content = applyWeekUpdate(
      EXISTING,
      {
        days: [
          {
            date: "2026-08-17",
            sessions: [
              {
                session_id: "sess_20260817_1",
                status: "done",
                discipline: "badminton",
                kind: "sport",
                title: "Badminton",
              },
            ],
          },
        ],
      },
      new Set(),
      "America/New_York",
      "t2",
      now,
    );
    const session = JSON.parse(content).days[0].sessions[0];
    expect(session).toMatchObject({
      status: "done",
      discipline: "badminton",
      kind: "sport",
      title: "Badminton",
    });
  });

  it("swaps a session's discipline/kind/title, leaving status untouched", () => {
    const content = applyWeekUpdate(
      EXISTING,
      {
        days: [
          {
            date: "2026-08-17",
            sessions: [
              {
                session_id: "sess_20260817_1",
                discipline: "badminton",
                kind: "sport",
                title: "Badminton",
              },
            ],
          },
        ],
      },
      new Set(),
      "America/New_York",
      "t1",
      now,
    );
    const session = JSON.parse(content).days[0].sessions[0];
    expect(session).toMatchObject({
      discipline: "badminton",
      kind: "sport",
      title: "Badminton",
      status: "planned",
    });
  });

  it("links a real template_id, but nulls out a hallucinated one", () => {
    const validIds = new Set(["strength_a"]);
    const linked = applyWeekUpdate(
      EXISTING,
      {
        days: [
          {
            date: "2026-08-17",
            sessions: [{ session_id: "sess_20260817_1", template_id: "strength_a" }],
          },
        ],
      },
      validIds,
      "America/New_York",
      "t1",
      now,
    );
    expect(JSON.parse(linked).days[0].sessions[0].template_id).toBe("strength_a");

    const hallucinated = applyWeekUpdate(
      EXISTING,
      {
        days: [
          {
            date: "2026-08-17",
            sessions: [{ session_id: "sess_20260817_1", template_id: "made_up" }],
          },
        ],
      },
      validIds,
      "America/New_York",
      "t1",
      now,
    );
    expect(JSON.parse(hallucinated).days[0].sessions[0].template_id).toBeNull();
  });

  it("leaves discipline/kind/title untouched when only status is patched", () => {
    const content = applyWeekUpdate(
      EXISTING,
      {
        days: [
          { date: "2026-08-17", sessions: [{ session_id: "sess_20260817_1", status: "done" }] },
        ],
      },
      new Set(),
      "America/New_York",
      "t2",
      now,
    );
    const session = JSON.parse(content).days[0].sessions[0];
    expect(session).toMatchObject({ discipline: "run", kind: "easy", title: "Easy 5k" });
  });

  it("creates a new planned session on a day with no session_id", () => {
    const content = applyWeekUpdate(
      EXISTING,
      {
        days: [
          {
            date: "2026-08-19",
            sessions: [{ discipline: "cycling", kind: "endurance", title: "Easy spin" }],
          },
        ],
      },
      new Set(),
      "America/New_York",
      "t1",
      now,
    );
    const day = JSON.parse(content).days.find((d: any) => d.date === "2026-08-19");
    expect(day.sessions).toHaveLength(1);
    expect(day.sessions[0]).toMatchObject({
      origin: "planned",
      status: "planned",
      discipline: "cycling",
      title: "Easy spin",
    });
  });

  it("throws when a new session is missing discipline/kind/title", () => {
    expect(() =>
      applyWeekUpdate(
        EXISTING,
        { days: [{ date: "2026-08-19", sessions: [{ title: "Easy spin" }] }] },
        new Set(),
        "America/New_York",
        "t1",
        now,
      ),
    ).toThrow("needs discipline, kind, and title");
  });

  // The finding this move_to_date field fixes (ADR 0042): a move used to need two separate
  // action-field entries (mark the old day's session done as "actually X", plan a new session on
  // the new day) with no way to express "this session simply relocated."
  it("moves a session to a different day, stamping original_date on the target", () => {
    const content = applyWeekUpdate(
      EXISTING,
      {
        days: [
          {
            date: "2026-08-17",
            sessions: [{ session_id: "sess_20260817_1", move_to_date: "2026-08-19" }],
          },
        ],
      },
      new Set(),
      "America/New_York",
      "t1",
      now,
    );
    const parsed = JSON.parse(content);
    const sourceDay = parsed.days.find((d: any) => d.date === "2026-08-17");
    const targetDay = parsed.days.find((d: any) => d.date === "2026-08-19");
    expect(sourceDay.sessions).toHaveLength(0);
    expect(targetDay.sessions).toHaveLength(1);
    expect(targetDay.sessions[0]).toMatchObject({
      id: "sess_20260817_1",
      original_date: "2026-08-17",
    });
  });

  it("throws when move_to_date targets a day outside the current week", () => {
    expect(() =>
      applyWeekUpdate(
        EXISTING,
        {
          days: [
            {
              date: "2026-08-17",
              sessions: [{ session_id: "sess_20260817_1", move_to_date: "2099-01-01" }],
            },
          ],
        },
        new Set(),
        "America/New_York",
        "t1",
        now,
      ),
    ).toThrow('move_to_date "2099-01-01" is not in the current week');
  });
});

// parseJsonOrNull is an unchecked cast, not parseCurrentWeek's schema validator, so a session's
// discipline/kind can be missing at runtime despite CurrentWeekSession's type declaring both
// required - validateActions.ts's content-diff guard calls .trim() on them unconditionally, so
// this must always hand back a real string.
describe("weekSessionsFromCurrentWeek", () => {
  it("falls back to an empty string for a session missing discipline/kind, instead of undefined", () => {
    const content = JSON.stringify({
      days: [
        {
          date: "2026-09-10",
          sessions: [{ id: "s1", title: "Untitled", status: "planned" }],
        },
      ],
    });
    const sessions = weekSessionsFromCurrentWeek(content);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].discipline).toBe("");
    expect(sessions[0].kind).toBe("");
  });

  it("passes through a well-formed session's real discipline/kind", () => {
    const content = JSON.stringify({
      days: [
        {
          date: "2026-09-10",
          sessions: [
            {
              id: "s1",
              title: "Football",
              status: "planned",
              discipline: "football",
              kind: "match",
            },
          ],
        },
      ],
    });
    const sessions = weekSessionsFromCurrentWeek(content);
    expect(sessions[0].discipline).toBe("football");
    expect(sessions[0].kind).toBe("match");
  });
});
