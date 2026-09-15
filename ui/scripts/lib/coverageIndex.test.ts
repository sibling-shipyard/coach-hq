import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readCoverageIndex, writeCoverageIndex, writeCoverageEntry } from "./coverageIndex.js";

describe("coverageIndex", () => {
  let dir: string;
  let coveragePath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "coverage-index-test-"));
    coveragePath = path.join(dir, "coverage-index.json");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("readCoverageIndex returns an empty object when the file doesn't exist yet", () => {
    expect(readCoverageIndex(coveragePath)).toEqual({});
  });

  it("readCoverageIndex returns an empty object on unparseable JSON rather than throwing", () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(coveragePath, "not json");
    expect(readCoverageIndex(coveragePath)).toEqual({});
  });

  it("writeCoverageIndex writes the full index and creates missing parent dirs", () => {
    const nestedPath = path.join(dir, "nested", "coverage-index.json");
    writeCoverageIndex(nestedPath, { "manual:a": { status: "pass" } });
    expect(readCoverageIndex(nestedPath)).toEqual({ "manual:a": { status: "pass" } });
  });

  // #1076: this is the real bug - two run-simulation-suite.ts processes each holding their own
  // in-memory copy of the whole index, so whichever one wrote last clobbered the other's key.
  // writeCoverageEntry re-reads before every write, so a "concurrent" write to a different key
  // (simulated here by writing it directly to disk between two writeCoverageEntry calls) survives.
  it("writeCoverageEntry preserves a key written by another process between its read and write", () => {
    writeCoverageIndex(coveragePath, { "manual:existing": { status: "pass" } });

    // Simulate a second process writing its own key to disk after this process's first entry
    // is written but before this test writes its second one.
    writeCoverageEntry(coveragePath, "manual:mine", { status: "pass" });
    const onDisk = readCoverageIndex(coveragePath);
    onDisk["manual:concurrent"] = { status: "pass" };
    writeCoverageIndex(coveragePath, onDisk);

    writeCoverageEntry(coveragePath, "manual:mine", { status: "fail" });

    expect(readCoverageIndex(coveragePath)).toEqual({
      "manual:existing": { status: "pass" },
      "manual:concurrent": { status: "pass" },
      "manual:mine": { status: "fail" },
    });
  });

  it("writeCoverageEntry only touches the one key it's given", () => {
    writeCoverageEntry(coveragePath, "manual:a", { status: "pass" });
    writeCoverageEntry(coveragePath, "manual:b", { status: "fail" });

    expect(readCoverageIndex(coveragePath)).toEqual({
      "manual:a": { status: "pass" },
      "manual:b": { status: "fail" },
    });
  });
});
