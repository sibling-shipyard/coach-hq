import fs from "node:fs";
import path from "node:path";

import { activitiesDir, isHqMonorepo, ledgerDir } from "./repo-layout.mjs";

const DEFAULT_PLUGINS = { enabled: [] };

export function pluginsPath(repoRootPath) {
  return path.join(ledgerDir(repoRootPath), "plugins.json");
}

export function loadPlugins(repoRootPath) {
  const filePath = pluginsPath(repoRootPath);
  if (!fs.existsSync(filePath)) {
    return { ...DEFAULT_PLUGINS, enabled: [] };
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!Array.isArray(data.enabled)) {
      return { ...DEFAULT_PLUGINS, enabled: [] };
    }
    return { enabled: data.enabled.map(String) };
  } catch {
    return { ...DEFAULT_PLUGINS, enabled: [] };
  }
}

export function isPluginEnabled(repoRootPath, name) {
  return loadPlugins(repoRootPath).enabled.includes(name);
}

export function badmintonPluginDir(repoRootPath) {
  const athlete = path.join(repoRootPath, "engine", "plugins", "badminton");
  if (fs.existsSync(athlete) && fs.statSync(athlete).isDirectory()) {
    return athlete;
  }
  if (isHqMonorepo(repoRootPath)) {
    const hq = path.join(repoRootPath, "platform", "plugins", "badminton");
    if (fs.existsSync(hq) && fs.statSync(hq).isDirectory()) {
      return hq;
    }
  }
  return null;
}

export function badmintonSnapshotPath(repoRootPath) {
  return path.join(activitiesDir(repoRootPath), "badminton_analytics_snapshot.json");
}

export function badmintonAnalyticsAvailable(repoRootPath) {
  if (isPluginEnabled(repoRootPath, "badminton")) {
    return true;
  }
  return fs.existsSync(badmintonSnapshotPath(repoRootPath));
}
