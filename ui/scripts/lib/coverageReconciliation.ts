// Core logic for check-coverage-reconciliation.ts, factored out here (rather than left in the
// script) so a test can call it directly against fixture directories instead of the real repo's
// test-results/ - same split as coverageIndex.ts/testLog.ts (logic in lib/, a thin CLI wrapper in
// scripts/ that wires it to the real repoRoot and process.exit).
import fs from "node:fs";
import path from "node:path";

import { slugify } from "../../api/_lib/slugify.js";
import { readCoverageIndex } from "./coverageIndex.js";

// #1105 A3 introduced an athlete-suffixed coverage-index.json key (`manual:<id>:<athlete>`) for
// scenarios run via --repo/--all-repos, distinct from the plain `manual:<id>` an unoverridden run
// writes. This reconciliation tool has to recognize both shapes or it reports every --all-repos
// run as a false "no entry at all". Not an import of lib/athleteRepos.ts's ATHLETE_REPOS - same
// reasoning as SCENARIO_REPOS below: this tool needs to stand alone on `main` without depending
// on a sibling PR's file existing yet. Keep this list in sync by hand with ATHLETE_REPOS.
const ATHLETE_SHORTCUTS: Record<string, string> = {
  skanda: "skanda-2003/coach-skanda-2003",
  akash: "akash-suresh/coach-akash-suresh",
  date2022: "date2022/coach-date2022",
  prateek: "prateekdevaraju/coach-prateekdevaraju",
  shreyas: "shreyas-95-cyber/coach-shreyas-95-cyber",
};
const SLUG_TO_ATHLETE = new Map<string, string>(
  Object.entries(ATHLETE_SHORTCUTS).map(([shortcut, repo]) => [slugify(repo, "-"), shortcut]),
);

// Mirrors run-manual-simulation-suite.ts's SCENARIOS list - just the id and whichever of repo/athlete
// each one passes to run-manual-coach-chat-test.ts, enough to reconstruct the same repo slug
// findLatestManualLog there computes. Not an import of that module: it calls main() at its own
// top level unconditionally, so importing it here would run the real (paid) suite as a side
// effect. Keep this table in sync by hand when a scenario is added, renamed, or moves repos.
const SCENARIO_REPOS: { id: string; repo: string; file: string }[] = [
  {
    id: "fsp-end-to-end",
    repo: "skanda-testing/coach-skanda-testing",
    file: "manual-coach-chat-turns-fsp-end-to-end.json",
  },
  {
    id: "daily-basic",
    repo: "skanda-2003/coach-skanda-2003",
    file: "manual-coach-chat-turns-daily.json",
  },
  {
    id: "daily-sleep-skip",
    repo: "akash-suresh/coach-akash-suresh",
    file: "manual-coach-chat-turns-daily-2.json",
  },
  {
    id: "ambiguous-contradiction",
    repo: "akash-suresh/coach-akash-suresh",
    file: "manual-coach-chat-turns-ambiguous-contradiction.json",
  },
  {
    id: "workout-lifecycle",
    repo: "skanda-2003/coach-skanda-2003",
    file: "manual-coach-chat-turns-workout-lifecycle.json",
  },
  {
    id: "session-plan",
    repo: "akash-suresh/coach-akash-suresh",
    file: "manual-coach-chat-turns-session-plan.json",
  },
  {
    id: "week-kickoff-flash",
    repo: "akash-suresh/coach-akash-suresh",
    file: "manual-coach-chat-turns-week-kickoff.json",
  },
  {
    id: "injury-resolve-by-bodypart",
    repo: "skanda-2003/coach-skanda-2003",
    file: "manual-coach-chat-turns-injury-resolve-by-bodypart.json",
  },
  {
    id: "pattern-style-sport",
    repo: "akash-suresh/coach-akash-suresh",
    file: "manual-coach-chat-turns-pattern-style-sport.json",
  },
  {
    id: "season-transition",
    repo: "skanda-2003/coach-skanda-2003",
    file: "manual-coach-chat-turns-season-transition.json",
  },
  {
    id: "quest-event",
    repo: "akash-suresh/coach-akash-suresh",
    file: "manual-coach-chat-turns-quest-event.json",
  },
  {
    id: "quest-create-standalone",
    repo: "skanda-2003/coach-skanda-2003",
    file: "manual-coach-chat-turns-quest-create-standalone.json",
  },
  {
    id: "template-edit-permanent",
    repo: "akash-suresh/coach-akash-suresh",
    file: "manual-coach-chat-turns-template-edit.json",
  },
];

