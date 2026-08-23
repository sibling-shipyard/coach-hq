import fs from "node:fs";
import path from "node:path";

import { healthDir, isHqMonorepo } from "./repo-layout.mjs";

export const DEFAULT_HR_ZONES = Object.freeze([131, 145, 158, 172]);

function defaults() {
  return [...DEFAULT_HR_ZONES];
}

export function loadHrZones(repoRootPath) {
  if (isHqMonorepo(repoRootPath)) return defaults();

  try {
    const data = JSON.parse(
      fs.readFileSync(path.join(healthDir(repoRootPath), "zones.json"), "utf-8"),
    );
    const boundaries = data?.boundaries;
    if (
      !Array.isArray(boundaries) ||
      boundaries.length !== 4 ||
      boundaries.some((value) => !Number.isInteger(value)) ||
      boundaries.some((value, index) => index > 0 && boundaries[index - 1] >= value)
    ) {
      return defaults();
    }
    return [...boundaries];
  } catch {
    return defaults();
  }
}
