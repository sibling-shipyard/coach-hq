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
    // Athlete repo: a composed SOUL at the propagated/ or repo root. Both the post-ADR-0022
    // `SOUL.claude.md` name and the pre-split `SOUL.md` count — repos carved before the split
    // still carry the old name and must keep resolving.
    const hasAthleteBand =
      fs.existsSync(path.join(dir, "user_data")) || fs.existsSync(path.join(dir, "training"));
    if (
      fs.existsSync(path.join(dir, "propagated", "SOUL.claude.md")) ||
      fs.existsSync(path.join(dir, "propagated", "SOUL.md")) ||
      ((fs.existsSync(path.join(dir, "SOUL.claude.md")) ||
        fs.existsSync(path.join(dir, "SOUL.md"))) &&
        hasAthleteBand)
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

export function healthDir(repoRootPath) {
  return usesNewLayout(repoRootPath)
    ? path.join(repoRootPath, "user_data", "health")
    : path.join(repoRootPath, "training", "health");
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

export function dashboardSnapshotPath(repoRootPath) {
  return usesNewLayout(repoRootPath)
    ? path.join(repoRootPath, "gen", "dashboard_snapshot.json")
    : path.join(repoRootPath, "data", "dashboard_snapshot.json");
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

/** Archive seasons - grouped with the rest of the coach's archived material (archive/phases.md,
 * archive/week_plans.md), not the live ledger/ - a closed season's challenge_v2.json is a
 * retrospective, not current data. Old layout uses training/seasons. */
export function seasonsDir(repoRootPath) {
  return usesNewLayout(repoRootPath)
    ? path.join(repoRootPath, "user_data", "coach", "archive", "seasons")
    : path.join(repoRootPath, "training", "seasons");
}

/** Derived plugin snapshots live beside activities in both layouts. */
export function activitiesDir(repoRootPath) {
  return usesNewLayout(repoRootPath)
    ? path.join(repoRootPath, "user_data", "activities")
    : path.join(repoRootPath, "training", "activities");
}

/**
 * Composed SOUL path for a build target (ADR 0022) — HQ: platform/SOUL.<target>.md; athlete
 * repos: propagated/SOUL.claude.md, then repo root.
 *
 * The bare `SOUL.md` name is retired at HQ but still probed last in athlete repos: `coach-akash`
 * and `coach-skanda` were carved before the split and still carry `propagated/SOUL.md`, so
 * dropping the fallback would break the engine scripts running inside them.
 */
export function soulFilePath(repoRootPath, target = "claude") {
  if (isHqMonorepo(repoRootPath)) {
    return path.join(repoRootPath, "platform", `SOUL.${target}.md`);
  }
  const candidates = [
    path.join(repoRootPath, "propagated", `SOUL.${target}.md`),
    path.join(repoRootPath, "propagated", "SOUL.md"),
    path.join(repoRootPath, `SOUL.${target}.md`),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(repoRootPath, "SOUL.md");
}
