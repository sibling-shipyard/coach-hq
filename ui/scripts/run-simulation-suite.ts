#!/usr/bin/env -S npx tsx
/**
 * run-simulation-suite.ts - the fourth, tracked test type (vade-the-tester's original design plan
 * is gone now that its finishing PR landed - see kdb/decisions/0044-vade-the-tester-agent.md):
 * a small library of real FSP/daily-conversation `--turns` scenarios, run one at a time through
 * run-manual-coach-chat-test.ts's real pipeline (real SOUL, real athlete repo, real Gemini call,
 * real commit), scored against each scenario's own `expect` block, with one coverage-index.json
 * entry written per scenario afterward.
 *
 * I don't reimplement anything run-manual-coach-chat-test.ts already does - this drives it as a
 * child process (same way an athlete's own shell would run `npm run test:coach-chat-manual`) and
 * reads back the dated JSON log it already writes under test-results/raw/<date>/manual/. Scratch-branch
 * discipline (never main, never the repo's default branch) is enforced there, not duplicated
 * here - --branch is left unset by default so each scenario gets its own auto-named scratch
 * branch, same as any other manual run.
 *
 * `expect` here checks observed files changed (the real git diff run-manual-coach-chat-test.ts's
 * own log entry already carries, confidence: "observed"), not raw reply action fields the way
 * eval-coach-chat.ts's transcripts do - eval calls askGemini() directly and gets the raw parsed
 * reply back; this tool goes through the full commitTurn() response, which deliberately does not
 * echo action fields (see coachTurn.ts's commitTurn success response) - only reply text, thread
 * state, and repoSha. Checking the observed diff instead is not a downgrade: it's the ground-truth
 * side of the derived/observed distinction coach-chat-testing.md already draws, and it's the same
 * thing a human verifying a manual run by hand is told to check.
 *
 * Usage (from ui/):
 *   npm run test:simulation-suite -- --list
 *   npm run test:simulation-suite                       # run every scenario in the library
 *   npm run test:simulation-suite -- --only fsp          # substring-match on scenario id
 *   npm run test:simulation-suite -- --dry-run           # print what would run, call nothing
 *   npm run test:simulation-suite -- --force              # ignore coverage-index.json, run every
 *                                                          # case regardless of what changed since
 *                                                          # its last pass (a full pre-release run)
 *
 * Selective re-run: before actually running a case, this checks coverage-index.json for an
 * existing `status: "pass"` entry and, if one exists, runs `git diff --quiet <last_pass_sha> HEAD
 * -- <watched_paths...>` - an empty diff means nothing this case exercises has changed since it
 * last passed, so it's skipped (logged, not silent) rather than re-run for free. A case with no
 * entry, or `status: "fail"`, always runs. --force bypasses this check entirely.
 *
 * Needs GEMINI_API_KEY (or OPENROUTER_API_KEY under LLM_PROVIDER=openrouter) the same way
 * run-manual-coach-chat-test.ts does - checked once up front here so a missing key fails fast
 * with one clear message instead of one confusing failure per scenario.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveProviderName } from "../api/_lib/llmClient.js";
import { slugify } from "../api/_lib/slugify.js";
import { dailyLogDir, repoRoot, type FilesChanged, type TestLogEntry } from "./lib/testLog.js";
import { formatCostUsd } from "./lib/llmPricing.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(__dirname, "..");
const examplesDir = path.join(__dirname, "examples");

try {
  process.loadEnvFile(path.join(uiRoot, ".env.local"));
} catch {
  // fine if it doesn't exist - GEMINI_API_KEY may already be in the environment
}

/** One check against a single turn's log entry (matched by `turnIndex`). */
interface TurnExpect {
  turnIndex: number;
  /** Every one of these must appear as a substring of some changed file's path. */
  filesChangedInclude?: string[];
  /** None of these may appear as a substring of any changed file's path. */
  filesChangedExclude?: string[];
  /** Defaults to "PASS" - the harness's own per-turn result. */
  resultMustBe?: "PASS" | "ERROR";
}

