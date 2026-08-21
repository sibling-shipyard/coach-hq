#!/usr/bin/env node
/**
 * build-dashboard-snapshot.mjs — Writes the dashboard's generated data bundle.
 *
 * Reads athlete data via repo-layout path helpers. Matches the HQ snapshot shape for the shared dashboard
 * contract (schema_version: 1). A complete split ledger is atomic: partial split files are
 * ignored, and the legacy challenge_v2 fallback is used whole when available.
 *
 * Usage:
 *   node engine/scripts/build-dashboard-snapshot.mjs --dashboard-snapshot
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  dashboardSnapshotPath,
  histDir,
  ledgerDir,
  questHistoryPath,
  repoRoot,
  sessionsDir,
  sleepLogPath,
  syncStatusPath,
  templatesDir,
} from "../lib/repo-layout.mjs";
import { badmintonAnalyticsAvailable, loadPlugins } from "../lib/plugins.mjs";
import { projectActivity } from "../lib/projectActivity.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = repoRoot(__dirname);
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
  updated_by: "build-dashboard-snapshot",
  trace_id: "build-dashboard-snapshot",
};

export function loadActivities(repoRootPath) {
  const historyDir = histDir(repoRootPath);
  if (!fs.existsSync(historyDir)) return [];
  const activities = [];
  for (const file of fs.readdirSync(historyDir).filter((f) => f.endsWith(".json"))) {
    try {
      activities.push(projectActivity(JSON.parse(fs.readFileSync(path.join(historyDir, file), "utf-8"))));
    } catch (e) {
      console.warn(`⚠ Skipping ${file}: ${e.message}`);
    }
  }
  activities.sort((a, b) => new Date(b.start_date_local).getTime() - new Date(a.start_date_local).getTime());
  return activities;
}

export function loadLedger(repoRootPath) {
  const directory = ledgerDir(repoRootPath);
  const names = ["seasons", "quests", "progress", "progressions"];
  const paths = names.map((name) => path.join(directory, `${name}.json`));
  if (paths.every((file) => fs.existsSync(file))) {
    return {
      ledger_schema: "split_v1",
      ledger: Object.fromEntries(names.map((name, index) => [name, JSON.parse(fs.readFileSync(paths[index], "utf-8"))])),
      challenge_v2: null,
    };
  }
  const legacyPath = path.join(directory, "challenge_v2.json");
  if (fs.existsSync(legacyPath)) {
    return {
      ledger_schema: "challenge_v2_v4",
      ledger: null,
      challenge_v2: JSON.parse(fs.readFileSync(legacyPath, "utf-8")),
    };
  }
  return { ledger_schema: "unavailable", ledger: null, challenge_v2: null };
}

export function buildDashboardSnapshot(repoRootPath = REPO_ROOT) {
  const result = {};

  const historyDir = histDir(repoRootPath);
  if (fs.existsSync(historyDir)) {
    const files = fs.readdirSync(historyDir).filter((f) => f.endsWith(".json"));
    if (files.length === 0) {
      result.activities = [];
      console.log("✓ activities — no local history files, using empty array");
    } else {
      const activities = loadActivities(repoRootPath);
      result.activities = activities;
      console.log(`✓ activities — ${activities.length} activities`);
    }
  } else {
    console.warn(`⚠ No history directory found at ${historyDir}`);
    result.activities = [];
  }

  Object.assign(result, loadLedger(repoRootPath));

  const currentWeekSrc = path.join(ledgerDir(repoRootPath), "current_week.json");
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
    console.warn(`⚠ No current_week.json found at ${currentWeekSrc}; using unavailable fallback`);
  }

  const templatesDirPath = templatesDir(repoRootPath);
  const sessionsDirPath = sessionsDir(repoRootPath);
  const workouts = { templates: [], sessions: [] };

  if (fs.existsSync(templatesDirPath)) {
    const files = fs.readdirSync(templatesDirPath).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        workouts.templates.push(JSON.parse(fs.readFileSync(path.join(templatesDirPath, file), "utf-8")));
      } catch (e) {
        console.warn(`⚠ Skipping template ${file}: ${e.message}`);
      }
    }
    console.log(`✓ ${workouts.templates.length} workout templates loaded`);
  }

  if (fs.existsSync(sessionsDirPath)) {
    const files = fs.readdirSync(sessionsDirPath).filter((f) => f.endsWith(".json"));
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7);
    const cutoff = cutoffDate.toISOString().slice(0, 10);
    let skippedOld = 0;

    for (const file of files) {
      try {
        const session = JSON.parse(fs.readFileSync(path.join(sessionsDirPath, file), "utf-8"));
        if (session.session_date && session.session_date < cutoff) {
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
  }
  result.workouts = workouts;

  const syncStatusSrc = syncStatusPath(repoRootPath);
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

  const sleepLogFile = sleepLogPath(repoRootPath);
  result.sleep_log = fs.existsSync(sleepLogFile)
    ? JSON.parse(fs.readFileSync(sleepLogFile, "utf-8"))
    : [];

  const questHistoryFile = questHistoryPath(repoRootPath);
  result.quest_history = fs.existsSync(questHistoryFile)
    ? JSON.parse(fs.readFileSync(questHistoryFile, "utf-8"))
    : { generated_at: "", quests: {} };

  result.plugins = loadPlugins(repoRootPath);
  result.badminton_analytics_available = badmintonAnalyticsAvailable(repoRootPath);

  result.schema_version = SCHEMA_VERSION;
  result.generated_at = new Date().toISOString();

  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes("--dashboard-snapshot")) {
    console.error("Usage: node engine/scripts/build-dashboard-snapshot.mjs --dashboard-snapshot");
    process.exit(1);
  }
  const rootFlag = process.argv.indexOf("--repo-root");
  const runtimeRoot = rootFlag >= 0 && process.argv[rootFlag + 1] ? path.resolve(process.argv[rootFlag + 1]) : REPO_ROOT;
  const snapshot = buildDashboardSnapshot(runtimeRoot);
  const outPath = dashboardSnapshotPath(runtimeRoot);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 0));
  console.log(`✓ ${path.relative(runtimeRoot, outPath)} written`);
}
