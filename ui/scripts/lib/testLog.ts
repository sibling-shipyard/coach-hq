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

/**
 * Writes tests/<YYYY-MM-DD>/<kind>/<prefix>-log-<HH-MM-SS>.json, mkdir -p'd.
 * Returns whether the write actually succeeded - the whole point of running either script is
 * this file landing on disk, so a caller that ignores the return value and exits 0 on a disk-full
 * or permissions failure would report a normal pass/fail with zero audit trail and nothing to
 * show for it.
 */
export function writeTestLog(kind: "eval" | "manual", prefix: string, entries: TestLogEntry[]): boolean {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const timeStamp = now.toISOString().slice(11, 19).replace(/:/g, "-");
  const dayDir = path.join(repoRoot, "tests", day, kind);
  const logPath = path.join(dayDir, `${prefix}-log-${timeStamp}.json`);
  try {
    fs.mkdirSync(dayDir, { recursive: true });
    fs.writeFileSync(logPath, `${JSON.stringify(entries, null, 2)}\n`);
    console.log(`\nRun log written to ${path.relative(repoRoot, logPath)}`);
    return true;
  } catch (err) {
    console.warn(`  (couldn't write run log: ${err instanceof Error ? err.message : String(err)})`);
    return false;
  }
}