// repo slug -> every scenario id that runs against it (several scenarios can share a repo, e.g.
// skanda-2003/coach-skanda-2003) - built once rather than scanning the table per log file.
const SCENARIOS_BY_REPO_SLUG = new Map<string, { id: string; file: string }[]>();
for (const { id, repo, file } of SCENARIO_REPOS) {
  const slug = slugify(repo, "-");
  const existing = SCENARIOS_BY_REPO_SLUG.get(slug);
  if (existing) existing.push({ id, file });
  else SCENARIOS_BY_REPO_SLUG.set(slug, [{ id, file }]);
}

// A scenario's hardcoded default repo doesn't limit which real repo it can actually run
// against - --repo/--all-repos can point any scenario at any of the 5. A raw log's repo slug
// alone is therefore not enough to identify which scenario produced it when that slug is one of
// the 5 real repos; only turn content can. So for those slugs, every scenario in the library is
// a candidate for matchScenario's content check below, not just the ones whose own default repo
// happens to equal the slug.
const ALL_SCENARIO_CANDIDATES = SCENARIO_REPOS.map(({ id, file }) => ({ id, file }));
const REAL_ATHLETE_REPO_SLUGS = new Set(
  Object.values(ATHLETE_SHORTCUTS).map((repo) => slugify(repo, "-")),
);

interface CoverageEntry {
  last_run_date?: string;
  [key: string]: unknown;
}

// A raw log's own turns[].input, so a scenario can be picked out by comparing message content
// when more than one scenario shares a repo slug.
interface RawLogTurn {
  input?: { message?: string; action?: string; activity_ids?: string[] };
}

interface ExampleTurn {
  message?: string;
  greet?: true;
  activityIds?: string[];
}

function exampleTurnSignature(turn: ExampleTurn): string {
  if (turn.greet) return "greet";
  if (turn.activityIds) return `activity_sync:${turn.activityIds.join(",")}`;
  return turn.message ?? "";
}

function rawLogSignature(entries: RawLogTurn[]): string {
  return entries
    .map((e) => {
      if (e.input?.action === "greet") return "greet";
      if (e.input?.action === "activity_sync")
        return `activity_sync:${(e.input.activity_ids ?? []).join(",")}`;
      return e.input?.message ?? "";
    })
    .join("|");
}

/**
 * Which scenario (if any) a raw log file's repo slug + turn content matches. Returns undefined
 * for a repo slug outside the table (an ad-hoc manual run, never expected to have a
 * coverage-index.json entry) and `{ ambiguous }` when more than one candidate's example turns
 * file matches the log's own turn content equally (or none do) - a real problem worth reporting,
 * not silently picking one.
 */
function matchScenario(
  repoSlug: string,
  entries: RawLogTurn[],
  examplesDir: string,
): { scenarioId: string } | { ambiguous: string[] } | undefined {
  // A real athlete repo's slug could be hosting any scenario via --repo/--all-repos, not just
  // the ones whose own hardcoded default happens to be this repo - widen the candidate pool for
  // those slugs rather than trusting the narrower default-only list SCENARIOS_BY_REPO_SLUG builds.
  const candidates = REAL_ATHLETE_REPO_SLUGS.has(repoSlug)
    ? ALL_SCENARIO_CANDIDATES
    : SCENARIOS_BY_REPO_SLUG.get(repoSlug);
  if (!candidates) return undefined;
  if (candidates.length === 1) return { scenarioId: candidates[0].id };

  const logSig = rawLogSignature(entries);
  const matches: string[] = [];
  for (const { id, file } of candidates) {
    const examplePath = path.join(examplesDir, file);
    if (!fs.existsSync(examplePath)) continue;
    const turns = JSON.parse(fs.readFileSync(examplePath, "utf8")) as ExampleTurn[];
    const exampleSig = turns.map(exampleTurnSignature).join("|");
    if (exampleSig === logSig) matches.push(id);
  }
  if (matches.length === 1) return { scenarioId: matches[0] };
  return { ambiguous: matches.length > 0 ? matches : candidates.map((c) => c.id) };
}

