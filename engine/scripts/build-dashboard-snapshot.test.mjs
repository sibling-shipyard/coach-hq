import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
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

test("templates and sessions exclude non-workout files without phases", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-snapshot-"));
  const templatesDir = path.join(root, "user_data", "activities", "workout_plans", "templates");
  const sessionsDir = path.join(root, "user_data", "activities", "workout_plans", "sessions");
  fs.mkdirSync(templatesDir, { recursive: true });
  fs.mkdirSync(sessionsDir, { recursive: true });
  
  const manifest = { template_ids: ["valid-workout"] };
  const dummyNoPhases = { id: "no-phases", title: "Wait this isn't a workout" };
  const validWorkout = { id: "valid-workout", phases: [] };
  const validSession = { id: "valid-session", session_date: new Date().toISOString(), phases: [] };
  
  fs.writeFileSync(path.join(templatesDir, "_manifest.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(templatesDir, "dummy.json"), JSON.stringify(dummyNoPhases));
  fs.writeFileSync(path.join(templatesDir, "valid-workout.json"), JSON.stringify(validWorkout));
  
  fs.writeFileSync(path.join(sessionsDir, "_manifest.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(sessionsDir, "dummy.json"), JSON.stringify(dummyNoPhases));
  fs.writeFileSync(path.join(sessionsDir, "valid-session.json"), JSON.stringify(validSession));
  
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  
  const snapshot = buildDashboardSnapshot(root);
  assert.equal(snapshot.workouts.templates.length, 1);
  assert.equal(snapshot.workouts.templates[0].id, "valid-workout");
  assert.equal(snapshot.workouts.sessions.length, 1);
  assert.equal(snapshot.workouts.sessions[0].id, "valid-session");
});

test("snapshot carries distinct same-day matches and their exact history basenames", (t) => {
  const root = repoWith({});
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const activitiesDir = path.join(root, "user_data", "activities");
  const histDir = path.join(activitiesDir, "hist");
  fs.mkdirSync(histDir, { recursive: true });

  const files = ["hk_first-session.json", "hk_second-session.json"];
  for (const [index, file] of files.entries()) {
    fs.writeFileSync(path.join(histDir, file), JSON.stringify({
      id: index + 1,
      category: "badminton",
      start_date_local: `2026-09-16T${10 + index}:00:00`,
      description: "Display text is not match data",
    }));
  }
  const sessions = files.map((historyFile, index) => ({
    date: "2026-09-16",
    historyFile,
    summary: { wins: index + 1, losses: 0, winPct: 100 },
    games: [{ result: "W", scoreFor: 21, scoreAgainst: 10 + index }],
  }));
  const legacy = { date: "2026-09-16", summary: { wins: 1, losses: 0, winPct: 100 }, games: [] };
  const matchHistory = { version: 1, sessions: [...sessions, legacy] };
  fs.writeFileSync(path.join(activitiesDir, "match_history.json"), JSON.stringify(matchHistory));

  execFileSync(process.execPath, [
    fileURLToPath(new URL("./build-dashboard-snapshot.mjs", import.meta.url)),
    "--dashboard-snapshot", "--repo-root", root,
  ]);
  const snapshot = JSON.parse(fs.readFileSync(path.join(root, "gen", "dashboard_snapshot.json"), "utf-8"));
  assert.deepEqual(snapshot.match_history, matchHistory);
  assert.deepEqual(new Set(snapshot.activities.map((activity) => activity.history_file)), new Set(files));
  assert.deepEqual(
    Object.fromEntries(snapshot.activities.map((activity) => [activity.history_file, activity.id])),
    { [files[0]]: 1, [files[1]]: 2 },
  );
});

test("snapshot emits an empty valid match history when the file is absent", (t) => {
  const root = repoWith({});
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(buildDashboardSnapshot(root).match_history, { version: 1, sessions: [] });
});
