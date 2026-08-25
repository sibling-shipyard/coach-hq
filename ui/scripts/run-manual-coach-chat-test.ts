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
 * **Branch:** `--branch` is optional - omit it and the script names and creates one itself
 * (`test/manual-<timestamp>`, cut from the repo's real default branch HEAD), so there's no
 * manual "cut a branch first" step. Pass `--branch <name>` to reuse a specific one instead (it's
 * created the same way if it doesn't exist yet).
 *
 * **Safety:** this script refuses to run if `--branch` (given or generated) is the repo's actual
 * default branch (checked live via the GitHub API) or if it's literally "main". There is no
 * override for this - it's a hard requirement, not a suggestion, because a mistake here writes
 * to an athlete's real history.
 *
 * Usage (from ui/):
 *   npm run test:coach-chat-manual -- --athlete skanda --greet
 *   npm run test:coach-chat-manual -- --athlete akash --message "..."
 *   npm run test:coach-chat-manual -- --repo owner/name --local-path /path --turns turns.json
 *   npm run test:coach-chat-manual -- --athlete skanda --branch test/reuse-me --message "..."
 *
 * turns.json is an array of { message, endConversationRequested?, expect? }. Set `greet: true`
 * on turns[0] to open the run with a real greet turn first - its real threadId carries into
 * every turn after it, so the whole run stays one conversation instead of the greet and the
 * follow-ups silently landing in two different threads.
 *
 * See scripts/examples/ for three realistic multi-turn examples - `expect` is optional on every
 * turn (manual runs don't need one, it's fine to just read the reply), used here only on the
 * closing turn to confirm the session actually closed:
 *   - manual-coach-chat-turns.example.json - vague "felt a bit off" -> hip pain clarified 2 turns
 *     later -> close. Same incremental-disclosure idea eval-coach-chat.ts's turns[] transcripts
 *     test, just against a real athlete repo instead of fixture data.
 *   - manual-coach-chat-turns-plan-adjustment.example.json - vague "busy week" -> a specific
 *     day-swap request -> close.
 *   - manual-coach-chat-turns-quest-and-injury.example.json - a completed run (quest progress) up
 *     front, then a calf niggle that escalates from "a bit tight" to a real, specific complaint
 *     over two more turns before closing - shows one longer real session touching more than one
 *     action field.
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
  // Only meaningful on turns[0]: run a real greet turn first and adopt its real threadId for
  // every turn that follows, instead of minting a synthetic one - see the threadId handling
  // below for why this matters.
  greet?: true;
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

  const modeFlags = [args.greet, args.message != null, args.turnsPath != null].filter(Boolean).length;
  if (modeFlags !== 1) {
    console.error("run-manual-coach-chat-test: pass exactly one of --greet, --message, --turns.");
    process.exit(1);
    return;
  }

  const token = execSync("gh auth token", { encoding: "utf8" }).trim();
  const ghHeaders = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };

  // --branch is optional - default to an auto-named, auto-created scratch branch so running a
  // test never requires a manual "cut a branch first" step. Still never runs against the real
  // default branch (or literally "main"), whether the name came from --branch or was generated.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const branch = args.branch ?? `test/manual-${stamp}`;

  const repoInfoRes = await fetchWithTimeout(`https://api.github.com/repos/${repo}`, { headers: ghHeaders });
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

  // Create the scratch branch off the real default branch's current HEAD if it doesn't exist yet
  // - commitFilesAtomic() only ever moves an existing ref, it can't create one, so without this
  // every run would need a branch cut and pushed by hand first.
  const branchRefRes = await fetchWithTimeout(`https://api.github.com/repos/${repo}/git/ref/heads/${branch}`, { headers: ghHeaders });
  if (branchRefRes.status === 404) {
    const defaultHeadSha = await getHeadSha(repo, token, repoInfo.default_branch);
    const createRes = await fetchWithTimeout(`https://api.github.com/repos/${repo}/git/refs`, {
      method: "POST",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: defaultHeadSha }),
    });
    if (!createRes.ok) {
      console.error(`run-manual-coach-chat-test: couldn't create branch "${branch}" (${createRes.status}).`);
      process.exit(1);
      return;
    }
    console.log(`Created scratch branch "${branch}" off ${repoInfo.default_branch} (${defaultHeadSha.slice(0, 7)}).`);
  } else if (!branchRefRes.ok) {
    console.error(`run-manual-coach-chat-test: couldn't check whether "${branch}" exists (${branchRefRes.status}).`);
    process.exit(1);
    return;
  }

  console.log(`Running against ${repo}@${branch}`);
  process.env.COACH_CHAT_BRANCH = branch;
  const auth: RepoAuthContext = { gh_token: token, repo_full_name: repo };

  let turns: ManualTurn[];
  if (args.greet) {
    turns = [{ message: "", greet: true }];
  } else if (args.message != null) {
    turns = [{ message: args.message }];
  } else {
    turns = JSON.parse(fs.readFileSync(args.turnsPath!, "utf8")) as ManualTurn[];
  }
  if (turns.length === 0) {
    console.error(`run-manual-coach-chat-test: ${args.turnsPath} is an empty array - nothing to run.`);
    process.exit(1);
    return;
  }
  for (let i = 1; i < turns.length; i++) {
    if (turns[i].greet) {
      console.error(`run-manual-coach-chat-test: "greet" is only valid on turns[0] (found on turns[${i}]).`);
      process.exit(1);
      return;
    }
  }

  const entries: ManualLogEntry[] = [];
  // The ordinary/closing turn responses don't echo threadId or the message list back (only
  // greet and a closing turn's response include threads) - so unlike the eval harness this
  // script has to carry a stable threadId and build the running ChatMessage[] itself, exactly
  // as coachTurn.ts's appendConversationTurn would, or every ordinary turn lands in its own
  // fresh thread (buildChatWrite falls back to `t-${now}` whenever threadId is omitted).
  //
  // If the run opens with a real greet turn, its response DOES carry a real threadId
  // (coach-chat.ts's handleGreet returns `threadId: t-${now}`) - adopt that instead of minting
  // a synthetic one, so a scripted "greet, then respond" conversation stays one real thread
  // instead of silently splitting into two. Only lazily mint a synthetic id if the run never
  // greets at all (a bare --message/--turns run with no turns[0].greet).
  let threadId: string | undefined = turns[0]?.greet ? undefined : `t-${Date.now()}`;
  let messages: { id: string; role: "divider" | "user" | "coach"; [key: string]: unknown }[] = [];

  for (let turnIndex = 0; turnIndex < turns.length; turnIndex++) {
    const turn = turns[turnIndex];
    // Declared outside the try so a thrown turn can still log the real HTTP payload if one was
    // built before the throw, instead of falling back to the raw ManualTurn spec (a different
    // shape for the same `input` field would undermine comparing entries in the log).
    let body: unknown;
    // Everything below can throw (a bad response, a network blip, a git command failing) - one
    // turn throwing must not cost every earlier turn its log entry, so the whole body is wrapped
    // and a thrown turn still gets recorded before the run stops.
    try {
      // getHeadSha failing (not "returned no sha", but the call itself throwing) means we can't
      // tell what the branch looked like at this point - track that explicitly rather than
      // silently treating it the same as "checked, and it's null."
      let shaBeforeFailed = false;
      const shaBefore = await getHeadSha(repo, token).catch(() => {
        shaBeforeFailed = true;
        return null;
      });

      body = turn.greet
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

      // Adopt the server's real threadId whenever a response actually returns one (greet always
      // does; a closing turn does too) - keeps a scripted "greet, then respond" run in one real
      // thread instead of the greet's thread and the follow-ups' synthetic one silently diverging.
      if (typeof json.threadId === "string") threadId = json.threadId;

      if (!turn.greet) {
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
      const hasAssertion = turn.expect?.sessionClosed !== undefined;
      if (hasAssertion) {
        if (Boolean(json.closed) !== turn.expect!.sessionClosed) {
          failures.push(`expected session_closed=${turn.expect!.sessionClosed}, got ${Boolean(json.closed)}`);
        }
        result = failures.length === 0 ? "PASS" : "FAIL";
      } else {
        result = res.ok ? "PASS" : "ERROR";
      }

      let shaAfterFailed = false;
      const shaAfter = await getHeadSha(repo, token).catch(() => {
        shaAfterFailed = true;
        return null;
      });

      let filesChanged: ManualLogEntry["filesChanged"];
      if (shaBeforeFailed || shaAfterFailed) {
        // Can't tell what changed - saying "observed: no files" here would be a lie, since a
        // real commit may well have landed. Record that honestly in filesChanged either way, but
        // don't clobber a real assertion's own verdict: if turn.expect actually checked
        // session_closed against the response and it passed/failed, that's true regardless of
        // whether we could also observe the commit - losing that signal is worse than keeping it
        // alongside a visible "files unconfirmed" note. Only escalate to ERROR when there was no
        // real assertion at all (a bare res.ok "PASS" is weak on its own, and losing the audit
        // trail on top of it leaves nothing worth trusting in this entry).
        failures.push("sha lookup failed before or after this turn - cannot confirm what changed, if anything");
        if (!hasAssertion) result = "ERROR";
        filesChanged = { confidence: "observed", files: [], diff: "" };
      } else if (shaBefore != null && shaAfter != null && shaBefore !== shaAfter) {
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`turn ${turnIndex} ... ERROR`);
      console.log(`  - ${message}`);
      entries.push({
        kind: "manual",
        name: `turn-${turnIndex}`,
        turnIndex,
        repo,
        branch,
        // body may still be undefined if the throw happened before it was built (e.g. the
        // getHeadSha call above) - fall back to the raw turn spec only in that case, so a later
        // throw (post-request) logs the same shape a successful entry would.
        input: body ?? turn,
        output: null,
        result: "ERROR",
        failures: [message],
        filesChanged: { confidence: "observed", files: [], diff: "" },
        shaBefore: null,
        shaAfter: null,
      });
      // State (threadId/messages) may be inconsistent with reality after an unknown failure -
      // stop rather than risk compounding it into later turns, but still log what ran so far.
      break;
    }
  }

  const logWritten = writeTestLog("manual", "manual-coach-chat", entries);

  const passed = entries.filter((e) => e.result === "PASS").length;
  console.log(`\n${passed}/${entries.length} passed.`);
  // A PASS can still carry a failures entry (a real assertion passed, but the sha lookup around
  // it failed, so filesChanged is unconfirmed) - that PASS is honest, but it's not a clean run,
  // and neither exit branch below would otherwise catch it.
  const hasUnconfirmedAudit = entries.some((e) => e.result === "PASS" && (e.failures?.length ?? 0) > 0);
  if (hasUnconfirmedAudit) console.log("At least one passing turn has an unconfirmed audit trail - see its failures[].");
  if (!logWritten) console.log("Run log failed to write - see the warning above.");

  if (entries.some((e) => e.result === "FAIL")) process.exit(1);
  if (entries.some((e) => e.result === "ERROR") || hasUnconfirmedAudit || !logWritten) process.exit(2);
}

main();
