#!/usr/bin/env -S npx tsx
/**
 * run-manual-coach-message-test.ts — drives a real call through the hosted coach-message handler
 * (`handle()` in ui/api/coach-message.ts) against a real local clone of an athlete repo, on a
 * real scratch branch. Same philosophy as run-manual-coach-chat-test.ts: nothing here is fixture
 * data, this calls a live Gemini key and writes a real commit through the real GitHub API.
 *
 * coach-message is a genuinely separate endpoint from coach-chat - it's the post-sync proactive
 * generator, triggered after real HealthKit/Strava sync, not reachable through coach-chat.ts's
 * handle() at all. It had zero test coverage before this script (2026-09-10).
 *
 * This is a manual, on-demand tool. It is NEVER run in CI - it costs a real Gemini call and
 * writes a real commit to a real athlete repo.
 *
 * **Branch:** `--branch` is optional - omit it and the script names and creates one itself
 * (`test/manual-message-<timestamp>`, cut from the repo's real default branch HEAD). Refuses to
 * run against the real default branch or literally "main" - same hard requirement as
 * run-manual-coach-chat-test.ts, no override.
 *
 * Usage (from ui/):
 *   npm run test:coach-message-manual -- --athlete skanda --activity-ids "healthkit:UUID1"
 *   npm run test:coach-message-manual -- --repo owner/name --local-path /path --activity-ids "healthkit:UUID1,strava:12345"
 *
 * `--activity-ids` are real ids in canonical form: `healthkit:<UPPERCASE-UUID>` (the uppercased
 * uuid segment of a real user_data/activities/hist/hk_<date>_<uuid>.json filename) or
 * `strava:<numeric-id>`. Must be sorted and unique - the endpoint itself validates and 400s
 * otherwise, so this script sorts/dedupes for you rather than replicating that check twice.
 *
 * Needs GEMINI_API_KEY in ui/.env.local or env, and a GitHub CLI session (`gh auth token`).
 *
 * Run log: writes <repo-root>/tests/<YYYY-MM-DD>/manual/manual-coach-message-<repo-slug>-log-<HH-MM-SS>.json.
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fetchWithTimeout } from "../api/_lib/httpTimeout.js";
import { getHeadSha } from "../api/coach-chat/_lib/decide/coachChatFiles.js";
import { handle } from "../api/coach-message.js";
import type { RepoAuthContext } from "../api/auth/_lib/resolve-auth.js";
import { writeTestLog, type TestLogEntry } from "./lib/testLog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(__dirname, "..");

try {
  process.loadEnvFile(path.join(uiRoot, ".env.local"));
} catch {
  // fine if it doesn't exist - GEMINI_API_KEY may already be in the environment
}

const apiKey = process.env.GEMINI_API_KEY;
const openrouterKey = process.env.OPENROUTER_API_KEY;
if (!apiKey && !(process.env.LLM_PROVIDER === "openrouter" && openrouterKey)) {
  console.error(
    "run-manual-coach-message-test: GEMINI_API_KEY not set (check ui/.env.local or export it).",
  );
  process.exit(1);
}

const ATHLETE_REPOS: Record<string, { repo: string; localPath: string }> = {
  skanda: {
    repo: "skanda-2003/coach-skanda-2003",
    localPath: "/home/skanda_suresh/Projects/coach-skanda",
  },
  akash: {
    repo: "akash-suresh/coach-akash-suresh",
    localPath: "/home/skanda_suresh/Projects/coach-akash",
  },
};

interface ManualLogEntry extends TestLogEntry {
  kind: "manual";
  repo: string;
  branch: string;
  shaBefore: string | null;
  shaAfter: string | null;
}

function parseArgs(argv: string[]) {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx !== -1 ? argv[idx + 1] : undefined;
  };
  return {
    athlete: get("--athlete"),
    repo: get("--repo"),
    localPath: get("--local-path"),
    branch: get("--branch"),
    activityIds: get("--activity-ids"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let repo: string;
  if (args.athlete) {
    const known = ATHLETE_REPOS[args.athlete];
    if (!known) {
      console.error(
        `run-manual-coach-message-test: unknown --athlete "${args.athlete}" (known: ${Object.keys(ATHLETE_REPOS).join(", ")}).`,
      );
      process.exit(1);
      return;
    }
    repo = known.repo;
  } else if (args.repo) {
    repo = args.repo;
  } else {
    console.error(
      "run-manual-coach-message-test: pass --athlete <skanda|akash> or --repo <owner/name>.",
    );
    process.exit(1);
    return;
  }

  if (!args.activityIds) {
    console.error(
      'run-manual-coach-message-test: pass --activity-ids "healthkit:UUID1,strava:12345".',
    );
    process.exit(1);
    return;
  }
  const activityIds = [...new Set(args.activityIds.split(",").map((id) => id.trim()))].sort();

  const token = execSync("gh auth token", { encoding: "utf8" }).trim();
  const ghHeaders = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const branch = args.branch ?? `test/manual-message-${stamp}`;

  const repoInfoRes = await fetchWithTimeout(`https://api.github.com/repos/${repo}`, {
    headers: ghHeaders,
  });
  if (!repoInfoRes.ok) {
    console.error(
      `run-manual-coach-message-test: couldn't look up ${repo} (${repoInfoRes.status}).`,
    );
    process.exit(1);
    return;
  }
  const repoInfo = (await repoInfoRes.json()) as { default_branch: string };
  if (branch === "main" || branch === repoInfo.default_branch) {
    console.error(
      `run-manual-coach-message-test: refusing to run against "${branch}" - that's ${repo}'s default branch (or literally "main"). Use a scratch branch.`,
    );
    process.exit(1);
    return;
  }

  const branchRefRes = await fetchWithTimeout(
    `https://api.github.com/repos/${repo}/git/ref/heads/${branch}`,
    { headers: ghHeaders },
  );
  if (branchRefRes.status === 404) {
    const defaultHeadSha = await getHeadSha(repo, token, repoInfo.default_branch);
    const createRes = await fetchWithTimeout(`https://api.github.com/repos/${repo}/git/refs`, {
      method: "POST",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: defaultHeadSha }),
    });
    if (!createRes.ok) {
      console.error(
        `run-manual-coach-message-test: couldn't create branch "${branch}" (${createRes.status}).`,
      );
      process.exit(1);
      return;
    }
    console.log(
      `Created scratch branch "${branch}" off ${repoInfo.default_branch} (${defaultHeadSha.slice(0, 7)}).`,
    );
  } else if (!branchRefRes.ok) {
    console.error(
      `run-manual-coach-message-test: couldn't check whether "${branch}" exists (${branchRefRes.status}).`,
    );
    process.exit(1);
    return;
  }
  console.log(`Running against ${repo}@${branch}`);

  // resolveCoachChatBranch() (coach-message.ts's own file-read/commit target) reads this env
  // var, defaulting to "main" - same mechanism the coach-chat harness already relies on.
  process.env.COACH_CHAT_BRANCH = branch;

  const auth: RepoAuthContext = { gh_token: token, repo_full_name: repo };

  let shaBeforeFailed = false;
  const shaBefore = await getHeadSha(repo, token, branch).catch(() => {
    shaBeforeFailed = true;
    return null;
  });

  let result: "PASS" | "ERROR" = "PASS";
  const failures: string[] = [];
  let output: unknown;

  try {
    const res = await handle(
      new Request("http://localhost/api/coach-message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ activity_ids: activityIds }),
      }),
      auth,
    );
    const json = (await res.json()) as Record<string, unknown>;
    output = json;
    console.log("[coach-message] response:", json);
    if (!res.ok) {
      result = "ERROR";
      failures.push(`HTTP ${res.status}: ${String(json.error ?? "unknown error")}`);
    }
  } catch (err) {
    result = "ERROR";
    output = { error: err instanceof Error ? err.message : String(err) };
    failures.push(err instanceof Error ? err.message : String(err));
    console.error("[coach-message] handle() threw:", err);
  }

  let shaAfterFailed = false;
  const shaAfter = await getHeadSha(repo, token, branch).catch(() => {
    shaAfterFailed = true;
    return null;
  });

  const filesChanged =
    shaBefore && shaAfter && shaBefore !== shaAfter
      ? await (async () => {
          const compareRes = await fetchWithTimeout(
            `https://api.github.com/repos/${repo}/compare/${shaBefore}...${shaAfter}`,
            { headers: ghHeaders },
          );
          const compare = (await compareRes.json()) as { files?: { filename: string }[] };
          return {
            confidence: "observed" as const,
            files: (compare.files ?? []).map((f) => f.filename),
            diff: `${shaBefore}..${shaAfter}`,
          };
        })()
      : {
          confidence: "observed" as const,
          files: [],
          diff:
            shaBeforeFailed || shaAfterFailed ? "sha lookup failed" : "no commit (sha unchanged)",
        };

  const entry: ManualLogEntry = {
    kind: "manual",
    name: "coach-message",
    repo,
    branch,
    shaBefore,
    shaAfter,
    input: { activity_ids: activityIds },
    output,
    result,
    failures: failures.length > 0 ? failures : undefined,
    filesChanged,
  };

  const repoSlug = repo.split("/")[1] ?? repo;
  writeTestLog("manual", `manual-coach-message-${repoSlug}`, [entry]);

  console.log(`\n${result === "PASS" ? "1/1 passed." : `0/1 passed - ${failures.join("; ")}`}`);
  if (result === "ERROR") process.exitCode = 1;
}

main().catch((err) => {
  console.error("run-manual-coach-message-test: fatal error:", err);
  process.exit(1);
});