interface Scenario {
  id: string;
  file: string;
  description: string;
  /** Passed straight through to run-manual-coach-chat-test.ts's own --athlete shortcut. */
  athlete?: string;
  /** Only when the athlete isn't one of that script's pre-registered shortcuts. */
  repo?: string;
  localPath?: string;
  expect: TurnExpect[];
}

/**
 * Seeded from the FSP/daily example files already in examples/ (vade-the-tester plan's PR1 scope
 * - see kdb/decisions/0044-vade-the-tester-agent.md). No `-727-*` probe files here on purpose -
 * see docs/eng-docs/coach-chat-test-scenarios.md for the full scenario catalog and cut rationale;
 * a single/double-turn check for one specific #727 migration question doesn't belong in a
 * standing regression library.
 *
 * fsp.json runs against coach-skanda-testing, not coach-skanda/coach-akash - a First Session
 * Protocol scenario needs an athlete who hasn't done FSP yet (coachTurn.ts's `firstSession` gate
 * checks `isFirstSessionRitualDone`), and coach-skanda-testing is the one repo
 * docs/eng-docs/coach-chat-testing.md authorizes resetting to a blank state for exactly this. This
 * driver does not reset it itself - that's a separate, explicit step (same doc, "Resetting an
 * athlete repo to a genuinely fresh/blank state") - so running this scenario for real still needs
 * that reset done first if the repo isn't already blank.
 */
const SCENARIOS: Scenario[] = [
  {
    id: "fsp-basic",
    file: "manual-coach-chat-turns-fsp.json",
    description:
      "Full six-turn First Session Protocol - profile, goal, injury, training freq, wrap-up.",
    repo: "skanda-testing/coach-skanda-testing",
    localPath: "/home/skanda_suresh/Projects/coach-skanda-testing",
    expect: [
      { turnIndex: 1, filesChangedInclude: ["user_data/coach/profile.json"] },
      { turnIndex: 3, filesChangedInclude: ["user_data/coach/injuries.json"] },
      { turnIndex: 5 },
    ],
  },
  {
    id: "daily-basic",
    file: "manual-coach-chat-turns-daily.json",
    description: "Ordinary daily check-in - weight update, hip soreness, a finished run, wrap-up.",
    athlete: "skanda",
    // repo is set explicitly (mirroring run-manual-coach-chat-test.ts's own ATHLETE_REPOS map)
    // so repoSlug below resolves to the same log-filename slug that script actually writes -
    // slugifying just "skanda" produced a slug ("skanda") that never matched the real log file
    // ("manual-coach-chat-skanda-2003-coach-skanda-2003-log-...ison"), a real bug caught by a
    // live run against a real repo, not by reading the code.
    repo: "skanda-2003/coach-skanda-2003",
    expect: [
      { turnIndex: 1, filesChangedInclude: ["user_data/coach/profile.json"] },
      { turnIndex: 2, filesChangedInclude: ["user_data/coach/injuries.json"] },
      { turnIndex: 3 },
      { turnIndex: 4 },
    ],
  },
  {
    id: "daily-sleep-skip",
    file: "manual-coach-chat-turns-daily-2.json",
    description:
      "Ordinary daily check-in - poor sleep, a skipped session, tomorrow's commitment, wrap-up.",
    athlete: "akash",
    repo: "akash-suresh/coach-akash-suresh",
    expect: [{ turnIndex: 1 }, { turnIndex: 2 }, { turnIndex: 3 }, { turnIndex: 4 }],
  },
  {
    id: "ambiguous-contradiction",
    file: "manual-coach-chat-turns-ambiguous-contradiction.json",
    description:
      "Athlete reports a planned session done, immediately contradicts it (wrong day), then confirms which one really happened - checks the coach reconciles rather than writing both versions.",
    athlete: "akash",
    repo: "akash-suresh/coach-akash-suresh",
    // The real bug this guards against: a contradiction landing as two conflicting current_week.json
    // writes (the wrongly-claimed session left "done" alongside a synthetically-created new session
    // for the real one) instead of one reconciled state - coachWeekFiles.ts's applyWeekPatch creates
    // a brand-new session whenever a patch entry omits session_id (deliberate, for a genuinely new
    // unplanned session - see that file's own comment), which is exactly the shape this scenario
    // could trigger if the reconciling turn doesn't reference the real existing session_id.
    // TurnExpect only checks which files changed, not their content (see this file's header comment
    // on why - commitTurn() doesn't echo action fields), so this can only verify that turn 3 (the
    // confirm/reconcile turn) actually produces a current_week.json write - it cannot verify from
    // here that the write is a clean single reconciled state rather than a duplicate. That's a real
    // gap in what this harness can check; a human should read the turn 3 log's real diff
    // (docs/eng-docs/coach-chat-testing.md, "Verifying a result") the first time this runs live.
    expect: [
      { turnIndex: 1, filesChangedInclude: ["user_data/ledger/current_week.json"] },
      { turnIndex: 3, filesChangedInclude: ["user_data/ledger/current_week.json"] },
    ],
  },
];

