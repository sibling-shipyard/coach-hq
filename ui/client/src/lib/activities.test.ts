import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import { ACTIVITY_ALLOWLIST } from "../../../../engine/lib/projectActivity.mjs";

describe("Activity allowlist", () => {
  it("ACTIVITY_ALLOWLIST is a superset of Activity interface keys to prevent silent drops", () => {
    const srcPath = path.join(__dirname, "activities.ts");
    const src = fs.readFileSync(srcPath, "utf-8");
    
    // Note: The regex `\{([^}]+)\}` stops at the first `}`.
    // If nested object types are ever added to the Activity interface, this capture will truncate,
    // which would silently weaken this superset check.
    const interfaceMatch = src.match(/export interface Activity\s*\{([^}]+)\}/);
    expect(interfaceMatch).toBeTruthy();
    
    const lines = interfaceMatch![1].split("\n");
    const tsKeys = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/**")) continue;
      
      const keyMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s*[:?]/);
      if (keyMatch) {
        tsKeys.push(keyMatch[1]);
      }
    }
    
    for (const key of tsKeys) {
      expect(ACTIVITY_ALLOWLIST).toContain(key);
    }
  });
});
