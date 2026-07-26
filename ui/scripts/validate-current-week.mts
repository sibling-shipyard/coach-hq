import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseCurrentWeek } from "../client/src/lib/currentWeek.ts";

const args = process.argv.slice(2);
const allowedFlags = new Set(["--coach-write"]);
const unknownFlag = args.find((arg) => arg.startsWith("--") && !allowedFlags.has(arg));

if (unknownFlag) {
  console.error(`Unknown option: ${unknownFlag}`);
  process.exit(2);
}

const enforceCoachWrite = args.includes("--coach-write");
const fileArgs = args.filter((arg) => !arg.startsWith("--"));

if (fileArgs.length > 1) {
  console.error("Usage: validate-current-week [--coach-write] [path]");
  process.exit(2);
}

const target = resolve(fileArgs[0] ?? "user_data/ledger/current_week.json");
let input: unknown;

try {
  input = JSON.parse(await readFile(target, "utf8"));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`FAIL ${target}: ${message}`);
  process.exit(1);
}

const runtime = parseCurrentWeek(input);
const issues = [...runtime.issues];

const updatedBy = typeof input === "object" && input !== null && !Array.isArray(input)
  ? (input as Record<string, unknown>).updated_by
  : undefined;

if (enforceCoachWrite && updatedBy !== "coach") {
  issues.push('current_week.updated_by must be "coach" for a Coach-authored save');
}

if (issues.length > 0 || runtime.availability.status === "invalid") {
  console.error(`FAIL ${target}`);
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log(
  `PASS ${target}: schema v${runtime.data?.schema_version} is valid; availability=${runtime.availability.status}`,
);
