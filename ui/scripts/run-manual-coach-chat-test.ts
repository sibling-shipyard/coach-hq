#!/usr/bin/env -S npx tsx
/**
 * run-manual-coach-chat-test.ts — drives a real conversation through the hosted coach-chat
 * handler (`handle()` in ui/api/coach-chat.ts) against a real local clone of an athlete repo,
 * on a real scratch branch. Unlike eval-coach-chat.ts, nothing here is fixture data: this calls
 * a live Gemini key and writes real commits through the real GitHub API.
 *
 * This is a manual, on-demand tool. It is NEVER run in CI, and I never run it as part of a
 * routine check - it costs real Gemini calls and writes real commits to a real athlete repo.
 *
 * **Safety:** this script refuses to run if `--branch` is the repo's actual default branch (checked
 * live via the GitHub API) or if it's literally "main". There is no override for this - it's a
 * hard requirement, not a suggestion, because a mistake here writes to an athlete's real history.
 *
 * Usage (from ui/):
 *   npm run test:coach-chat-manual -- --athlete skanda --branch test/manual-run-1 --greet
 *   npm run test:coach-chat-manual -- --athlete akash --branch test/manual-run-2 --message "..."
 *   npm run test:coach-chat-manual -- --repo owner/name --local-path /path --branch test/x --turns turns.json
 *
 * Needs GEMINI_API_KEY in ui/.env.local or env, and a GitHub CLI session (`gh auth token`).
 *
 * Run log: writes <repo-root>/tests/<YYYY-MM-DD>/manual/manual-coach-chat-log-<HH-MM-SS>.json,
 * same shape as eval-coach-chat.ts's log but with `confidence: "observed"` filesChanged - a real
 * git diff of the local clone across each turn's before/after commit sha, not a guess.
 */
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fetchWithTimeout } from "../api/_lib/httpTimeout.js";
import { getHeadSha } from "../api/coach-chat/_lib/coachChatFiles.js";
import { handle } from "../api/coach-chat.js";
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
if (!apiKey) {
  console.error("run-manual-coach-chat-test: GEMINI_API_KEY not set (check ui/.env.local or export it).");
  process.exit(1);
}

const ATHLETE_REPOS: Record<string, { repo: string; localPath: string }> = {
  skanda: { repo: "skanda-2003/coach-skanda-2003", localPath: "/home/skanda_suresh/Projects/coach-skanda" },
  akash: { repo: "akash-suresh/coach-akash-suresh", localPath: "/home/skanda_suresh/Projects/coach-akash" },
};

interface ManualTurn {
  message: string;
  endConversationRequested?: boolean;
  // Only sessionClosed - the real HTTP response (ordinaryTurnResponse()/commitClosingTurn() in
  // coachTurn.ts) never echoes raw action fields (quest_event, injury_event, etc.) back to the
  // caller, only { reply, closed, repoSha/threadId/threads, profileComplete, traceId }. There is
  // no honest way to check "did quest_event fire" from this response - filesChanged's real diff
  // is the actual evidence for what a turn wrote, which is exactly the point of this being a
  // manual/observed test rather than eval's derived one.
  expect?: { sessionClosed?: boolean };
}

