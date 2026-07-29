import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Walk up from `fromDir` to find repo root (HQ monorepo or athlete skeleton). */
export function repoRoot(fromDir = path.dirname(fileURLToPath(import.meta.url))) {
  let dir = path.resolve(fromDir);
  for (let i = 0; i < 8; i++) {
    // HQ monorepo — platform band + product surfaces
    if (
      fs.existsSync(path.join(dir, "platform", "soul")) &&
      fs.existsSync(path.join(dir, "ui"))
    ) {
      return dir;
    }
    if (fs.existsSync(path.join(dir, "engine", "soul"))) {
      return dir;
    }
    if (
      fs.existsSync(path.join(dir, "propagated", "SOUL.md")) ||
      (fs.existsSync(path.join(dir, "SOUL.md")) &&
        (fs.existsSync(path.join(dir, "user_data")) || fs.existsSync(path.join(dir, "training"))))
    ) {
      return dir;
    }
    // Flat athlete skeleton: soul/ at repo root — not HQ's platform/soul/ subtree
    if (
      fs.existsSync(path.join(dir, "soul")) &&
      !fs.existsSync(path.join(dir, "engine")) &&
      !fs.existsSync(path.join(dir, "platform", "scripts")) &&
      !fs.existsSync(path.join(path.dirname(dir), "engine", "soul")) &&
      !fs.existsSync(path.join(path.dirname(dir), "platform", "soul"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Cannot resolve repo root from ${fromDir}`);
}

/** true when repo uses user_data/ + gen/ (carved skeleton); false for legacy training/ + data/. */
export function usesNewLayout(repoRootPath) {
  return fs.existsSync(path.join(repoRootPath, "user_data"));
}

/** HQ monorepo — platform IP + ui; no athlete instance band at root. */
export function isHqMonorepo(repoRootPath) {
  return (
    fs.existsSync(path.join(repoRootPath, "platform", "soul")) &&
    fs.existsSync(path.join(repoRootPath, "ui"))
  );
}

export function goldenRepoDataDir(repoRootPath) {
  return path.join(repoRootPath, "shared/golden-dataset/repo-data");
}

export function soulDir(repoRootPath) {
  const inPlatform = path.join(repoRootPath, "platform", "soul");
  if (fs.existsSync(inPlatform)) return inPlatform;
  const inEngine = path.join(repoRootPath, "engine", "soul");
  return fs.existsSync(inEngine) ? inEngine : path.join(repoRootPath, "soul");
}

export function enginePath(repoRootPath, ...parts) {
  const inEngine = path.join(repoRootPath, "engine", ...parts);
  if (fs.existsSync(path.join(repoRootPath, "engine"))) {
    return inEngine;
  }
  return path.join(repoRootPath, ...parts);
}

export function coachDir(repoRootPath) {
  return usesNewLayout(repoRootPath)
    ? path.join(repoRootPath, "user_data", "coach")
    : path.join(repoRootPath, "training", "coach");
}

export function ledgerDir(repoRootPath) {
  return usesNewLayout(repoRootPath)
    ? path.join(repoRootPath, "user_data", "ledger")
    : path.join(repoRootPath, "training", "ledger");
}

export function histDir(repoRootPath) {
  return usesNewLayout(repoRootPath)
    ? path.join(repoRootPath, "user_data", "activities", "hist")
    : path.join(repoRootPath, "training", "activities", "history");
}

export function genDir(repoRootPath) {
  return usesNewLayout(repoRootPath) ? path.join(repoRootPath, "gen") : path.join(repoRootPath, "training");
}

export function sessionsDir(repoRootPath) {
  return usesNewLayout(repoRootPath)
    ? path.join(repoRootPath, "user_data", "activities", "workout_plans", "sessions")
    : path.join(repoRootPath, "sessions");
}

export function templatesDir(repoRootPath) {
  return usesNewLayout(repoRootPath)
    ? path.join(repoRootPath, "user_data", "activities", "workout_plans", "templates")
    : path.join(repoRootPath, "templates");
}

export function aggregatePath(repoRootPath) {
  return usesNewLayout(repoRootPath)
    ? path.join(repoRootPath, "gen", "aggregate.json")
    : path.join(repoRootPath, "data", "aggregate.json");
}

export function sleepLogPath(repoRootPath) {
  return usesNewLayout(repoRootPath)
    ? path.join(repoRootPath, "user_data", "coach", "sleep_log.json")
    : path.join(repoRootPath, "training", "activities", "sleep_log.json");
}

export function syncStatePath(repoRootPath) {
  return usesNewLayout(repoRootPath)
    ? path.join(repoRootPath, "user_data", "activities", "sync_state.json")
    : path.join(repoRootPath, "training", "sync_state.json");
}

export function syncStatusPath(repoRootPath) {
  return usesNewLayout(repoRootPath)
    ? path.join(repoRootPath, "gen", "sync_status.json")
    : path.join(repoRootPath, "training", "sync_status.json");
}

export function questLogPath(repoRootPath) {
  return usesNewLayout(repoRootPath)
    ? path.join(repoRootPath, "gen", "quest_log.md")
    : path.join(repoRootPath, "training", "activities", "quest_log.md");
}

export function questHistoryPath(repoRootPath) {
  return usesNewLayout(repoRootPath)
    ? path.join(repoRootPath, "gen", "quest_history.json")
    : path.join(repoRootPath, "training", "activities", "quest_history.json");
}

export function widgetSnapshotsPath(repoRootPath) {
  return usesNewLayout(repoRootPath)
    ? path.join(repoRootPath, "gen", "widget_snapshots.json")
    : path.join(repoRootPath, "training", "widget_snapshots.json");
}

export function chatHistoryPath(repoRootPath) {
  return usesNewLayout(repoRootPath)
    ? path.join(repoRootPath, "user_data", "coach", "chat_history.json")
    : path.join(repoRootPath, "training", "chat_history.json");
}

/** Archive seasons — HQ legacy path; new layout uses user_data/ledger/seasons. */
export function seasonsDir(repoRootPath) {
  return usesNewLayout(repoRootPath)
    ? path.join(repoRootPath, "user_data", "ledger", "seasons")
    : path.join(repoRootPath, "training", "seasons");
}

/** Derived plugin snapshots live beside activities in both layouts. */
export function activitiesDir(repoRootPath) {
  return usesNewLayout(repoRootPath)
    ? path.join(repoRootPath, "user_data", "activities")
    : path.join(repoRootPath, "training", "activities");
}

/** HQ composed SOUL lives under platform/propagated/; athlete repos use root propagated/. */
export function propagatedDir(repoRootPath) {
  if (isHqMonorepo(repoRootPath)) {
    return path.join(repoRootPath, "platform", "propagated");
  }
  return path.join(repoRootPath, "propagated");
}
/** Composed coach brain — HQ: platform/propagated/SOUL.md; athlete: propagated/SOUL.md. */
export function soulFilePath(repoRootPath) {
  const soul = path.join(propagatedDir(repoRootPath), "SOUL.md");
  if (fs.existsSync(soul)) return soul;
  return path.join(repoRootPath, "SOUL.md");
}
