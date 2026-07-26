#!/usr/bin/env node
/**
 * build-data.mjs — Pre-build script: merge athlete data into ui/client/src/data/
 * for Vite, and (with --aggregate) write gen/aggregate.json at repo root.
 *
 * Paths via engine/lib/repo-layout.mjs (user_data/ + gen/ on HQ and user repos).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  aggregatePath,
  histDir,
  ledgerDir,
  questHistoryPath,
  repoRoot,
  sessionsDir,
  sleepLogPath,
  syncStatusPath,
  templatesDir,
} from "../../engine/lib/repo-layout.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = repoRoot(path.join(__dirname, ".."));
const UI_DIR = path.join(REPO_ROOT, "ui");
const OUT_DIR = path.join(UI_DIR, "client", "src", "data");
const SCHEMA_VERSION = 1;

const UNAVAILABLE_CURRENT_WEEK = {
  schema_version: null,
  data_status: "unavailable",
  timezone: "Europe/London",
  week: null,
  coach_read: null,
  days: [],
  coach_comments: [],
  updated_at: null,
  updated_by: "build-data",
};

function buildAggregate() {
  const result = {};

  const historyDir = histDir(REPO_ROOT);
  const existingActivitiesPath = path.join(OUT_DIR, "activities.json");
  if (fs.existsSync(historyDir)) {
    const files = fs.readdirSync(historyDir).filter((f) => f.endsWith(".json"));
    if (files.length === 0) {
      result.activities = fs.existsSync(existingActivitiesPath)
        ? JSON.parse(fs.readFileSync(existingActivitiesPath, "utf-8"))
        : [];
      console.log("✓ activities — no local history files, keeping committed version");
    } else {
      const activities = [];
      for (const file of files) {
        try {
          activities.push(JSON.parse(fs.readFileSync(path.join(historyDir, file), "utf-8")));
        } catch (e) {
          console.warn(`⚠ Skipping ${file}: ${e.message}`);
        }
      }
      activities.sort(
        (a, b) => new Date(b.start_date_local).getTime() - new Date(a.start_date_local).getTime(),
      );
      result.activities = activities;
      console.log(`✓ activities — ${activities.length} activities`);
    }
  } else {
    console.warn(`⚠ No history directory at ${historyDir}`);
    result.activities = [];
  }

  const challengeSrc = path.join(ledgerDir(REPO_ROOT), "challenge_v2.json");
  if (fs.existsSync(challengeSrc)) {
    result.challenge_v2 = JSON.parse(fs.readFileSync(challengeSrc, "utf-8"));
    console.log("✓ challenge_v2 loaded");
  } else {
    console.warn(`⚠ No challenge_v2.json at ${challengeSrc}`);
    result.challenge_v2 = null;
  }

  const currentWeekSrc = path.join(ledgerDir(REPO_ROOT), "current_week.json");
  if (fs.existsSync(currentWeekSrc)) {
    try {
      result.current_week = JSON.parse(fs.readFileSync(currentWeekSrc, "utf-8"));
      console.log("✓ current_week loaded");
    } catch (e) {
      result.current_week = UNAVAILABLE_CURRENT_WEEK;
      console.warn(`⚠ Invalid current_week.json; using unavailable fallback: ${e.message}`);
    }
  } else {
    result.current_week = UNAVAILABLE_CURRENT_WEEK;
    console.warn(`⚠ No current_week.json at ${currentWeekSrc}; using unavailable fallback`);
  }

  const templatesDirPath = templatesDir(REPO_ROOT);
  const sessionsDirPath = sessionsDir(REPO_ROOT);
  const workouts = { templates: [], sessions: [] };

  if (fs.existsSync(templatesDirPath)) {
    for (const file of fs.readdirSync(templatesDirPath).filter((f) => f.endsWith(".json"))) {
      try {
        workouts.templates.push(JSON.parse(fs.readFileSync(path.join(templatesDirPath, file), "utf-8")));
      } catch (e) {
        console.warn(`⚠ Skipping template ${file}: ${e.message}`);
      }
    }
    console.log(`✓ ${workouts.templates.length} workout templates loaded`);
  } else {
    console.warn(`⚠ No templates at ${templatesDirPath}`);
  }

  if (fs.existsSync(sessionsDirPath)) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    let skippedOld = 0;
    for (const file of fs.readdirSync(sessionsDirPath).filter((f) => f.endsWith(".json"))) {
      try {
        const session = JSON.parse(fs.readFileSync(path.join(sessionsDirPath, file), "utf-8"));
        if (session.session_date && session.session_date < cutoffStr) {
          skippedOld++;
          continue;
        }
        workouts.sessions.push(session);
      } catch (e) {
        console.warn(`⚠ Skipping session ${file}: ${e.message}`);
      }
    }
    workouts.sessions.sort((a, b) => (b.session_date ?? "").localeCompare(a.session_date ?? ""));
    console.log(`✓ ${workouts.sessions.length} workout sessions loaded (${skippedOld} older than 7d pruned)`);
  } else {
    console.warn(`⚠ No sessions at ${sessionsDirPath}`);
  }
  result.workouts = workouts;

  const syncStatusSrc = syncStatusPath(REPO_ROOT);
  if (fs.existsSync(syncStatusSrc)) {
    result.sync_status = JSON.parse(fs.readFileSync(syncStatusSrc, "utf-8"));
    console.log("✓ sync_status loaded");
  } else {
    result.sync_status = {
      status: "none",
      timestamp: null,
      activities_synced: 0,
      activities_renamed: 0,
      descriptions_parsed: 0,
      warnings: [],
    };
    console.log("✓ sync_status — no data, using default");
  }

  const sleepLogFile = sleepLogPath(REPO_ROOT);
  result.sleep_log = fs.existsSync(sleepLogFile)
    ? JSON.parse(fs.readFileSync(sleepLogFile, "utf-8"))
    : [];

  const questHistoryFile = questHistoryPath(REPO_ROOT);
  result.quest_history = fs.existsSync(questHistoryFile)
    ? JSON.parse(fs.readFileSync(questHistoryFile, "utf-8"))
    : { generated_at: "", quests: {} };

  result.schema_version = SCHEMA_VERSION;
  result.generated_at = new Date().toISOString();

  return result;
}

fs.mkdirSync(OUT_DIR, { recursive: true });

spawnSync("node", ["scripts/generate-wi-tokens.mjs"], { cwd: UI_DIR, stdio: "inherit" });

const aggregate = buildAggregate();

fs.writeFileSync(path.join(OUT_DIR, "activities.json"), JSON.stringify(aggregate.activities, null, 0));
if (aggregate.challenge_v2) {
  fs.writeFileSync(path.join(OUT_DIR, "challenge_v2.json"), JSON.stringify(aggregate.challenge_v2, null, 2));
}
fs.writeFileSync(path.join(OUT_DIR, "current_week.json"), JSON.stringify(aggregate.current_week, null, 2));
fs.writeFileSync(path.join(OUT_DIR, "workouts.json"), JSON.stringify(aggregate.workouts, null, 2));
fs.writeFileSync(path.join(OUT_DIR, "sync_status.json"), JSON.stringify(aggregate.sync_status, null, 2));

const snapshotResult = spawnSync(
  "npx",
  ["tsx", "--tsconfig", "tsconfig.json", "scripts/generate-widget-snapshots.ts"],
  { cwd: UI_DIR, stdio: "inherit" },
);
if (snapshotResult.status !== 0) {
  console.warn("⚠ widget_snapshots generation failed — continuing build");
}

console.log("✓ Data build complete");

if (process.argv.includes("--aggregate")) {
  const outPath = aggregatePath(REPO_ROOT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(aggregate, null, 0));
  console.log(`✓ ${path.relative(REPO_ROOT, outPath)} written`);
}
