import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkReconciliation } from "./coverageReconciliation.js";
import { writeCoverageIndex } from "./coverageIndex.js";

describe("checkReconciliation", () => {
  let dir: string;
  let rawManualDir: string;
  let coveragePath: string;
  let examplesDir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "coverage-reconciliation-test-"));
    rawManualDir = path.join(dir, "raw", "2026-09-15", "manual");
    fs.mkdirSync(rawManualDir, { recursive: true });
    coveragePath = path.join(dir, "coverage-index.json");
    examplesDir = path.join(dir, "examples");
    fs.mkdirSync(examplesDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // fsp-basic is the sole scenario against skanda-testing/coach-skanda-testing (no other scenario
  // shares that repo), so its raw log's turn content doesn't need to match any example file -
  // only the workout-lifecycle-style shared-repo case below needs that.
  function writeRawLog(fileName: string, messages: string[]) {
    const entries = messages.map((message) => ({ input: { message } }));
    fs.writeFileSync(path.join(rawManualDir, fileName), JSON.stringify(entries, null, 2));
  }

  it("reports all reconciled when every raw log has a fresh matching coverage-index.json entry", () => {
    writeRawLog("manual-coach-chat-skanda-testing-coach-skanda-testing-log-10-00-00.json", [
      "hi",
      "goal is a marathon",
      "injury: none",
      "trains 5x/week",
      "wrap up",
    ]);
    writeCoverageIndex(coveragePath, {
      "manual:fsp-basic": { type: "manual", status: "pass", last_run_date: "2026-09-15" },
    });

    const { ok, lines } = checkReconciliation(
      "2026-09-15",
      rawManualDir,
      coveragePath,
      examplesDir,
    );

    expect(ok).toBe(true);
    expect(lines.some((l) => l.includes("fsp-basic") && l.startsWith("  ok"))).toBe(true);
  });

  it("flags a raw log with no matching coverage-index.json entry (the F5 lost-write class of bug)", () => {
    writeRawLog("manual-coach-chat-skanda-testing-coach-skanda-testing-log-10-00-00.json", [
      "hi",
      "goal is a marathon",
      "injury: none",
      "trains 5x/week",
      "wrap up",
    ]);
    // coverage-index.json has some other entry, but nothing for fsp-basic - as if that
    // scenario's write got clobbered by a concurrent process.
    writeCoverageIndex(coveragePath, {
      "manual:daily-sleep-skip": { type: "manual", status: "pass", last_run_date: "2026-09-15" },
    });

    const { ok, lines } = checkReconciliation(
      "2026-09-15",
      rawManualDir,
      coveragePath,
      examplesDir,
    );

    expect(ok).toBe(false);
    expect(
      lines.some(
        (l) => l.includes("fsp-basic") && l.includes("no") && l.includes("manual:fsp-basic"),
      ),
    ).toBe(true);
  });

  it("flags a stale coverage-index.json entry (present, but last_run_date is from an earlier day)", () => {
    writeRawLog("manual-coach-chat-skanda-testing-coach-skanda-testing-log-10-00-00.json", [
      "hi",
      "goal is a marathon",
      "injury: none",
      "trains 5x/week",
      "wrap up",
    ]);
    writeCoverageIndex(coveragePath, {
      "manual:fsp-basic": { type: "manual", status: "pass", last_run_date: "2026-09-10" },
    });

    const { ok, lines } = checkReconciliation(
      "2026-09-15",
      rawManualDir,
      coveragePath,
      examplesDir,
    );

    expect(ok).toBe(false);
    expect(lines.some((l) => l.includes("fsp-basic") && l.includes("stale"))).toBe(true);
  });

  it("ignores a raw log whose repo isn't one of the suite's known scenarios (an ad-hoc manual run)", () => {
    writeRawLog("manual-coach-chat-someone-else-unknown-repo-log-10-00-00.json", ["hi"]);
    writeCoverageIndex(coveragePath, {});

    const { ok, lines } = checkReconciliation(
      "2026-09-15",
      rawManualDir,
      coveragePath,
      examplesDir,
    );

    expect(ok).toBe(true);
    expect(lines.some((l) => l.includes("unknown-repo"))).toBe(false);
  });

  it("disambiguates two scenarios sharing a repo by comparing turn content against their example files", () => {
    // workout-lifecycle and injury-resolve-by-bodypart both run against
    // skanda-2003/coach-skanda-2003 - fixture example files here mirror the real ones just
    // enough to prove content-based disambiguation, not the real scenario library.
    fs.writeFileSync(
      path.join(examplesDir, "manual-coach-chat-turns-workout-lifecycle.json"),
      JSON.stringify([
        { message: "create a workout" },
        { message: "remove it" },
        { message: "wrap up" },
      ]),
    );
    fs.writeFileSync(
      path.join(examplesDir, "manual-coach-chat-turns-injury-resolve-by-bodypart.json"),
      JSON.stringify([
        { message: "my knee hurts" },
        { message: "my hip hurts too" },
        { message: "knee is fine now" },
        { message: "wrap up" },
      ]),
    );
    writeRawLog("manual-coach-chat-skanda-2003-coach-skanda-2003-log-10-00-00.json", [
      "create a workout",
      "remove it",
      "wrap up",
    ]);
    writeCoverageIndex(coveragePath, {
      "manual:workout-lifecycle": { type: "manual", status: "pass", last_run_date: "2026-09-15" },
    });

    const { ok, lines } = checkReconciliation(
      "2026-09-15",
      rawManualDir,
      coveragePath,
      examplesDir,
    );

    expect(ok).toBe(true);
    expect(lines.some((l) => l.includes("workout-lifecycle") && l.startsWith("  ok"))).toBe(true);
  });

  // #1105 A3: --repo/--all-repos write an athlete-suffixed key ("manual:<id>:<athlete>") instead
  // of the plain one. Without checking for it too, this tool reports every one of those runs as
  // a false "no entry at all" - the exact class of false positive it exists to prevent.
  it("reconciles against the athlete-suffixed key an --all-repos run writes, not just the plain one", () => {
    fs.writeFileSync(
      path.join(examplesDir, "manual-coach-chat-turns-workout-lifecycle.json"),
      JSON.stringify([
        { message: "create a workout" },
        { message: "remove it" },
        { message: "wrap up" },
      ]),
    );
    fs.writeFileSync(
      path.join(examplesDir, "manual-coach-chat-turns-injury-resolve-by-bodypart.json"),
      JSON.stringify([
        { message: "my knee hurts" },
        { message: "my hip hurts too" },
        { message: "knee is fine now" },
        { message: "wrap up" },
      ]),
    );
    // --all-repos ran workout-lifecycle against akash instead of its own default (skanda) -
    // same repo slug shape run-manual-coach-chat-test.ts always uses, just a different repo.
    writeRawLog("manual-coach-chat-akash-suresh-coach-akash-suresh-log-10-00-00.json", [
      "create a workout",
      "remove it",
      "wrap up",
    ]);
    writeCoverageIndex(coveragePath, {
      "manual:workout-lifecycle:akash": {
        type: "manual",
        status: "pass",
        last_run_date: "2026-09-15",
      },
    });

    const { ok, lines } = checkReconciliation(
      "2026-09-15",
      rawManualDir,
      coveragePath,
      examplesDir,
    );

    expect(ok).toBe(true);
    expect(lines.some((l) => l.includes("workout-lifecycle") && l.startsWith("  ok"))).toBe(true);
  });

  it("still flags a missing entry when neither the plain nor the suffixed key exists", () => {
    fs.writeFileSync(
      path.join(examplesDir, "manual-coach-chat-turns-workout-lifecycle.json"),
      JSON.stringify([
        { message: "create a workout" },
        { message: "remove it" },
        { message: "wrap up" },
      ]),
    );
    fs.writeFileSync(
      path.join(examplesDir, "manual-coach-chat-turns-injury-resolve-by-bodypart.json"),
      JSON.stringify([
        { message: "my knee hurts" },
        { message: "my hip hurts too" },
        { message: "knee is fine now" },
        { message: "wrap up" },
      ]),
    );
    writeRawLog("manual-coach-chat-akash-suresh-coach-akash-suresh-log-10-00-00.json", [
      "create a workout",
      "remove it",
      "wrap up",
    ]);
    // No coverage-index.json entry at all - neither key format was ever written.

    const { ok, lines } = checkReconciliation(
      "2026-09-15",
      rawManualDir,
      coveragePath,
      examplesDir,
    );

    expect(ok).toBe(false);
    expect(
      lines.some(
        (l) =>
          l.includes("workout-lifecycle") &&
          l.includes("manual:workout-lifecycle") &&
          l.includes("manual:workout-lifecycle:akash"),
      ),
    ).toBe(true);
  });
});
