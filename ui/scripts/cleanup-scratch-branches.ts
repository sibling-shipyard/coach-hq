#!/usr/bin/env -S npx tsx
/**
 * cleanup-scratch-branches.ts - closes the gap coach-chat-testing.md named since before this
 * plan started: "scratch branches accumulate, nothing sweeps them." test:coach-chat-manual and
 * run-simulation-suite.ts each mint a `test/manual-<timestamp>` (or a hand-named `test/`/`retest/`
 * branch) on a real athlete repo every time they run, and nothing ever removes one. This lists
 * them (with real age, via a real `gh api` commit lookup, not a guess), and only deletes on an
 * explicit --delete flag.
 *
 * By default this only lists/reports - never deletes anything. Even with --delete, it refuses to
 * touch the repo's actual default branch or anything literally named "main" - same hard-coded
 * discipline run-manual-coach-chat-test.ts already has for creating branches, applied here to
 * removing them. That refusal isn't just belt-and-suspenders against a bad regex match: it's the
 * one guarantee this tool makes regardless of what --older-than or the branch list say.
 *
 * Usage (from ui/):
 *   npm run cleanup-scratch-branches -- --athlete skanda
 *   npm run cleanup-scratch-branches -- --repo owner/name
 *   npm run cleanup-scratch-branches -- --athlete skanda --older-than 14
 *   npm run cleanup-scratch-branches -- --athlete skanda --older-than 14 --delete
 *
 * Needs a `gh auth` session, same as run-manual-coach-chat-test.ts - this only ever talks to the
 * GitHub API, never a local clone, so --local-path is not accepted (nothing here reads one).
 */
import { execFileSync } from "node:child_process";

// Same shortcut set run-manual-coach-chat-test.ts's ATHLETE_REPOS carries, repo names only - this
// tool never touches a local clone, so no localPath is needed here. Kept as its own small copy
// rather than importing that script: importing it would run its own top-level API-key check and
// process.exit, which has nothing to do with listing branches.
const ATHLETE_REPOS: Record<string, string> = {
  skanda: "skanda-2003/coach-skanda-2003",
  akash: "akash-suresh/coach-akash-suresh",
  date2022: "date2022/coach-date2022",
  prateek: "prateekdevaraju/coach-prateekdevaraju",
  shreyas: "shreyas-95-cyber/coach-shreyas-95-cyber",
  "skanda-testing": "skanda-testing/coach-skanda-testing",
};

const SCRATCH_BRANCH_RE = /^(test|retest)\//;

interface BranchInfo {
  name: string;
  sha: string;
  committedAt: string;
  ageDays: number;
}

function parseArgs(argv: string[]) {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx !== -1 ? argv[idx + 1] : undefined;
  };
  const olderThanRaw = get("--older-than");
  return {
    athlete: get("--athlete"),
    repo: get("--repo"),
    olderThanDays: olderThanRaw !== undefined ? Number(olderThanRaw) : undefined,
    delete: argv.includes("--delete"),
  };
}

function ghApiJson<T>(path: string): T {
  const out = execFileSync("gh", ["api", path], { encoding: "utf8" });
  return JSON.parse(out) as T;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  let repo: string;
  if (args.athlete) {
    const known = ATHLETE_REPOS[args.athlete];
    if (!known) {
      console.error(
        `cleanup-scratch-branches: unknown --athlete "${args.athlete}" (known: ${Object.keys(ATHLETE_REPOS).join(", ")}).`,
      );
      process.exit(1);
      return;
    }
    repo = known;
  } else if (args.repo) {
    repo = args.repo;
  } else {
    console.error("cleanup-scratch-branches: pass --athlete <name> or --repo <owner/name>.");
    process.exit(1);
    return;
  }

  if (args.olderThanDays !== undefined && Number.isNaN(args.olderThanDays)) {
    console.error("cleanup-scratch-branches: --older-than needs a number of days.");
    process.exit(1);
    return;
  }

  const repoInfo = ghApiJson<{ default_branch: string }>(`repos/${repo}`);
  const defaultBranch = repoInfo.default_branch;

  // Paginate via gh's own --paginate flag rather than hand-rolling Link-header parsing.
  const allBranches = JSON.parse(
    execFileSync("gh", ["api", `repos/${repo}/branches`, "--paginate"], { encoding: "utf8" }),
  ) as { name: string; commit: { sha: string } }[];

  const candidates = allBranches.filter(
    (b) => SCRATCH_BRANCH_RE.test(b.name) && b.name !== defaultBranch && b.name !== "main",
  );

  const now = Date.now();
  const infos: BranchInfo[] = candidates.map((b) => {
    const detail = ghApiJson<{ commit: { commit: { committer: { date: string } } } }>(
      `repos/${repo}/branches/${encodeURIComponent(b.name)}`,
    );
    const committedAt = detail.commit.commit.committer.date;
    const ageDays = (now - new Date(committedAt).getTime()) / (1000 * 60 * 60 * 24);
    return { name: b.name, sha: b.commit.sha, committedAt, ageDays };
  });

  const filtered =
    args.olderThanDays === undefined
      ? infos
      : infos.filter((i) => i.ageDays >= args.olderThanDays!);

  filtered.sort((a, b) => b.ageDays - a.ageDays);

  console.log(`${repo} (default branch: ${defaultBranch})`);
  console.log(
    `${filtered.length} scratch branch(es) matching ^(test|retest)/` +
      (args.olderThanDays !== undefined ? ` and older than ${args.olderThanDays}d` : "") +
      ` (of ${candidates.length} total scratch branches).`,
  );
  for (const i of filtered) {
    console.log(
      `  ${i.name}  ${i.ageDays.toFixed(1)}d old  ${i.sha.slice(0, 7)}  ${i.committedAt}`,
    );
  }

  if (!args.delete) {
    if (filtered.length > 0) console.log("\nList only - pass --delete to actually remove these.");
    return;
  }

  if (filtered.length === 0) {
    console.log("\nNothing to delete.");
    return;
  }

  console.log("\nDeleting:");
  for (const i of filtered) {
    // Same hard refusal as run-manual-coach-chat-test.ts's branch-creation guard, applied to
    // deletion - no override flag exists for this check, on purpose.
    if (i.name === defaultBranch || i.name === "main") {
      console.error(`  refusing to delete "${i.name}" - that's the default branch (or "main").`);
      continue;
    }
    try {
      execFileSync("gh", ["api", "-X", "DELETE", `repos/${repo}/git/refs/heads/${i.name}`]);
      console.log(`  deleted ${i.name}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  failed to delete ${i.name}: ${message}`);
    }
  }
}

main();
