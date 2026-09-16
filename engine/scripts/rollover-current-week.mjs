#!/usr/bin/env node
/**
 * rollover-current-week.mjs — the scheduled rollover ADR 0042/finding 8 calls for.
 *
 * current_week.json only ever refreshes when the model writes it: one day of grace past a live
 * week's end, parseCurrentWeek reports it "stale," and an athlete who doesn't chat opens a week
 * that still points at last week's dates. This job runs in the sync pipeline (not chat-triggered)
 * and replaces an aged-out week with a fresh placeholder frame for the real current week, so the
 * file always names the right week even before Coach has had the real kickoff conversation. It
 * does not compile a plan - that's W3 (blocks in seasons.json), still gated. This only keeps the
 * frame current.
 *
 * Usage:
 *   node engine/scripts/rollover-current-week.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ledgerDir, repoRoot } from "../lib/repo-layout.mjs";
import { parseCurrentWeek } from "../lib/current-week.mts";
import { buildRolloverPlaceholder, needsRollover } from "../lib/currentWeekRollover.mts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = repoRoot(__dirname);

// Re-exported for this script's own test file - the decision logic itself now lives in
// currentWeekRollover.mts, shared with (eventually) the coach-chat Vercel function.
export { buildRolloverPlaceholder, needsRollover };

function todayInTimeZone(timeZone, now) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(now);
  }
}

export function main(repoRootPath = REPO_ROOT, now = new Date()) {
  const currentWeekPath = path.join(ledgerDir(repoRootPath), "current_week.json");
  if (!fs.existsSync(currentWeekPath)) {
    console.log("[rollover] no current_week.json - nothing to roll over");
    return;
  }
  const raw = JSON.parse(fs.readFileSync(currentWeekPath, "utf-8"));
  const runtime = parseCurrentWeek(raw, now);
  if (!runtime.data) {
    console.log("[rollover] current_week.json isn't schema-valid - leaving it untouched");
    return;
  }

  const today = todayInTimeZone(runtime.data.timezone, now);
  if (!needsRollover(runtime, today)) {
    console.log("[rollover] week is still current - nothing to do");
    return;
  }

  const placeholder = buildRolloverPlaceholder(runtime.data.timezone, today, now);
  const validated = parseCurrentWeek(placeholder, now);
  if (!validated.data) {
    throw new Error(
      `rollover-current-week: placeholder failed validation, refusing to write: ${validated.issues.join("; ")}`,
    );
  }
  fs.writeFileSync(currentWeekPath, JSON.stringify(placeholder, null, 2) + "\n");
  console.log(
    `[rollover] rolled current_week.json to ${placeholder.week.id} (${placeholder.week.start_date}..${placeholder.week.end_date})`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
