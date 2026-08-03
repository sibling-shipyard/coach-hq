import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import { ACTIVITY_ALLOWLIST } from "../../../../engine/lib/projectActivity.mjs";

describe("Activity allowlist", () => {
  it("exactly matches the fields in the Activity interface to prevent silent drops", () => {
    const srcPath = path.join(__dirname, "activities.ts");
    const src = fs.readFileSync(srcPath, "utf-8");
    
    const interfaceMatch = src.match(/export interface Activity \{([\s\S]*?)\n\}/);
    expect(interfaceMatch).toBeTruthy();
    
    const lines = interfaceMatch[1].split("\n");
    const tsKeys = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//")) continue;
      
      const keyMatch = trimmed.match(/^([a-z_]+)\s*[:?]/);
      if (keyMatch) {
        tsKeys.push(keyMatch[1]);
      }
    }
    
    expect(tsKeys.sort()).toEqual([...ACTIVITY_ALLOWLIST].sort());
  });
});