/** coach-hq paths that, if changed, could invalidate a scenario's last pass - coverage-index.json's watched_paths. */
const WATCHED_PATHS = [
  "ui/api/coach-chat.ts",
  "ui/api/coach-chat/_lib/coachTurn.ts",
  "ui/api/coach-chat/_lib/gemini/coachPromptText.ts",
  "ui/api/coach-chat/_lib/gemini/coachReplySchema.ts",
  "ui/api/coach-chat/_lib/gemini/geminiClient.ts",
  "ui/api/coach-chat/_lib/decide/turnWrites/",
  "ui/api/_lib/llmClient.ts",
  "ui/api/_lib/llmAdapters/",
];

interface ManualLogEntry extends TestLogEntry {
  turnIndex: number;
  filesChanged: FilesChanged;
  // #1053 gap 2: real per-turn cost, written by run-manual-coach-chat-test.ts now that
  // coachTurn.ts surfaces real usage - summed here so a scenario's console output shows real
  // spend, same number a day-doc's Simulation suite section reports.
  costUsd?: number;
}

function parseArgs(argv: string[]) {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx !== -1 ? argv[idx + 1] : undefined;
  };
  return {
    list: argv.includes("--list"),
    only: get("--only"),
    dryRun: argv.includes("--dry-run"),
    // Bypasses the selective-re-run check below entirely - a full run before a release, an
    // explicit ask, not the default.
    force: argv.includes("--force"),
    // #1053 gap 3: overrides which scratch branch every selected scenario runs against, passed
    // straight through to run-manual-coach-chat-test.ts's own --branch. Needed for fsp-basic: it
    // runs against coach-skanda-testing, which needs a fresh reset onto a NEW scratch branch first
    // (docs/eng-docs/coach-chat-testing.md's reset procedure) - without this, the driver could
    // only ever run fsp-basic against an auto-named branch it creates itself, never the specific
    // already-reset one. Applies to every scenario the invocation selects (--only narrows to one
    // in practice) - there was no need for a per-scenario field in the SCENARIOS library above.
    branch: get("--branch"),
  };
}

interface CoverageEntry {
  type: string;
  last_pass_sha: string | null;
  last_run_date: string;
  watched_paths: string[];
  status: "pass" | "fail";
  last_cost_usd?: number;
}

/**
 * True when HQ has changed anything under `watchedPaths` since `lastPassSha`. `git diff --quiet`
 * exits 0 (no diff -> execFileSync doesn't throw) or 1 (real diff -> throws) for a valid range;
 * any other failure (bad/unreachable sha, e.g. after a history rewrite) is treated as "changed" -
 * re-running an unnecessary case is cheap next to silently skipping a case that needs it.
 */
