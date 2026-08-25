#!/usr/bin/env -S npx tsx
/**
 * eval-coach-chat.ts — runs the golden transcripts in
 * ui/api/coach-chat/_tests/coach-chat-eval/transcripts/ through the real askGemini() logic against a live
 * Gemini key, and checks the structural rubric: valid schema, no fabricated "saved" language,
 * session_closed only true when the transcript expects it, coach_note present when expected.
 *
 * Deliberately NOT automated here (see docs/eng-docs/llm-provider-current.md's Eval section):
 * persona/voice-match judging - that needs a second model call per transcript, a real added cost
 * per run, so it stays a manual/human read for now. This script only catches objective
 * regressions.
 *
 * **Scope warning:** askGemini() is called with `soul: ""` below. SOUL is NOT in the prompt this
 * script sends, so this eval cannot catch a SOUL content regression of any kind - it exercises
 * askGemini's own logic only. ADR 0024 says a paid check runs where it can actually fail; for a
 * SOUL-only change, that is nowhere in this file.
 *
 * Every call costs money and Gemini 503s non-deterministically, so a red run is usually
 * infrastructure rather than the change under test (ADR 0024). Two things follow from that, both
 * implemented below: transient failures are retried with backoff, and a transcript that has
 * already PASSED is not paid for twice - its result is cached against a key covering the
 * transcript, the model, and the prompt-construction code, so any change to those re-runs it.
 *
 * Usage (from ui/):
 *   npm run eval:coach-chat              # resume - skips transcripts already passing
 *   npm run eval:coach-chat -- --fresh   # ignore the cache, re-run everything
 *   npm run eval:coach-chat -- --only 03 # run transcripts whose file/name matches a substring
 *
 * Needs GEMINI_API_KEY in ui/.env.local or env.
 *
 * Run log: every invocation writes a fresh
 * <repo-root>/eval-coach-chat-log-<ISO-timestamp>.json (colons stripped - not every filesystem
 * accepts them) with one entry per transcript that actually called Gemini this run (a CACHED
 * transcript has no fresh input/output, so it's skipped). Each entry carries exactly what was
 * sent to askGemini(), the raw reply, the PASS/FAIL/ERROR verdict, and a best-effort list of the
 * real repo files that reply's action fields would touch if a live turn ever committed it - this
 * harness never writes those files itself, so the list is derived from turnWrites/README.md, not
 * observed I/O. It exists so a run can be audited afterwards (what did we actually send Gemini,
 * what did it hand back) without re-running the paid call. Gitignored: per-run and per-machine,
 * and may contain real athlete-style transcript content.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { askGemini } from "../api/coach-chat/_lib/geminiClient.js";
import type { ChatMessage } from "../api/coach-chat/_lib/chatThreads.js";
import type { TurnMode } from "../api/coach-chat/_lib/coachReplySchema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(uiRoot, "..");
try {
  process.loadEnvFile(path.join(uiRoot, ".env.local"));
} catch {
  // fine if it doesn't exist - GEMINI_API_KEY may already be in the environment
}

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("eval-coach-chat: GEMINI_API_KEY not set (check ui/.env.local or export it).");
  process.exit(1);
}

interface Transcript {
  name: string;
  description: string;
  mode: TurnMode;
  firstSession?: boolean;
  stateMd: string;
  questLog: string;
  // Optional per-turn extra context block - mirrors askGemini()'s extraContext parameter
  // (first-session, template, and week-session context, concatenated). Needed for any transcript exercising an action
  // field that references a real id (template_edit/session_plan/session_reconcile/plan_edit),
  // since Gemini is instructed to only ever use an id that's actually listed in context.
  extraContext?: string;
  history: ChatMessage[];
  userMessage: string;
  expect: {
    sessionClosed?: boolean;
    noFabricatedSaveLanguage?: boolean;
    // coach-chat-reliability-debug: asserts reply.coach_note came back as a real, non-empty
    // (after trimming) plain-English note.
    coachNoteReported?: boolean;
    // Which structured action field(s) this transcript expects Gemini to set (or, prefixed with
    // "!", explicitly NOT set) on the reply - e.g. "plan_edit" or "!template_edit". This is what
    // actually catches a wrong-action-picked regression (the plan_edit/template_edit and
    // quest_event/injury_event array bugs found live) rather than just the reply-level rubric.
    actionFieldsPresent?: string[];
    actionFieldsAbsent?: string[];
  };
}

const SAVE_CLAIM_PHRASES = ["saved", "logged it", "locked in", "committed", "noted it down", "recorded"];

// Gitignored: results are per-machine and per-key, never shared or committed.
const CACHE_PATH = path.join(uiRoot, ".eval-cache.json");
const MODEL = "gemini-flash-latest"; // mirrors geminiClient.ts's GEMINI_MODEL

// Files whose content changes what gets sent to Gemini. A cached PASS is only valid while all of
// them are unchanged - otherwise the cache would vouch for a prompt that no longer exists.
const PROMPT_SOURCES = [
  path.join(uiRoot, "api", "coach-chat", "_lib", "coachPromptText.ts"),
  path.join(uiRoot, "api", "coach-chat", "_lib", "coachReplySchema.ts"),
  path.join(uiRoot, "api", "coach-chat", "_lib", "geminiClient.ts"),
];

interface CacheEntry {
  key: string;
  passedAt: string;
}

function promptSourceFingerprint(): string {
  const h = crypto.createHash("sha256");
  h.update(MODEL);
  for (const file of PROMPT_SOURCES) h.update(fs.readFileSync(file));
  return h.digest("hex");
}

function transcriptKey(raw: string, fingerprint: string): string {
  return crypto.createHash("sha256").update(fingerprint).update(raw).digest("hex").slice(0, 16);
}

function readCache(): Record<string, CacheEntry> {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) as Record<string, CacheEntry>;
  } catch {
    return {}; // missing or corrupt - a cache is an optimisation, never a dependency
  }
}

function writeCache(cache: Record<string, CacheEntry>): void {
  try {
    fs.writeFileSync(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`);
  } catch (err) {
    console.warn(`  (couldn't write eval cache: ${err instanceof Error ? err.message : String(err)})`);
  }
}

/**
 * Writes the whole run's log in one shot at the end, not incrementally - the entries are small
 * enough (20 transcripts, max) that there's no crash-recovery case worth the complexity the cache
 * file above needs. Timestamp has colons stripped so the name is safe on filesystems that treat
 * them as path separators (or reserve them, on Windows).
 */
