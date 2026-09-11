import assert from "node:assert/strict";
import test from "node:test";
import { classifyDiscipline, qualifiedActivityId, reconcileWeek } from "./reconcile-current-week.mjs";

function week(days) {
  return {
    schema_version: 1,
    data_status: "live",
    timezone: "UTC",
    week: { id: "2026-W34", start_date: "2026-08-17", end_date: "2026-08-23", focus: null, guardrails: [] },
    coach_read: { headline: "h", body: "b", valid_from: "2026-08-17", valid_until: "2026-08-23" },
    days,
    updated_at: "2026-08-17T00:00:00Z",
    updated_by: "model",
    trace_id: "t",
  };
}

function plannedSession(overrides = {}) {
  return {
    id: "sess_20260817_1",
    origin: "planned",
    discipline: "run",
    kind: "easy",
    title: "Easy run",
    priority: "anchor",
    status: "planned",
    planned_duration_min: 30,
    template_id: null,
    session_file: null,
    coach_note: null,
    original_date: null,
    completion_activity_ids: [],
    ...overrides,
  };
}

function activity(overrides = {}) {
  return {
    id: "ABCD-1234",
    name: "Run #12",
    sport_type: "Run",
    start_date_local: "2026-08-17T08:00:00",
    elapsed_time: 1800,
    ...overrides,
  };
}

test("classifyDiscipline: name pattern wins over sport_type", () => {
  assert.equal(classifyDiscipline({ name: "Foundation #3", sport_type: "WeightTraining" }), "foundation");
});

test("classifyDiscipline: WeightTraining falls back to duration heuristic", () => {
  assert.equal(classifyDiscipline({ name: "x", sport_type: "WeightTraining", elapsed_time: 900 }), "foundation");
  assert.equal(classifyDiscipline({ name: "x", sport_type: "WeightTraining", elapsed_time: 3600 }), "weight_training");
});

test("classifyDiscipline: unrecognized sport_type and name falls back to other", () => {
  assert.equal(classifyDiscipline({ name: "Something", sport_type: "Yoga" }), "other");
});

test("qualifiedActivityId: healthkit-prefixed", () => {
  assert.equal(qualifiedActivityId({ id: "XYZ" }), "healthkit:XYZ");
});

test("one matching activity marks the planned session done", () => {
  const w = week([{ date: "2026-08-17", intent: null, coach_note: null, sessions: [plannedSession()] }]);
  const result = reconcileWeek(w, [activity()], "2026-08-18");
  const session = result.days[0].sessions[0];
  assert.equal(session.status, "done");
  assert.deepEqual(session.completion_activity_ids, ["healthkit:ABCD-1234"]);
});

test("no matching activity and the day has passed marks it skipped", () => {
  const w = week([{ date: "2026-08-17", intent: null, coach_note: null, sessions: [plannedSession()] }]);
  const result = reconcileWeek(w, [], "2026-08-18");
  assert.equal(result.days[0].sessions[0].status, "skipped");
});

test("no matching activity but the day is today leaves it planned", () => {
  const w = week([{ date: "2026-08-17", intent: null, coach_note: null, sessions: [plannedSession()] }]);
  const result = reconcileWeek(w, [], "2026-08-17");
  assert.equal(result.days[0].sessions[0].status, "planned");
});

test("two same-discipline candidates flag ambiguity on coach_note, leave status planned", () => {
  const w = week([{ date: "2026-08-17", intent: null, coach_note: null, sessions: [plannedSession()] }]);
  const result = reconcileWeek(
    w,
    [activity({ id: "A" }), activity({ id: "B" })],
    "2026-08-18",
  );
  const session = result.days[0].sessions[0];
  assert.equal(session.status, "planned");
  assert.match(session.coach_note, /Ambiguous/);
});

test("a session chat already marked done or skipped is never touched", () => {
  const w = week([
    {
      date: "2026-08-17",
      intent: null,
      coach_note: null,
      sessions: [plannedSession({ status: "done", discipline: "badminton", completion_activity_ids: ["chat:1"] })],
    },
  ]);
  const result = reconcileWeek(w, [activity()], "2026-08-18");
  assert.deepEqual(result.days[0].sessions[0], w.days[0].sessions[0]);
});

test("an activity with no planned match attaches as a new unplanned session", () => {
  const w = week([{ date: "2026-08-17", intent: null, coach_note: null, sessions: [] }]);
  const result = reconcileWeek(w, [activity()], "2026-08-18");
  assert.equal(result.days[0].sessions.length, 1);
  const session = result.days[0].sessions[0];
  assert.equal(session.origin, "unplanned");
  assert.equal(session.status, "done");
  assert.equal(session.priority, null);
  assert.deepEqual(session.completion_activity_ids, ["healthkit:ABCD-1234"]);
});

test("an activity already claimed by a planned-session match doesn't also attach as unplanned", () => {
  const w = week([{ date: "2026-08-17", intent: null, coach_note: null, sessions: [plannedSession()] }]);
  const result = reconcileWeek(w, [activity()], "2026-08-18");
  assert.equal(result.days[0].sessions.length, 1);
});

test("an activity on a day outside the week's days never attaches anywhere in the week", () => {
  const w = week([{ date: "2026-08-17", intent: null, coach_note: null, sessions: [plannedSession()] }]);
  const result = reconcileWeek(w, [activity({ start_date_local: "2099-01-01T08:00:00" })], "2026-08-17");
  assert.equal(result.days[0].sessions[0].status, "planned");
  assert.equal(result.days[0].sessions.length, 1);
});

test("does not mutate the input week object", () => {
  const w = week([{ date: "2026-08-17", intent: null, coach_note: null, sessions: [plannedSession()] }]);
  const snapshot = JSON.stringify(w);
  reconcileWeek(w, [activity()], "2026-08-18");
  assert.equal(JSON.stringify(w), snapshot);
});

// Regression: an already-done session is skipped by the main pass (status !== "planned"), so its
// activity id has to be seeded into `claimed` from the existing file, not just from matches made
// during this call - otherwise a second run treats it as unclaimed and attaches a duplicate
// unplanned session, forever, on every sync.
test("re-running against an already-reconciled week is a true no-op, no duplicate unplanned sessions", () => {
  const once = reconcileWeek(
    week([{ date: "2026-08-17", intent: null, coach_note: null, sessions: [plannedSession()] }]),
    [activity()],
    "2026-08-18",
  );
  const twice = reconcileWeek(once, [activity()], "2026-08-18");
  assert.deepEqual(twice, once);
  assert.equal(twice.days[0].sessions.length, 1);
});

test("an already-attached unplanned session's activity doesn't get re-attached as a second duplicate", () => {
  const alreadyAttached = week([
    {
      date: "2026-08-17",
      intent: null,
      coach_note: null,
      sessions: [
        {
          id: "sess_20260817_1",
          origin: "unplanned",
          discipline: "run",
          kind: "logged",
          title: "Run #12",
          priority: null,
          status: "done",
          planned_duration_min: null,
          template_id: null,
          session_file: null,
          coach_note: null,
          original_date: null,
          completion_activity_ids: ["healthkit:ABCD-1234"],
        },
      ],
    },
  ]);
  const result = reconcileWeek(alreadyAttached, [activity()], "2026-08-18");
  assert.equal(result.days[0].sessions.length, 1);
});