interface ManualLogEntry extends TestLogEntry {
  kind: "manual";
  turnIndex: number;
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
    greet: argv.includes("--greet"),
    message: get("--message"),
    turnsPath: get("--turns"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let repo: string;
  let localPath: string;
  if (args.athlete) {
    const known = ATHLETE_REPOS[args.athlete];
    if (!known) {
      console.error(`run-manual-coach-chat-test: unknown --athlete "${args.athlete}" (known: ${Object.keys(ATHLETE_REPOS).join(", ")}).`);
      process.exit(1);
      return;
    }
    repo = known.repo;
    localPath = args.localPath ?? known.localPath;
  } else if (args.repo) {
    if (!args.localPath) {
      console.error("run-manual-coach-chat-test: --local-path is required when using --repo without --athlete.");
      process.exit(1);
      return;
    }
    repo = args.repo;
    localPath = args.localPath;
  } else {
    console.error("run-manual-coach-chat-test: pass --athlete <skanda|akash> or --repo <owner/name> --local-path <dir>.");
    process.exit(1);
    return;
  }

  const branch = args.branch;
  if (!branch) {
    console.error("run-manual-coach-chat-test: --branch is required.");
    process.exit(1);
    return;
  }

  const modeFlags = [args.greet, args.message != null, args.turnsPath != null].filter(Boolean).length;
  if (modeFlags !== 1) {
    console.error("run-manual-coach-chat-test: pass exactly one of --greet, --message, --turns.");
    process.exit(1);
    return;
  }

  const token = execSync("gh auth token", { encoding: "utf8" }).trim();

  // Safety: never let this script write to a real athlete's default branch.
  const repoInfoRes = await fetchWithTimeout(`https://api.github.com/repos/${repo}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!repoInfoRes.ok) {
    console.error(`run-manual-coach-chat-test: couldn't look up ${repo} (${repoInfoRes.status}).`);
    process.exit(1);
    return;
  }
  const repoInfo = (await repoInfoRes.json()) as { default_branch: string };
  if (branch === "main" || branch === repoInfo.default_branch) {
    console.error(
      `run-manual-coach-chat-test: refusing to run against "${branch}" - that's ${repo}'s default branch (or literally "main"). Use a scratch branch.`,
    );
    process.exit(1);
    return;
  }

  process.env.COACH_CHAT_BRANCH = branch;
  const auth: RepoAuthContext = { gh_token: token, repo_full_name: repo };

  let turns: ManualTurn[];
  if (args.greet) {
    turns = [{ message: "" }];
  } else if (args.message != null) {
    turns = [{ message: args.message }];
  } else {
    turns = JSON.parse(fs.readFileSync(args.turnsPath!, "utf8")) as ManualTurn[];
  }

  const entries: ManualLogEntry[] = [];
  // The ordinary/closing turn responses don't echo threadId or the message list back (only
  // greet and a closing turn's response include threads) - so unlike the eval harness this
  // script has to carry a stable threadId and build the running ChatMessage[] itself, exactly
  // as coachTurn.ts's appendConversationTurn would, or every ordinary turn lands in its own
  // fresh thread (buildChatWrite falls back to `t-${now}` whenever threadId is omitted).
  const threadId = args.greet ? undefined : `t-${Date.now()}`;
  let messages: { id: string; role: "divider" | "user" | "coach"; [key: string]: unknown }[] = [];

  for (let turnIndex = 0; turnIndex < turns.length; turnIndex++) {
    const turn = turns[turnIndex];
    const shaBefore = await getHeadSha(repo, token).catch(() => null);

    const body = args.greet
      ? { action: "greet" as const }
      : {
          threadId,
          messages,
          message: turn.message,
          endConversationRequested: turn.endConversationRequested ?? false,
        };

    const res = await handle(
      new Request("http://localhost/api/coach-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      auth,
    );
    const json = (await res.json()) as Record<string, unknown>;

    if (!args.greet) {
      const now = Date.now();
      const userMessage = { id: `u-${now}`, role: "user" as const, text: turn.message };
      const coachMessage = { id: `c-${now}`, role: "coach" as const, paragraphs: [String(json.reply ?? "")] };
      const turnMessages = [userMessage, coachMessage];
      messages =
        messages.length > 0
          ? [...messages, ...turnMessages]
          : [{ id: `d-${now}`, role: "divider" as const, label: "Today" }, ...turnMessages];
    }

    let result: "PASS" | "FAIL" | "ERROR";
    const failures: string[] = [];
    if (turn.expect?.sessionClosed !== undefined) {
      if (Boolean(json.closed) !== turn.expect.sessionClosed) {
        failures.push(`expected session_closed=${turn.expect.sessionClosed}, got ${Boolean(json.closed)}`);
      }
      result = failures.length === 0 ? "PASS" : "FAIL";
    } else {
      result = res.ok ? "PASS" : "ERROR";
    }

    const shaAfter = await getHeadSha(repo, token).catch(() => null);

    let filesChanged: ManualLogEntry["filesChanged"];
    if (shaBefore != null && shaAfter != null && shaBefore !== shaAfter) {
      execFileSync("git", ["-C", localPath, "fetch", "origin", branch], { stdio: "pipe" });
      const filesRaw = execFileSync("git", ["-C", localPath, "diff", "--name-only", `${shaBefore}..${shaAfter}`], { encoding: "utf8" });
      const diff = execFileSync("git", ["-C", localPath, "diff", `${shaBefore}..${shaAfter}`], { encoding: "utf8" });
      filesChanged = {
        confidence: "observed",
        files: filesRaw.split("\n").filter((f) => f.trim().length > 0),
        diff,
      };
    } else {
      filesChanged = { confidence: "observed", files: [], diff: "" };
    }

    console.log(`turn ${turnIndex} ... ${result}`);
    for (const f of failures) console.log(`  - ${f}`);

    entries.push({
      kind: "manual",
      name: `turn-${turnIndex}`,
      turnIndex,
      repo,
      branch,
      input: body,
      output: json,
      result,
      failures: failures.length > 0 ? failures : undefined,
      filesChanged,
      shaBefore,
      shaAfter,
    });
  }

  writeTestLog("manual", "manual-coach-chat", entries);

  const passed = entries.filter((e) => e.result === "PASS").length;
  console.log(`\n${passed}/${entries.length} passed.`);
  if (entries.some((e) => e.result === "FAIL")) process.exit(1);
  if (entries.some((e) => e.result === "ERROR")) process.exit(2);
}

main();
