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
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { askGemini } from "../api/coach-chat/_lib/geminiClient.js";
import type { ChatMessage } from "../api/coach-chat/_lib/chatThreads.js";
import type { TurnMode } from "../api/coach-chat/_lib/coachPrompt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(__dirname, "..");
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
  stateMd: string;
  questLog: string;
  // Optional per-turn extra context block - mirrors askGemini()'s extraContext parameter
  // (coachPrompt.ts's injuryFlagsContext/activeQuestsContext/activeTemplatesContext/
  // activeWeekSessionsContext, concatenated). Needed for any transcript exercising an action
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
  path.join(uiRoot, "api", "coach-chat", "_lib", "coachPrompt.ts"),
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

function checkTranscript(t: Transcript, reply: Awaited<ReturnType<typeof askGemini>>): string[] {
  const failures: string[] = [];

  // reasoning must never leak into what the athlete sees - askGemini() already strips it before
  // returning, this is a belt-and-suspenders check against a regression in that stripping.
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
    try {
      const reply = await askWithRetry(t);
      const failures = checkTranscript(t, reply);
      if (failures.length === 0) {
        console.log("PASS");
        cache[file] = { key, passedAt: new Date().toISOString() };
        writeCache(cache); // after every pass, so an interrupted run keeps what it paid for
      } else {
        failed++;
        console.log("FAIL");
        for (const f of failures) console.log(`  - ${f}`);
        delete cache[file];
        writeCache(cache);
      }
    } catch (err) {
      errored++;
      console.log("ERROR");
      console.log(`  - ${err instanceof Error ? err.message : String(err)}`);
    }
  }

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
