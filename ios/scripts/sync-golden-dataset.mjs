#!/usr/bin/env node
/**
 * sync-golden-dataset.mjs — Copy shared/golden-dataset/widget_snapshots.json into iOS Resources.
 *
 * Run manually: node ios/scripts/sync-golden-dataset.mjs
 * Wired into Xcode as a pre-build phase on the CoachHQWidgetExtension target
 * (runs before the main app because of the embed dependency).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const SOURCE_PATH = path.join(REPO_ROOT, "shared/golden-dataset/widget_snapshots.json");
const OUT_PATH = path.join(
  REPO_ROOT,
  "ios/CoachHQ/CoachHQ/Resources/golden_widget_snapshots.json",
);

if (!fs.existsSync(SOURCE_PATH)) {
  console.error(`✗ golden dataset source missing: ${SOURCE_PATH}`);
  process.exit(1);
}

const json = fs.readFileSync(SOURCE_PATH, "utf-8");
JSON.parse(json);

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, json);
console.log("✓ golden_widget_snapshots.json synced");
