// #1076: run-manual-simulation-suite.ts used to read test-results/coverage-index.json once at the top
// of a run, mutate that in-memory copy across every scenario, and write it back once at the very
// end. Two `run-manual-simulation-suite.ts` processes running concurrently against the same checkout
// (done live to cut wall-clock time on a paid live pass) each hold their own stale copy, so
// whichever process finishes last silently overwrites every key the other one wrote - 3 real
// entries were lost this way. These helpers make each scenario's write atomic relative to that
// one scenario's key: read the file fresh, merge in just that key, write it back. Two concurrent
// writers can still race on the read-then-write pair for the *same* key, but that only matters if
// two runs score the exact same scenario at the same moment, which isn't the case this fixes.
import fs from "node:fs";
import path from "node:path";

export function readCoverageIndex(coveragePath: string): Record<string, unknown> {
  if (!fs.existsSync(coveragePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(coveragePath, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function writeCoverageIndex(coveragePath: string, index: Record<string, unknown>) {
  fs.mkdirSync(path.dirname(coveragePath), { recursive: true });
  fs.writeFileSync(coveragePath, `${JSON.stringify(index, null, 2)}\n`);
}

// Re-reads coveragePath right before writing, merges only this one key in, then writes - so a
// concurrent process's writes to every other key survive instead of getting clobbered by a
// stale in-memory copy of the whole index.
export function writeCoverageEntry(coveragePath: string, key: string, entry: unknown) {
  const fresh = readCoverageIndex(coveragePath);
  fresh[key] = entry;
  writeCoverageIndex(coveragePath, fresh);
}

// #1105 A3: --all-repos runs every scenario once per real athlete repo, so a plain "manual:<id>"
// key would have all 5 passes overwrite each other's coverage entry. Only append the athlete
// shortcut when one is given (--all-repos, or a future per-repo caller) - a normal run, and a
// --repo run (which still only runs the suite once), keep exactly today's key so every entry
// already on disk in test-results/coverage-index.json stays valid.
export function coverageKey(scenarioId: string, athleteShortcut?: string): string {
  return athleteShortcut ? `manual:${scenarioId}:${athleteShortcut}` : `manual:${scenarioId}`;
}