function watchedPathsChanged(lastPassSha: string, watchedPaths: string[]): boolean {
  try {
    execFileSync("git", ["diff", "--quiet", lastPassSha, "HEAD", "--", ...watchedPaths], {
      cwd: repoRoot,
      stdio: "pipe",
    });
    return false;
  } catch {
    return true;
  }
}

function findLatestManualLog(repoSlug: string, sinceMs: number): string | undefined {
  const { dir } = dailyLogDir("manual");
  if (!fs.existsSync(dir)) return undefined;
  const prefix = `manual-coach-chat-${repoSlug}-log-`;
  const candidates = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
    .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .filter((c) => c.mtime >= sinceMs)
    .sort((a, b) => b.mtime - a.mtime);
  return candidates[0] ? path.join(dir, candidates[0].f) : undefined;
}

function scoreScenario(
  scenario: Scenario,
  entries: ManualLogEntry[],
): { pass: boolean; failures: string[] } {
  const failures: string[] = [];
  for (const turnExpect of scenario.expect) {
    const entry = entries.find((e) => e.turnIndex === turnExpect.turnIndex);
    if (!entry) {
      failures.push(`turn ${turnExpect.turnIndex}: no log entry found`);
      continue;
    }
    const wantResult = turnExpect.resultMustBe ?? "PASS";
    if (entry.result !== wantResult) {
      failures.push(
        `turn ${turnExpect.turnIndex}: expected result ${wantResult}, got ${entry.result}`,
      );
    }
    const files = entry.filesChanged?.files ?? [];
    for (const want of turnExpect.filesChangedInclude ?? []) {
      if (!files.some((f) => f.includes(want))) {
        failures.push(
          `turn ${turnExpect.turnIndex}: expected a changed file matching "${want}", got [${files.join(", ")}]`,
        );
      }
    }
    for (const unwanted of turnExpect.filesChangedExclude ?? []) {
      if (files.some((f) => f.includes(unwanted))) {
        failures.push(
          `turn ${turnExpect.turnIndex}: expected no changed file matching "${unwanted}", got [${files.join(", ")}]`,
        );
      }
    }
  }
  return { pass: failures.length === 0, failures };
}

