#!/usr/bin/env node
/**
 * build-data.mjs — Pre-build script that merges data/ files into client/src/data/
 * for Vite to bundle, and (with --aggregate) into a single committed
 * data/aggregate.json at the repo root for the hosted shared site to fetch.
 *
 * Reads:
 *   data/history/*.json    → activities (sorted newest-first)
 *   data/challenge_v2.json   → challenge_v2 (copy)
 *   training/ledger/current_week.json   → current_week (validated copy, or "unavailable" fallback)
 *   data/templates/*.json  → workouts.templates
 *   data/sessions/*.json   → workouts.sessions (session overrides template for same date+id)
 *   data/sync_status.json  → sync_status (copy, default if missing)
 *   client/src/data/sleep_log.json, quest_history.json → carried through as-is (not
 *     produced by any pipeline yet, just committed placeholders)
 *
 * Run before `vite build` or `vite dev` (writes client/src/data/*.json, unchanged
 * behavior). Run with --aggregate (from a personal repo's sync.yml, not this
 * template) to additionally write data/aggregate.json at the repo root.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const UI_DIR = path.join(REPO_ROOT, "ui");
const OUT_DIR = path.join(REPO_ROOT, "ui", "client", "src", "data");
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

/**
 * Builds the merged data object in memory. Pure - no filesystem writes.
 * Reused by both the build-time bundling path below and --aggregate.
 */
function buildAggregate() {
  const result = {};

  // 1. Merge history/*.json → activities
  const historyDir = path.join(REPO_ROOT, "training", "activities", "history");
  const existingActivitiesPath = path.join(OUT_DIR, "activities.json");
  if (fs.existsSync(historyDir)) {
    const files = fs.readdirSync(historyDir).filter((f) => f.endsWith(".json"));
    if (files.length === 0) {
      // No local history files (e.g. CI checkout with only .gitkeep) - keep whatever's
      // already committed rather than overwriting with an empty array.
      result.activities = fs.existsSync(existingActivitiesPath)
        ? JSON.parse(fs.readFileSync(existingActivitiesPath, "utf-8"))
        : [];
      console.log(`✓ activities — no local history files, keeping committed version`);
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
        (a, b) => new Date(b.start_date_local).getTime() - new Date(a.start_date_local).getTime()
      );
      result.activities = activities;
      console.log(`✓ activities — ${activities.length} activities`);
    }
  } else {
    console.warn("⚠ No data/history/ directory found");
    result.activities = [];
  }

  // 2. challenge_v2.json
  const challengeSrc = path.join(REPO_ROOT, "training", "ledger", "challenge_v2.json");
  if (fs.existsSync(challengeSrc)) {
    result.challenge_v2 = JSON.parse(fs.readFileSync(challengeSrc, "utf-8"));
    console.log("✓ challenge_v2 loaded");
  } else {
    console.warn("⚠ No data/challenge_v2.json found");
    result.challenge_v2 = null;
  }

  // 3. current_week.json — validated copy, or an "unavailable" fallback shape.
  const currentWeekSrc = path.join(REPO_ROOT, "training", "ledger", "current_week.json");
  if (fs.existsSync(currentWeekSrc)) {
    try {
      const raw = fs.readFileSync(currentWeekSrc, "utf-8");
      result.current_week = JSON.parse(raw);
      console.log("✓ current_week loaded");
    } catch (e) {
      result.current_week = UNAVAILABLE_CURRENT_WEEK;
      console.warn(`⚠ Invalid training/ledger/current_week.json; using unavailable fallback: ${e.message}`);
    }
  } else {
    result.current_week = UNAVAILABLE_CURRENT_WEEK;
    console.warn("⚠ No training/ledger/current_week.json found; using unavailable fallback");
  }

  // 4. Bundle workout templates and sessions → workouts
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
  } else {
    console.warn("⚠ No data/templates/ directory found");
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
  } else {
    console.warn("⚠ No data/sessions/ directory found");
  }
  result.workouts = workouts;

  // 5. sync_status.json
  const syncStatusSrc = path.join(REPO_ROOT, "training", "sync_status.json");
  if (fs.existsSync(syncStatusSrc)) {
    result.sync_status = JSON.parse(fs.readFileSync(syncStatusSrc, "utf-8"));
    console.log("✓ sync_status loaded");
  } else {
    result.sync_status = {
      status: "none", timestamp: null, activities_synced: 0,
      activities_renamed: 0, descriptions_parsed: 0, warnings: [],
    };
    console.log("✓ sync_status — no data, using default");
  }

  // 6. sleep_log.json / quest_history.json - not produced by any pipeline step yet,
  // carried through from whatever's already committed in client/src/data/ as a
  // placeholder. Real values land here once a sleep/quest pipeline exists.
  const sleepLogPath = path.join(OUT_DIR, "sleep_log.json");
  result.sleep_log = fs.existsSync(sleepLogPath) ? JSON.parse(fs.readFileSync(sleepLogPath, "utf-8")) : [];

  const questHistoryPath = path.join(OUT_DIR, "quest_history.json");
  result.quest_history = fs.existsSync(questHistoryPath)
    ? JSON.parse(fs.readFileSync(questHistoryPath, "utf-8"))
    : { generated_at: "", quests: {} };

  result.schema_version = SCHEMA_VERSION;
  result.generated_at = new Date().toISOString();

  return result;
}

// Ensure output dir exists
fs.mkdirSync(OUT_DIR, { recursive: true });

// Design tokens → CSS custom properties
spawnSync("node", ["scripts/generate-wi-tokens.mjs"], { cwd: UI_DIR, stdio: "inherit" });

const aggregate = buildAggregate();

// Build-time bundling path (unchanged behavior - Vite bundles these for local/
// standalone use)
fs.writeFileSync(path.join(OUT_DIR, "activities.json"), JSON.stringify(aggregate.activities, null, 0));
if (aggregate.challenge_v2) {
  fs.writeFileSync(path.join(OUT_DIR, "challenge_v2.json"), JSON.stringify(aggregate.challenge_v2, null, 2));
}
fs.writeFileSync(path.join(OUT_DIR, "current_week.json"), JSON.stringify(aggregate.current_week, null, 2));
fs.writeFileSync(path.join(OUT_DIR, "workouts.json"), JSON.stringify(aggregate.workouts, null, 2));
fs.writeFileSync(path.join(OUT_DIR, "sync_status.json"), JSON.stringify(aggregate.sync_status, null, 2));

// Widget snapshots for cross-platform glance surfaces (iOS Home, WidgetKit)
const snapshotResult = spawnSync(
  "npx",
  ["tsx", "--tsconfig", "tsconfig.json", "scripts/generate-widget-snapshots.ts"],
  { cwd: UI_DIR, stdio: "inherit" },
);
if (snapshotResult.status !== 0) {
  console.warn("⚠ widget_snapshots generation failed — continuing build");
}

console.log("✓ Data build complete");

// --aggregate: also write data/aggregate.json at the repo root, for the hosted
// shared site to fetch via GET /repos/{owner}/{repo}/contents/data/aggregate.json.
// Only meaningful in a personal repo with a real sync pipeline - a no-op to run
// here, but this file needs to support it since sync.yml in coach-phelps and
// akash-coach-phelps calls this same script.
if (process.argv.includes("--aggregate")) {
  const aggregateDir = path.join(REPO_ROOT, "data");
  fs.mkdirSync(aggregateDir, { recursive: true });
  fs.writeFileSync(path.join(aggregateDir, "aggregate.json"), JSON.stringify(aggregate, null, 0));
  console.log("✓ data/aggregate.json written");
}