function writeRunLog(entries: RunLogEntry[]): void {
  const stamp = new Date().toISOString().replace(/:/g, "-");
  const logPath = path.join(repoRoot, `eval-coach-chat-log-${stamp}.json`);
  try {
    fs.writeFileSync(logPath, `${JSON.stringify(entries, null, 2)}\n`);
    console.log(`\nRun log written to ${path.relative(repoRoot, logPath)}`);
  } catch (err) {
    console.warn(`  (couldn't write run log: ${err instanceof Error ? err.message : String(err)})`);
  }
}

/** 503/504/429 and bare network errors are Gemini being Gemini, not a regression in the diff. */
function isTransient(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  if (status === 503 || status === 504 || status === 429) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /\b(429|503|504)\b|overload|timeout|rate limit|fetch failed|network/i.test(message);
}

const TRANSIENT_ATTEMPTS = 3;

async function askWithRetry(t: Transcript): Promise<Awaited<ReturnType<typeof askGemini>>> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= TRANSIENT_ATTEMPTS; attempt++) {
    try {
      return await askGemini(
        apiKey!,
        "", // see the scope warning at the top of this file - SOUL is deliberately not sent
        t.stateMd,
        t.questLog,
        t.history,
        t.userMessage,
        t.mode,
        t.firstSession ?? false,
        t.extraContext,
      );
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || attempt === TRANSIENT_ATTEMPTS) throw err;
      const waitMs = 2000 * 2 ** (attempt - 1);
      process.stdout.write(`retry ${attempt}/${TRANSIENT_ATTEMPTS - 1} in ${waitMs / 1000}s ... `);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw lastErr;
}

