import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** HQ: engine/scripts/foo.mjs → repo root. Skeleton: scripts/foo.mjs → repo root. */
export function repoRoot(fromDir = path.dirname(fileURLToPath(import.meta.url))) {
  if (fs.existsSync(path.join(fromDir, "..", "soul"))) {
    return path.resolve(fromDir, "..");
  }
  if (fs.existsSync(path.join(fromDir, "..", "..", "engine", "soul"))) {
    return path.resolve(fromDir, "..", "..");
  }
  throw new Error(`Cannot resolve repo root from ${fromDir}`);
}

export function soulDir(repoRootPath) {
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
