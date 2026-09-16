import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const workflowPath = fileURLToPath(new URL("../.github/workflows/rollover.user.yml", import.meta.url));
const workflow = fs.readFileSync(workflowPath, "utf8");

test("daily rollover runs on a schedule and can be dispatched manually", () => {
  assert.match(workflow, /^  workflow_dispatch:\s*$/m);
  assert.match(workflow, /^  schedule:\n    - cron: '[^']+'$/m);
});

test("rollover commits only current_week.json and leaves no-op days clean", () => {
  assert.match(workflow, /\.\/engine\/scripts\/rollover-current-week/);
  assert.match(workflow, /git add user_data\/ledger\/current_week\.json/);
  assert.match(workflow, /git diff --quiet -- user_data\/ledger\/current_week\.json/);
  assert.match(workflow, /changed=false/);
  assert.match(workflow, /skipping derived-data build/);
  assert.doesNotMatch(workflow, /git add -A|git add \.\//);
});

test("an aged rollover rebuilds and commits the derived readers with the week", () => {
  assert.match(workflow, /node engine\/scripts\/build-dashboard-snapshot\.mjs --dashboard-snapshot/);
  assert.match(workflow, /node engine\/scripts\/generate-athlete-insights\.mjs/);
  assert.match(workflow, /git add -f gen\/dashboard_snapshot\.json gen\/athlete_insights\.json/);
  assert.match(workflow, /if: steps\.rollover_current_week\.outputs\.changed == 'true'/g);
});

test("rollover uses the proven Node 24 runtime", () => {
  assert.match(workflow, /node-version: 24/);
});

test("scheduled rollover serializes with data-triggered Sync", () => {
  assert.match(workflow, /group: sync-\$\{\{ github\.ref \}\}/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /permissions:\n  contents: write/);
});

test("rollover failures alert and record without masking the original failure", () => {
  const failure = workflow.split("- name: Record rollover failure", 2)[1];
  assert.ok(failure, "missing rollover failure step");
  assert.match(failure, /if: failure\(\)/);
  assert.match(failure, /SENTRY_DSN: ""/);
  assert.match(failure, /SYNC_OPERATION: rollover/);
  assert.match(failure, /set \+e/);
  assert.match(failure, /python3 engine\/scripts\/notify_sync_failure\.py \\\n\s+\|\|/);
  assert.match(failure, /python3 engine\/scripts\/record_sync_failure\.py/);
  assert.ok(
    failure.indexOf("notify_sync_failure.py") < failure.indexOf("record_sync_failure.py"),
    "the alert must run before the fallback record is pushed",
  );
});