interface RunLogEntry {
  name: string;
  input: {
    mode: TurnMode;
    stateMd: string;
    questLog: string;
    extraContext?: string;
    history: ChatMessage[];
    userMessage: string;
  };
  output: unknown;
  result: "PASS" | "FAIL" | "ERROR";
  failures?: string[];
  filesChanged: string[];
}

/**
 * Derives which real repo files a reply's action fields would touch, per
 * ui/api/coach-chat/_lib/turnWrites/README.md's field-to-file table. This harness never commits
 * anything - askGemini() runs in memory only - so this is a projection for audit reading, not an
 * observation of actual writes. Kept as a pure function so the table can be unit-tested without
 * a live Gemini call; re-check against the README if a new turnWrites file appears.
 */
function filesForReply(reply: unknown): string[] {
  const r = (reply ?? {}) as Record<string, unknown>;
  const isSet = (field: string): boolean => {
    const value = r[field];
    if (value === undefined || value === null) return false;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  };

  const files: string[] = ["chat_history.json"];

  if (isSet("coach_note")) files.push("coach_log.json");
  if (isSet("memory_update") || isSet("sports_update")) files.push("memory.json");
  if (isSet("injury_event")) files.push("injuries.json");
  if (isSet("quest_event") || isSet("quest_create")) files.push("progress.json", "quests.json");
  if (isSet("season_start")) files.push("seasons.json");
  if (isSet("profile_update")) files.push("profile.json");

  for (const field of ["template_edit", "session_plan"]) {
    if (isSet(field)) {
      const action = r[field] as Record<string, unknown> | undefined;
      const templateId = typeof action?.template_id === "string" ? action.template_id : undefined;
      files.push(
        templateId
          ? `workout_plans/templates/${templateId}.json (${field})`
          : `workout_plans/templates/<id>.json (${field}, id not derivable)`,
      );
    }
  }

  if (isSet("week_plan") || isSet("session_reconcile") || isSet("plan_edit")) {
    files.push("current_week.json");
  }

  return files;
}

function checkTranscript(t: Transcript, reply: Awaited<ReturnType<typeof askGemini>>): string[] {
  const failures: string[] = [];

  // The retired reasoning field must never return if an older model/cache shape resurfaces.
  if ("reasoning" in reply) failures.push("`reasoning` field leaked through into the returned reply");

  if (t.expect.sessionClosed !== undefined && Boolean(reply.session_closed) !== t.expect.sessionClosed) {
    failures.push(`expected session_closed=${t.expect.sessionClosed}, got ${Boolean(reply.session_closed)}`);
  }

  if (t.expect.coachNoteReported && !reply.coach_note?.trim()) {
    failures.push("expected a non-empty coach_note, got none");
  }

  if (t.expect.noFabricatedSaveLanguage) {
    const lowerReply = reply.reply.toLowerCase();
    const hasFabricatedClaim =
      !reply.coach_note?.trim() && SAVE_CLAIM_PHRASES.some((phrase) => lowerReply.includes(phrase));
    if (hasFabricatedClaim) {
      failures.push(`reply claims something was saved with an empty coach_note: "${reply.reply}"`);
    }
  }

  // Which structured action field(s) actually fired - this is what catches a wrong-action
  // regression (e.g. plan_edit vs template_edit, or a dropped array entry) that the reply-level
  // rubric above can't see at all.
  const replyRecord = reply as unknown as Record<string, unknown>;
  const isSet = (field: string) => {
    const value = replyRecord[field];
    if (value === undefined || value === null) return false;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  };

  for (const field of t.expect.actionFieldsPresent ?? []) {
    if (!isSet(field)) failures.push(`expected action field "${field}" to be set, but it was absent/empty`);
  }
  for (const field of t.expect.actionFieldsAbsent ?? []) {
    if (isSet(field)) failures.push(`expected action field "${field}" to be absent, but it was set: ${JSON.stringify(replyRecord[field])}`);
  }

  return failures;
}

