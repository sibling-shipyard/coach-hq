#!/usr/bin/env node
// Runs the full vitest suite and writes a dated JSON run report, same tests/<YYYY-MM-DD>/<kind>/
// convention as ui/scripts/lib/testLog.ts uses for eval/manual runs - so `npm test` stays the
// fast everyday loop, and `npm run test:logged` is the one an agent reaches for when asked to
// "run the tests and leave a record."
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(uiRoot, "..");

const now = new Date();
const day = now.toISOString().slice(0, 10);
const timeStamp = now.toISOString().slice(11, 19).replace(/:/g, "-");
const dayDir = path.join(repoRoot, "tests", day, "unit");
fs.mkdirSync(dayDir, { recursive: true });
const outputFile = path.join(dayDir, `vitest-results-${timeStamp}.json`);

const result = spawnSync(
  "npx",
  ["vitest", "run", "--reporter=default", "--reporter=json", `--outputFile=${outputFile}`],
  { cwd: uiRoot, stdio: "inherit" },
);

console.log(`\nRun log written to ${path.relative(repoRoot, outputFile)}`);
process.exit(result.status ?? 1);
