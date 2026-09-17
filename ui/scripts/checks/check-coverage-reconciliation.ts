#!/usr/bin/env -S npx tsx
/**
 * check-coverage-reconciliation.ts - catches the class of bug behind the 2026-09-15 F5 finding:
 * a concurrent-write race between two run-manual-simulation-suite.ts processes lost 3 real
 * coverage-index.json entries even though the raw run logs for those scenarios were sitting
 * right there on disk. `writeCoverageEntry` (lib/coverageIndex.ts) already fixes the race itself
 * (#1076/#1077, per-key read-merge-write) - this is a detection tool on top of that fix, not
 * another locking mechanism, so a future regression (or a different class of race entirely)
 * still gets caught instead of relying on a human noticing coverage-index.json looks short by
 * hand.
 *
 * For a given date, every raw run log under test-results/raw/<date>/manual/ is one completed
 * run-manual-coach-chat-test.ts invocation. run-manual-simulation-suite.ts drives that script per
 * scenario and is the only thing that writes coverage-index.json, keyed `manual:<scenario id>` -
 * so a raw log whose repo (and, when more than one scenario shares a repo, turn content) matches
 * one of the suite's known scenarios ought to have a matching coverage-index.json entry stamped
 * with that same date. A log with no matching entry, or one stamped with some other date, means
 * the write never landed. See lib/coverageReconciliation.ts for the actual matching/diffing logic
 * and its own scenario table - this script is just the CLI wrapper around it.
 *
 * Usage (from ui/):
 *   npm run check:coverage-reconciliation                 # today
 *   npm run check:coverage-reconciliation -- 2026-09-15    # a specific date
 *
 * Exits 0 ("all reconciled") when every raw log for the date has a matching, fresh
 * coverage-index.json entry (or the date has no raw logs at all - nothing to check), non-zero
 * otherwise, so this can run as a CI-style check.
 */
import path from "node:path";

import { checkReconciliation } from "../lib/coverageReconciliation.js";
import { repoRoot } from "../lib/testLog.js";

function parseDate(argv: string[]): string {
  const positional = argv.find((a) => !a.startsWith("--"));
  return positional ?? new Date().toISOString().slice(0, 10);
}

function main() {
  const date = parseDate(process.argv.slice(2));
  const rawManualDir = path.join(repoRoot, "test-results", "raw", date, "manual");
  const coveragePath = path.join(repoRoot, "test-results", "coverage-index.json");
  const examplesDir = path.join(repoRoot, "ui", "eval", "examples");

  console.log(`Reconciling coverage-index.json against raw run logs for ${date}...`);
  const { ok, lines } = checkReconciliation(date, rawManualDir, coveragePath, examplesDir);
  for (const line of lines) console.log(line);

  if (ok) {
    console.log("\nall reconciled");
  } else {
    console.log("\nMismatch(es) found - see above.");
    process.exit(1);
  }
}

main();