async function main() {
  const args = process.argv.slice(2);
  const fresh = args.includes("--fresh");
  const onlyIdx = args.indexOf("--only");
  const only = onlyIdx !== -1 ? args[onlyIdx + 1] : undefined;

  const dir = path.join(__dirname, "..", "api", "coach-chat", "_tests", "coach-chat-eval", "transcripts");
  let files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  if (files.length === 0) {
    console.error(`eval-coach-chat: no transcripts found in ${dir}`);
    process.exit(1);
  }
  if (only) {
    files = files.filter((f) => f.includes(only));
    if (files.length === 0) {
      console.error(`eval-coach-chat: --only "${only}" matched no transcript files.`);
      process.exit(1);
    }
  }

  const fingerprint = promptSourceFingerprint();
  const cache = fresh ? {} : readCache();

  let failed = 0; // real assertion failures - the change under test is wrong
  let errored = 0; // infrastructure - Gemini gave up, says nothing about the change
  let cached = 0;
  let ran = 0;

  // Only transcripts that actually called Gemini this run get an entry - a CACHED transcript has
  // no fresh input/output to log, its record is just yesterday's cache hit.
  const runLog: RunLogEntry[] = [];

  for (const file of files) {
    const raw = fs.readFileSync(path.join(dir, file), "utf8");
    const t = JSON.parse(raw) as Transcript;
    const key = transcriptKey(raw, fingerprint);

    if (cache[file]?.key === key) {
      console.log(`${t.name} ... CACHED (passed ${cache[file].passedAt.slice(0, 10)})`);
      cached++;
      continue;
    }

    process.stdout.write(`${t.name} ... `);
    ran++;
    const input = {
      mode: t.mode,
      stateMd: t.stateMd,
      questLog: t.questLog,
      extraContext: t.extraContext,
      history: t.history,
      userMessage: t.userMessage,
    };
    try {
      const reply = await askWithRetry(t);
      const failures = checkTranscript(t, reply);
      if (failures.length === 0) {
        console.log("PASS");
        cache[file] = { key, passedAt: new Date().toISOString() };
        writeCache(cache); // after every pass, so an interrupted run keeps what it paid for
        runLog.push({ name: t.name, input, output: reply, result: "PASS", filesChanged: filesForReply(reply) });
      } else {
        failed++;
        console.log("FAIL");
        for (const f of failures) console.log(`  - ${f}`);
        delete cache[file];
        writeCache(cache);
        runLog.push({ name: t.name, input, output: reply, result: "FAIL", failures, filesChanged: filesForReply(reply) });
      }
    } catch (err) {
      errored++;
      console.log("ERROR");
      console.log(`  - ${err instanceof Error ? err.message : String(err)}`);
      runLog.push({
        name: t.name,
        input,
        output: null,
        result: "ERROR",
        failures: [err instanceof Error ? err.message : String(err)],
        filesChanged: [],
      });
    }
  }

  writeRunLog(runLog);

  const passed = files.length - failed - errored;
  console.log(`\n${passed}/${files.length} passed (${cached} cached, ${ran} called Gemini).`);

  // An assertion failure and an infrastructure failure mean opposite things, so don't report them
  // as one number. Only a real FAIL says the change under test is wrong.
  if (errored > 0) {
    console.log(`${errored} transcript(s) errored out - infrastructure, not the change under test.`);
    console.log("Re-run to retry only those - the passes above are cached and won't be paid for again.");
  }
  if (failed > 0) console.log(`${failed} transcript(s) genuinely failed the rubric.`);

  if (failed > 0) process.exit(1);
  if (errored > 0) process.exit(2); // incomplete, not failed
}

main();
