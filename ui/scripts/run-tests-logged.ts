#!/usr/bin/env -S npx tsx
// Runs the full vitest suite and writes a dated JSON run report, same tests/<YYYY-MM-DD>/<kind>/
// convention as ui/scripts/lib/testLog.ts uses for eval/manual runs - so `npm test` stays the
// fast everyday loop, and `npm run test:logged` is the one an agent reaches for when asked to
// "run the tests and leave a record."
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dailyLogDir, repoRoot } from "./lib/testLog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(__dirname, "..");

// Same fail-open spirit as writeTestLog: a directory we can't create shouldn't stop the tests
// themselves from running, just drop the JSON report for this run.
let outputFile: string | null = null;
try {
  const { dir, time } = dailyLogDir("unit");
  outputFile = path.join(dir, `vitest-results-${time}.json`);
} catch (err) {
  console.warn(`  (couldn't prepare run log directory: ${err instanceof Error ? err.message : String(err)})`);
}

const vitestArgs = ["vitest", "run", "--reporter=default"];
if (outputFile) vitestArgs.push("--reporter=json", `--outputFile=${outputFile}`);

const result = spawnSync("npx", vitestArgs, { cwd: uiRoot, stdio: "inherit" });

if (outputFile) console.log(`\nRun log written to ${path.relative(repoRoot, outputFile)}`);
process.exit(result.status ?? 1);
