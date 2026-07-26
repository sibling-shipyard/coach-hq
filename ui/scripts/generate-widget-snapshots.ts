/**
 * generate-widget-snapshots.ts — Build cross-platform widget snapshot JSON from home models.
 * Invoked by build-data.mjs via tsx.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChallengeV2 } from "../client/src/lib/challenge";
import type { Activity } from "../client/src/lib/activities";
import type { CurrentWeekContract } from "../client/src/components/home-warm/currentWeek.fixture";
import { buildLiveWeekContract } from "../client/src/components/home-warm/liveWeekContract";
import { buildWidgetSnapshotsFile } from "../client/src/components/home-warm/warmHomeSnapshots";
import type { SyncStatusPayload } from "../client/src/components/home-warm/warmHomeModel";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

function readJson<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function loadActivities(): Activity[] {
  const historyDir = path.join(REPO_ROOT, "training", "activities", "history");
  if (!fs.existsSync(historyDir)) return [];
  const files = fs.readdirSync(historyDir).filter((f) => f.endsWith(".json"));
  const activities: Activity[] = [];
  for (const file of files) {
    try {
      activities.push(JSON.parse(fs.readFileSync(path.join(historyDir, file), "utf-8")));
    } catch {
      // skip invalid files
    }
  }
  activities.sort(
    (a, b) => new Date(b.start_date_local).getTime() - new Date(a.start_date_local).getTime(),
  );
  return activities;
}

const UNAVAILABLE_CURRENT_WEEK: CurrentWeekContract = {
  schema_version: null,
  data_status: "unavailable",
  timezone: "Europe/London",
  week: null,
  coach_read: null,
  days: [],
  coach_comments: [],
  updated_at: null,
  updated_by: "generate-widget-snapshots",
};

const activities = loadActivities();
const challenge = readJson<ChallengeV2 | null>(
  path.join(REPO_ROOT, "training/ledger/challenge_v2.json"),
  null,
);
const syncStatus = readJson<SyncStatusPayload>(
  path.join(REPO_ROOT, "training/sync_status.json"),
  { status: "none", timestamp: null, warnings: [] },
);
const storedWeek = readJson<CurrentWeekContract>(
  path.join(REPO_ROOT, "training/ledger/current_week.json"),
  UNAVAILABLE_CURRENT_WEEK,
);

if (!challenge) {
  console.warn("⚠ widget_snapshots — no challenge_v2.json, skipping");
  process.exit(0);
}

const contract = storedWeek.data_status === "unavailable"
  ? buildLiveWeekContract(activities, challenge)
  : storedWeek;

const snapshots = buildWidgetSnapshotsFile(
  activities,
  challenge,
  syncStatus,
  contract,
  "live",
);

const payload = JSON.stringify(snapshots, null, 2);
const trainingOut = path.join(REPO_ROOT, "training/widget_snapshots.json");
const clientOut = path.join(REPO_ROOT, "ui/client/src/data/widget_snapshots.json");

fs.mkdirSync(path.dirname(trainingOut), { recursive: true });
fs.mkdirSync(path.dirname(clientOut), { recursive: true });
fs.writeFileSync(trainingOut, payload);
fs.writeFileSync(clientOut, payload);
console.log("✓ widget_snapshots.json written");
