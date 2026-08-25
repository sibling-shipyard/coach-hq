import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");

export type FilesChanged =
  | { confidence: "derived"; files: string[] }               // eval: filesForReply() guess
  | { confidence: "observed"; files: string[]; diff: string }; // manual: real git diff

export interface TestLogEntry {
  kind: "eval" | "manual";
  name: string;
  input: unknown;
  output: unknown;
  result: "PASS" | "FAIL" | "ERROR";
  failures?: string[];
  filesChanged: FilesChanged;
}

/** Writes tests/<YYYY-MM-DD>/<kind>/<prefix>-log-<HH-MM-SS>.json, mkdir -p'd. */
export function writeTestLog(kind: "eval" | "manual", prefix: string, entries: TestLogEntry[]): void {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const timeStamp = now.toISOString().slice(11, 19).replace(/:/g, "-");
  const dayDir = path.join(repoRoot, "tests", day, kind);
  const logPath = path.join(dayDir, `${prefix}-log-${timeStamp}.json`);
  try {
    fs.mkdirSync(dayDir, { recursive: true });
    fs.writeFileSync(logPath, `${JSON.stringify(entries, null, 2)}\n`);
    console.log(`\nRun log written to ${path.relative(repoRoot, logPath)}`);
  } catch (err) {
    console.warn(`  (couldn't write run log: ${err instanceof Error ? err.message : String(err)})`);
  }
}