function readCoverageIndex(coveragePath: string): Record<string, unknown> {
  if (!fs.existsSync(coveragePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(coveragePath, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeCoverageIndex(coveragePath: string, index: Record<string, unknown>) {
  fs.mkdirSync(path.dirname(coveragePath), { recursive: true });
  fs.writeFileSync(coveragePath, `${JSON.stringify(index, null, 2)}\n`);
}

function currentHqSha(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    for (const s of SCENARIOS) console.log(`${s.id} - ${s.description}`);
    return;
  }

  const scenarios = args.only ? SCENARIOS.filter((s) => s.id.includes(args.only!)) : SCENARIOS;
  if (scenarios.length === 0) {
    console.error(`run-simulation-suite: no scenario matches --only "${args.only}".`);
    process.exit(1);
    return;
  }

  const usingOpenRouter = resolveProviderName(process.env) === "openrouter";
  const requiredKeyName = usingOpenRouter ? "OPENROUTER_API_KEY" : "GEMINI_API_KEY";
  const haveKey = Boolean(process.env[requiredKeyName]);
  if (!args.dryRun && !haveKey) {
    console.error(
      `run-simulation-suite: ${requiredKeyName} not set (check ui/.env.local or export it) - ` +
        `every scenario here makes a real, paid Gemini call. Pass --dry-run to see the plan ` +
        `without spending anything, or set the key to actually run it.`,
    );
    process.exit(1);
    return;
  }

  const coveragePath = path.join(repoRoot, "test-results", "coverage-index.json");
  const coverageIndex = readCoverageIndex(coveragePath);
  const hqSha = currentHqSha();
  const today = new Date().toISOString().slice(0, 10);

  let anyFailed = false;
  for (const scenario of scenarios) {
    const key = `manual:${scenario.id}`;
    const existing = coverageIndex[key] as CoverageEntry | undefined;
    if (!args.force && existing?.status === "pass" && existing.last_pass_sha) {
      const watched = existing.watched_paths ?? WATCHED_PATHS;
      if (!watchedPathsChanged(existing.last_pass_sha, watched)) {
        console.log(
          `[skip] ${scenario.id}: no diff between ${existing.last_pass_sha.slice(0, 7)} and HEAD` +
            ` across ${watched.length} watched path(s) (${watched.join(", ")}); last passed` +
            ` ${existing.last_run_date}. Use --force to run anyway.`,
        );
        continue;
      }
    }

    const turnsPath = path.join(examplesDir, scenario.file);
    const scriptArgs = [
      "tsx",
      "--tsconfig",
      "tsconfig.json",
      "scripts/run-manual-coach-chat-test.ts",
      ...(scenario.athlete ? ["--athlete", scenario.athlete] : []),
      ...(scenario.repo ? ["--repo", scenario.repo] : []),
      ...(scenario.localPath ? ["--local-path", scenario.localPath] : []),
      ...(args.branch ? ["--branch", args.branch] : []),
      "--turns",
      turnsPath,
    ];

    if (args.dryRun) {
      console.log(`[dry-run] ${scenario.id}: would run - npx ${scriptArgs.join(" ")}`);
      continue;
    }

    console.log(
      `\n=== ${scenario.id} (running - ${existing ? "diff since last pass" : "no prior pass"}) ===`,
    );
    const repoSlug = slugify(scenario.repo ?? scenario.athlete ?? scenario.id, "-");
    const startMs = Date.now();
    try {
      execFileSync("npx", scriptArgs, { cwd: uiRoot, stdio: "inherit" });
    } catch {
      // run-manual-coach-chat-test.ts exits non-zero on any ERROR/unconfirmed-audit turn - that's
      // not fatal to scoring here, the log it already wrote is what scoring reads next.
    }

    const logPath = findLatestManualLog(repoSlug, startMs);
    if (!logPath) {
      console.log(`${scenario.id}: no run log found - treating as a hard failure.`);
      anyFailed = true;
      coverageIndex[key] = {
        type: "manual",
        last_pass_sha:
          (coverageIndex[key] as { last_pass_sha?: string } | undefined)?.last_pass_sha ?? null,
        last_run_date: today,
        watched_paths: WATCHED_PATHS,
        status: "fail",
      };
      continue;
    }

    const entries = JSON.parse(fs.readFileSync(logPath, "utf8")) as ManualLogEntry[];
    const { pass, failures } = scoreScenario(scenario, entries);
    const scenarioCostUsd = entries.reduce((sum, e) => sum + (e.costUsd ?? 0), 0);
    console.log(
      `${scenario.id}: ${pass ? "PASS" : "FAIL"} (log: ${path.relative(repoRoot, logPath)}, cost: ${formatCostUsd(scenarioCostUsd)})`,
    );
    for (const f of failures) console.log(`  - ${f}`);
    if (!pass) anyFailed = true;

    coverageIndex[key] = {
      type: "manual",
      last_pass_sha: pass
        ? hqSha
        : ((coverageIndex[key] as { last_pass_sha?: string } | undefined)?.last_pass_sha ?? null),
      last_run_date: today,
      watched_paths: WATCHED_PATHS,
      status: pass ? "pass" : "fail",
      last_cost_usd: scenarioCostUsd,
    };
  }

  if (args.dryRun) return;

  writeCoverageIndex(coveragePath, coverageIndex);
  console.log(`\nCoverage index written to ${path.relative(repoRoot, coveragePath)}`);
  if (anyFailed) process.exit(2);
}

main();
