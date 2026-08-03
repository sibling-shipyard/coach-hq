#!/usr/bin/env node
/**
 * build-aggregate.mjs — Writes gen/aggregate.json (skeleton) or data/aggregate.json (HQ legacy).
 *
 * Slim extract from ui/scripts/build-data.mjs buildAggregate() — reads athlete data
 * via repo-layout path helpers. Matches HQ aggregate shape for the shared dashboard
 * contract (schema_version: 1).
 *
 * Usage:
 *   node engine/scripts/build-aggregate.mjs --aggregate
 */
import fs from "node:fs";
import path from "node:path";
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
  updated_by: "build-aggregate",
};

function buildAggregate() {
  const result = {};

  const historyDir = histDir(REPO_ROOT);
  if (fs.existsSync(historyDir)) {
    const files = fs.readdirSync(historyDir).filter((f) => f.endsWith(".json"));
    if (files.length === 0) {
      result.activities = [];
      console.log("✓ activities — no local history files, using empty array");
    } else {
      const activities = [];
      for (const file of files) {
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(historyDir, file), "utf-8"));
          activities.push(projectActivity(raw));
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
    console.warn(`⚠ No history directory found at ${historyDir}`);
    result.activities = [];
  }

  const challengeSrc = path.join(ledgerDir(REPO_ROOT), "challenge_v2.json");
  if (fs.existsSync(challengeSrc)) {
    result.challenge_v2 = JSON.parse(fs.readFileSync(challengeSrc, "utf-8"));
    console.log("✓ challenge_v2 loaded");
  } else {
    console.warn(`⚠ No challenge_v2.json found at ${challengeSrc}`);
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
    console.warn(`⚠ No current_week.json found at ${currentWeekSrc}; using unavailable fallback`);
  }

  const templatesDirPath = templatesDir(REPO_ROOT);
  const sessionsDirPath = sessionsDir(REPO_ROOT);
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

  result.plugins = loadPlugins(REPO_ROOT);
  result.badminton_analytics_available = badmintonAnalyticsAvailable(REPO_ROOT);

  result.schema_version = SCHEMA_VERSION;
  result.generated_at = new Date().toISOString();

  return result;
}

if (!process.argv.includes("--aggregate")) {
  console.error("Usage: node engine/scripts/build-aggregate.mjs --aggregate");
  process.exit(1);
}

const aggregate = buildAggregate();
const outPath = aggregatePath(REPO_ROOT);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(aggregate, null, 0));
console.log(`✓ ${path.relative(REPO_ROOT, outPath)} written`);
