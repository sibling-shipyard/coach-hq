import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildDashboardSnapshot } from "./build-dashboard-snapshot.mjs";
import { main as reconcileCurrentWeek } from "./reconcile-current-week.mjs";
import { main as rolloverCurrentWeek } from "./rollover-current-week.mjs";

const workflowPath = fileURLToPath(new URL("../.github/workflows/sync.user.yml", import.meta.url));
const workflow = fs.readFileSync(workflowPath, "utf8");

function step(name) {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, `missing ${name} step`);
  const end = workflow.indexOf("      - name: ", start + 1);
  return workflow.slice(start, end === -1 ? undefined : end);
}

function assertOrder(source, commands) {
  let previous = -1;
  for (const command of commands) {
    const next = source.indexOf(command, previous + 1);
    assert.ok(next > previous, `${command} must follow ${commands[commands.indexOf(command) - 1] ?? "the start"}`);
    previous = next;
  }
}

test("a profile or workout file alone triggers Sync and reaches the snapshot build", () => {
  const push = workflow.split("  push:\n", 2)[1]?.split("\npermissions:", 1)[0];
  assert.ok(push, "missing push trigger");
  const paths = [...push.matchAll(/^      - '([^']+)'$/gm)].map((match) => match[1]);
  for (const expected of [
    "user_data/activities/hist/**",
    "user_data/activities/workout_plans/templates/**",
    "user_data/activities/workout_plans/sessions/**",
    "user_data/ledger/**",
    "user_data/coach/profile.json",
    "user_data/coach/sleep_log.json",
  ]) {
    assert.ok(paths.includes(expected), `${expected} must trigger Sync`);
  }
  assert.match(push, /branches: \[main\]/);
  assert.match(workflow, /^  workflow_dispatch:$/m);
  assert.doesNotMatch(step("Build dashboard snapshot and athlete insights"), /^        if:/m);
});

test("normal Sync builds the snapshot after reconciliation and rollover", () => {
  assertOrder(workflow, [
    "      - name: Run pipeline\n",
    "      - name: Reconcile current week\n",
    "      - name: Roll over an aged-out current week\n",
    "      - name: Build dashboard snapshot and athlete insights\n",
    "      - name: Commit pipeline changes\n",
  ]);
  const build = step("Build dashboard snapshot and athlete insights");
  assert.match(build, /node engine\/scripts\/build-dashboard-snapshot\.mjs --dashboard-snapshot/);
  assert.match(build, /node engine\/scripts\/generate-athlete-insights\.mjs/);
});

test("push retry regenerates the snapshot after both week updates", () => {
  const commit = step("Commit pipeline changes");
  const retry = commit.split("for attempt in 1 2 3; do", 2)[1];
  assert.ok(retry, "missing retry path");
  assertOrder(retry, [
    "git reset --hard origin/main",
    "python3 engine/scripts/regenerate_derived.py",
    "./engine/scripts/reconcile-current-week",
    "./engine/scripts/rollover-current-week",
    "node engine/scripts/build-dashboard-snapshot.mjs --dashboard-snapshot",
    "node engine/scripts/generate-athlete-insights.mjs",
    "git add -f gen/dashboard_snapshot.json gen/athlete_insights.json",
  ]);
});

test("snapshot carries the reconciled week and the later rolled-over week", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sync-workflow-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ledger = path.join(root, "user_data/ledger");
  const hist = path.join(root, "user_data/activities/hist");
  fs.mkdirSync(ledger, { recursive: true });
  fs.mkdirSync(hist, { recursive: true });
  const dates = Array.from({ length: 7 }, (_, i) => `2026-08-${String(17 + i).padStart(2, "0")}`);
  const week = {
    schema_version: 1,
    data_status: "live",
    timezone: "UTC",
    week: { id: "2026-W34", start_date: dates[0], end_date: dates[6], focus: null, guardrails: [] },
    coach_read: { headline: "h", body: "b", valid_from: dates[0], valid_until: dates[6] },
    days: dates.map((date) => ({ date, intent: null, coach_note: null, sessions: [] })),
    updated_at: "2026-08-17T00:00:00Z",
    updated_by: "model",
    trace_id: "t",
  };
  week.days[0].sessions.push({
    id: "sess_20260817_1", origin: "planned", discipline: "run", kind: "easy", title: "Easy run",
    priority: "anchor", status: "planned", planned_duration_min: 30, template_id: null,
    session_file: null, coach_note: null, original_date: null, completion_activity_ids: [],
  });
  const weekFile = path.join(ledger, "current_week.json");
  fs.writeFileSync(weekFile, JSON.stringify(week));
  fs.writeFileSync(path.join(hist, "run.json"), JSON.stringify({
    id: "run-1", name: "Run #1", sport_type: "Run", start_date_local: "2026-08-17T08:00:00",
    elapsed_time: 1800,
  }));

  const duringWeek = new Date("2026-08-20T12:00:00Z");
  reconcileCurrentWeek(root, duringWeek);
  rolloverCurrentWeek(root, duringWeek);
  let snapshot = buildDashboardSnapshot(root);
  assert.deepEqual(snapshot.current_week, JSON.parse(fs.readFileSync(weekFile, "utf8")));
  assert.equal(snapshot.current_week.days[0].sessions[0].status, "done");

  const afterWeek = new Date("2026-09-01T12:00:00Z");
  reconcileCurrentWeek(root, afterWeek);
  rolloverCurrentWeek(root, afterWeek);
  snapshot = buildDashboardSnapshot(root);
  assert.deepEqual(snapshot.current_week, JSON.parse(fs.readFileSync(weekFile, "utf8")));
  assert.equal(snapshot.current_week.updated_by, "rollover");
  assert.equal(snapshot.current_week.week.start_date, "2026-08-31");
});
