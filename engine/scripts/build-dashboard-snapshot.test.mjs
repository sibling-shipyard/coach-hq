import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadLedger, buildDashboardSnapshot } from "./build-dashboard-snapshot.mjs";

function repoWith(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-snapshot-"));
  fs.mkdirSync(path.join(root, "user_data/ledger"), { recursive: true });
  for (const [name, value] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, "user_data/ledger", name), JSON.stringify(value));
  }
  return root;
}

test("complete split ledger wins without legacy hybrid", (t) => {
  const files = {
    "seasons.json": { version: 1, seasons: [{ id: "s1" }] },
    "quests.json": { version: 1, main_quest: { id: "main" } },
    "progress.json": { version: 1, rows: [] },
    "progressions.json": { version: 1, progressions: [] },
    "challenge_v2.json": { version: 4, stale: true },
  };
  const root = repoWith(files);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(loadLedger(root), {
    ledger: { seasons: files["seasons.json"], quests: files["quests.json"], progress: files["progress.json"], progressions: files["progressions.json"] },
  });
});

test("partial split ledger falls back to whole unmigrated challenge", (t) => {
  const legacy = { version: 4, main_quest: { id: "main" }, quests: [] };
  const root = repoWith({ "seasons.json": { version: 1 }, "challenge_v2.json": legacy });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(loadLedger(root), { ledger: null });
});

test("templates exclude _manifest.json", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-snapshot-"));
  const templatesDir = path.join(root, "user_data", "activities", "workout_plans", "templates");
  fs.mkdirSync(templatesDir, { recursive: true });
  
  const manifest = { template_ids: ["valid-workout"] };
  const validWorkout = { id: "valid-workout", phases: [] };
  
  fs.writeFileSync(path.join(templatesDir, "_manifest.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(templatesDir, "valid-workout.json"), JSON.stringify(validWorkout));
  
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  
  const snapshot = buildDashboardSnapshot(root);
  assert.equal(snapshot.workouts.templates.length, 1);
  assert.equal(snapshot.workouts.templates[0].id, "valid-workout");
});