export interface ReconciliationResult {
  ok: boolean;
  lines: string[];
}

/**
 * Reads every raw log under `rawManualDir` (one file per completed run-manual-coach-chat-test.ts
 * invocation), matches each one to a scenario via `examplesDir`'s turns files, and diffs against
 * `coveragePath`'s `manual:<scenario id>` entries for `date`.
 */
export function checkReconciliation(
  date: string,
  rawManualDir: string,
  coveragePath: string,
  examplesDir: string,
): ReconciliationResult {
  const lines: string[] = [];
  let ok = true;

  if (!fs.existsSync(rawManualDir)) {
    lines.push(`No raw run logs found for ${date} under ${rawManualDir} - nothing to reconcile.`);
    return { ok, lines };
  }

  const coverageIndex = readCoverageIndex(coveragePath);
  const logFiles = fs
    .readdirSync(rawManualDir)
    .filter((f) => f.startsWith("manual-coach-chat-") && f.endsWith(".json"))
    .sort();

  if (logFiles.length === 0) {
    lines.push(`No raw run logs found for ${date} under ${rawManualDir} - nothing to reconcile.`);
    return { ok, lines };
  }

  for (const file of logFiles) {
    const m = /^manual-coach-chat-(.+)-log-\d{2}-\d{2}-\d{2}\.json$/.exec(file);
    if (!m) {
      lines.push(`  ? ${file}: doesn't match the expected manual log filename shape - skipped.`);
      continue;
    }
    const repoSlug = m[1];
    const entries = JSON.parse(
      fs.readFileSync(path.join(rawManualDir, file), "utf8"),
    ) as RawLogTurn[];
    const match = matchScenario(repoSlug, entries, examplesDir);

    if (match === undefined) {
      // Not one of the suite's known scenarios (an ad-hoc manual run) - never expected to have a
      // coverage-index.json entry, so this isn't a mismatch.
      continue;
    }
    if ("ambiguous" in match) {
      ok = false;
      lines.push(
        `  x ${file}: repo slug "${repoSlug}" matches more than one scenario (${match.ambiguous.join(", ")}) and couldn't be narrowed to exactly one by comparing turn content - can't reconcile.`,
      );
      continue;
    }

    // A3 writes the plain key for an unoverridden run (a scenario against its own hardcoded
    // repo) and the athlete-suffixed key for a --repo/--all-repos override. This raw log's own
    // repo slug can't tell us which mode produced it, so check both - a scenario pinned to this
    // repo by default and one that landed here via an override are indistinguishable from the
    // log alone, and either key reconciling the run is a real "yes, this was recorded."
    const plainKey = `manual:${match.scenarioId}`;
    const athleteShortcut = SLUG_TO_ATHLETE.get(repoSlug);
    const suffixedKey = athleteShortcut ? `manual:${match.scenarioId}:${athleteShortcut}` : null;
    const entry =
      (coverageIndex[plainKey] as CoverageEntry | undefined) ??
      (suffixedKey ? (coverageIndex[suffixedKey] as CoverageEntry | undefined) : undefined);
    const key = coverageIndex[plainKey] ? plainKey : (suffixedKey ?? plainKey);
    if (!entry) {
      ok = false;
      const checked = suffixedKey ? `"${plainKey}" or "${suffixedKey}"` : `"${plainKey}"`;
      lines.push(
        `  x ${file}: scenario "${match.scenarioId}" ran (this raw log exists) but coverage-index.json has no ${checked} entry.`,
      );
    } else if (entry.last_run_date !== date) {
      ok = false;
      lines.push(
        `  x ${file}: scenario "${match.scenarioId}" ran on ${date} but coverage-index.json's "${key}" entry is stale (last_run_date: ${entry.last_run_date ?? "missing"}).`,
      );
    } else {
      lines.push(`  ok ${file}: scenario "${match.scenarioId}" reconciled.`);
    }
  }

  return { ok, lines };
}
