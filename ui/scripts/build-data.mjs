#!/usr/bin/env node
/**
 * build-data.mjs — Pre-build script: merge athlete data into ui/client/src/data/
 * for Vite, and (with --dashboard-snapshot) write gen/dashboard_snapshot.json at repo root.
 *
 * HQ monorepo: early-exits after copying shared/golden-dataset/ → OUT_DIR
 * (no user_data/ or gen/ at root). Athlete repos: paths via repo-layout.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  dashboardSnapshotPath,
  goldenRepoDataDir,
  isHqMonorepo,
  repoRoot,
} from "../../engine/lib/repo-layout.mjs";
import { buildDashboardSnapshot } from "../../engine/scripts/build-dashboard-snapshot.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = repoRoot(path.join(__dirname, ".."));
const UI_DIR = path.join(REPO_ROOT, "ui");
const OUT_DIR = path.join(UI_DIR, "client", "src", "data");
const SCHEMA_VERSION = 1;

function copyGoldenToOutDir() {
  const gen = spawnSync("node", [path.join(REPO_ROOT, "shared/golden-dataset/generate-repo-data.mjs")], {
    stdio: "inherit",
  });
  if (gen.status !== 0) process.exit(gen.status ?? 1);

  const goldenDir = goldenRepoDataDir(REPO_ROOT);
  for (const file of fs.readdirSync(goldenDir).filter((f) => f.endsWith(".json"))) {
    fs.copyFileSync(path.join(goldenDir, file), path.join(OUT_DIR, file));
  }
  const readGolden = (name) => JSON.parse(fs.readFileSync(path.join(goldenDir, `${name}.json`), "utf-8"));
  const dashboardSnapshot = {
    activities: readGolden("activities"),
    ledger_schema: "split_v1", ledger: readGolden("ledger"), current_week: readGolden("current_week"),
    workouts: readGolden("workouts"), sync_status: readGolden("sync_status"),
    sleep_log: readGolden("sleep_log"), quest_history: readGolden("quest_history"),
    schema_version: SCHEMA_VERSION, generated_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(OUT_DIR, "dashboard_snapshot.json"), JSON.stringify(dashboardSnapshot));
  const widgetSrc = path.join(REPO_ROOT, "shared/golden-dataset/widget_snapshots.json");
  if (fs.existsSync(widgetSrc)) {
    fs.copyFileSync(widgetSrc, path.join(OUT_DIR, "widget_snapshots.json"));
    const iosGolden = path.join(
      REPO_ROOT,
      "ios/CoachHQ/CoachHQ/Resources/golden_widget_snapshots.json",
    );
    fs.mkdirSync(path.dirname(iosGolden), { recursive: true });
    fs.copyFileSync(widgetSrc, iosGolden);
    console.log("✓ widget_snapshots.json → ios/CoachHQ/Resources/");
  }
  console.log("✓ HQ golden dataset → ui/client/src/data/");
}

fs.mkdirSync(OUT_DIR, { recursive: true });

spawnSync("node", ["scripts/generate-wi-tokens.mjs"], { cwd: UI_DIR, stdio: "inherit" });

if (isHqMonorepo(REPO_ROOT)) {
  copyGoldenToOutDir();
  console.log("✓ Data build complete");
  if (process.argv.includes("--dashboard-snapshot")) {
    console.warn("⚠ --dashboard-snapshot ignored on HQ (no gen/ band)");
  }
  process.exit(0);
}

const dashboardSnapshot = buildDashboardSnapshot(REPO_ROOT);

fs.writeFileSync(path.join(OUT_DIR, "activities.json"), JSON.stringify(dashboardSnapshot.activities, null, 0));
fs.writeFileSync(path.join(OUT_DIR, "current_week.json"), JSON.stringify(dashboardSnapshot.current_week, null, 2));
fs.writeFileSync(path.join(OUT_DIR, "workouts.json"), JSON.stringify(dashboardSnapshot.workouts, null, 2));
fs.writeFileSync(path.join(OUT_DIR, "sync_status.json"), JSON.stringify(dashboardSnapshot.sync_status, null, 2));
// Vite bundles useRepoData.ts's static import of this file, so it has to land in OUT_DIR on
// every build regardless of --dashboard-snapshot (that flag only controls the extra gen/ copy
// below, for tooling that reads the snapshot outside the Vite build).
fs.writeFileSync(path.join(OUT_DIR, "dashboard_snapshot.json"), JSON.stringify(dashboardSnapshot, null, 0));

const snapshotResult = spawnSync(
  "npx",
  ["tsx", "--tsconfig", "tsconfig.json", "scripts/generate-widget-snapshots.ts"],
  { cwd: UI_DIR, stdio: "inherit" },
);
if (snapshotResult.status !== 0) {
  console.warn("⚠ widget_snapshots generation failed — continuing build");
}

console.log("✓ Data build complete");

if (process.argv.includes("--dashboard-snapshot")) {
  const outPath = dashboardSnapshotPath(REPO_ROOT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(dashboardSnapshot, null, 0));
  console.log(`✓ ${path.relative(REPO_ROOT, outPath)} written`);
}
