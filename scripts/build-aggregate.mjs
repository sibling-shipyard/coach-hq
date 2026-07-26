#!/usr/bin/env node
/**
 * build-aggregate.mjs — Writes data/aggregate.json for user repos (skeleton sync).
 *
 * Slim extract from ui/scripts/build-data.mjs buildAggregate() — reads training/
 * paths directly (no ui/client/src/data). Matches HQ aggregate shape for the
 * shared dashboard contract (schema_version: 1).
 *
 * Usage:
 *   node scripts/build-aggregate.mjs --aggregate
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
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

  const historyDir = path.join(REPO_ROOT, "training", "activities", "history");
  if (fs.existsSync(historyDir)) {
    const files = fs.readdirSync(historyDir).filter((f) => f.endsWith(".json"));
    if (files.length === 0) {
      result.activities = [];
      console.log("✓ activities — no local history files, using empty array");
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
    console.warn("⚠ No training/activities/history/ directory found");
    result.activities = [];
  }

  const challengeSrc = path.join(REPO_ROOT, "training", "ledger", "challenge_v2.json");
  if (fs.existsSync(challengeSrc)) {
    result.challenge_v2 = JSON.parse(fs.readFileSync(challengeSrc, "utf-8"));
    console.log("✓ challenge_v2 loaded");
  } else {
    console.warn("⚠ No training/ledger/challenge_v2.json found");
    result.challenge_v2 = null;
  }

  const currentWeekSrc = path.join(REPO_ROOT, "training", "ledger", "current_week.json");
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
    console.warn("⚠ No training/ledger/current_week.json found; using unavailable fallback");
  }

  const templatesDir = path.join(REPO_ROOT, "templates");
  const sessionsDir = path.join(REPO_ROOT, "sessions");
  const workouts = { templates: [], sessions: [] };

  if (fs.existsSync(templatesDir)) {
    const files = fs.readdirSync(templatesDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        workouts.templates.push(JSON.parse(fs.readFileSync(path.join(templatesDir, file), "utf-8")));
      } catch (e) {
        console.warn(`⚠ Skipping template ${file}: ${e.message}`);
      }
    }
    console.log(`✓ ${workouts.templates.length} workout templates loaded`);
  }

  if (fs.existsSync(sessionsDir)) {
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".json"));
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7);
    const cutoff = cutoffDate.toISOString().slice(0, 10);
    let skippedOld = 0;

    for (const file of files) {
      try {
        const session = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), "utf-8"));
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

  const syncStatusSrc = path.join(REPO_ROOT, "training", "sync_status.json");
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

  const sleepLogPath = path.join(REPO_ROOT, "training", "activities", "sleep_log.json");
  result.sleep_log = fs.existsSync(sleepLogPath)
    ? JSON.parse(fs.readFileSync(sleepLogPath, "utf-8"))
    : [];

  const questHistoryPath = path.join(REPO_ROOT, "training", "activities", "quest_history.json");
  result.quest_history = fs.existsSync(questHistoryPath)
    ? JSON.parse(fs.readFileSync(questHistoryPath, "utf-8"))
    : { generated_at: "", quests: {} };

  result.schema_version = SCHEMA_VERSION;
  result.generated_at = new Date().toISOString();

  return result;
}

if (!process.argv.includes("--aggregate")) {
  console.error("Usage: node scripts/build-aggregate.mjs --aggregate");
  process.exit(1);
}

const aggregate = buildAggregate();
const aggregateDir = path.join(REPO_ROOT, "data");
fs.mkdirSync(aggregateDir, { recursive: true });
fs.writeFileSync(path.join(aggregateDir, "aggregate.json"), JSON.stringify(aggregate, null, 0));
console.log("✓ data/aggregate.json written");
