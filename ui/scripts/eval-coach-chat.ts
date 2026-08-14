#!/usr/bin/env -S npx tsx
/**
 * eval-coach-chat.ts — runs the golden transcripts in
 * ui/api/_tests/coach-chat-eval/transcripts/ through the real askGemini() logic against a live
 * Gemini key, and checks the structural rubric: valid schema, no fabricated "saved" language,
 * every file_updates path is coach-writable and matches what the turn mode allows, session_closed
 * only true when the transcript expects it.
 *
 * Deliberately NOT automated here (see docs/eng-docs/llm-provider-current.md's Eval section):
 * persona/voice-match judging - that needs a second model call per transcript, a real added cost
 * per run, so it stays a manual/human read for now. This script only catches the objective
 * regressions - the same class of bug COACH_WRITABLE_FILES already exists to guard against.
 *
 * Usage: npm run eval:coach-chat (from ui/), needs GEMINI_API_KEY in ui/.env.local or env.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { askGemini, isCoachWritable, type ChatMessage, type ClosingFileContext, type TurnMode } from "../api/coach-chat.js";

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
  history: ChatMessage[];
  userMessage: string;
  closingFiles: ClosingFileContext | null;
  expect: {
    sessionClosed?: boolean;
    fileUpdatesEmpty?: boolean;
    // B1 regression coverage (docs/eng-docs/coach-chat-closing-followup.md): the inverse of
    // fileUpdatesEmpty above - asserts file_updates actually landed non-empty, for a transcript
    // whose whole point is "this conversation has real content, a close must not save nothing."
    fileUpdatesNonEmpty?: boolean;
    fileUpdatesPathsSubsetOf?: string[];
    hasCommitMessage?: boolean;
    noFabricatedSaveLanguage?: boolean;
  };
}

const SAVE_CLAIM_PHRASES = ["saved", "logged it", "locked in", "committed", "noted it down", "recorded"];

function checkTranscript(t: Transcript, reply: Awaited<ReturnType<typeof askGemini>>): string[] {
  const failures: string[] = [];
  const fileUpdates = reply.file_updates ?? [];

  // reasoning must never leak into what the athlete sees - askGemini() already strips it before
  // returning, this is a belt-and-suspenders check against a regression in that stripping.
  if ("reasoning" in reply) failures.push("`reasoning` field leaked through into the returned reply");
  // B1's internal-only mismatch flag (docs/eng-docs/coach-chat-closing-followup.md) is meant to
  // be consumed and deleted by the HTTP handler's honesty guard one layer above askGemini - same
  // leak check as `reasoning`, since askGemini itself deliberately does NOT strip this one (it
  // has to survive that one extra layer).
  if ("_unsavedContentSuspected" in reply) {
    failures.push("`_unsavedContentSuspected` field leaked through into the returned reply");
  }

  for (const update of fileUpdates) {
    if (!isCoachWritable(update.path)) {
      failures.push(`file_updates proposed a non-writable path: ${update.path}`);
    }
  }

  if (t.mode !== "closing") {
    for (const update of fileUpdates) {
      if (update.path !== "user_data/coach/state.md") {
        failures.push(`non-closing turn (${t.mode}) proposed an edit outside state.md: ${update.path}`);
      }
    }
  }

  if (t.expect.sessionClosed !== undefined && Boolean(reply.session_closed) !== t.expect.sessionClosed) {
    failures.push(`expected session_closed=${t.expect.sessionClosed}, got ${Boolean(reply.session_closed)}`);
  }

  if (t.expect.fileUpdatesEmpty && fileUpdates.length > 0) {
    failures.push(`expected no file_updates, got ${fileUpdates.length}`);
  }

  if (t.expect.fileUpdatesNonEmpty && fileUpdates.length === 0) {
    failures.push("expected non-empty file_updates, got none");
  }

  if (t.expect.fileUpdatesPathsSubsetOf) {
    const allowed = new Set(t.expect.fileUpdatesPathsSubsetOf);
    for (const update of fileUpdates) {
      if (!allowed.has(update.path)) {
        failures.push(`file_updates path ${update.path} not in expected subset [${t.expect.fileUpdatesPathsSubsetOf.join(", ")}]`);
      }
    }
  }

  if (t.expect.hasCommitMessage && !reply.commit_message?.trim()) {
    failures.push("expected a non-empty commit_message");
  }

  if (t.expect.noFabricatedSaveLanguage) {
    const lowerReply = reply.reply.toLowerCase();
    const hasFabricatedClaim =
      fileUpdates.length === 0 && SAVE_CLAIM_PHRASES.some((phrase) => lowerReply.includes(phrase));
    if (hasFabricatedClaim) {
      failures.push(`reply claims something was saved with empty file_updates: "${reply.reply}"`);
    }
  }

  return failures;
}

async function main() {
  const dir = path.join(__dirname, "..", "api", "_tests", "coach-chat-eval", "transcripts");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  if (files.length === 0) {
    console.error(`eval-coach-chat: no transcripts found in ${dir}`);
    process.exit(1);
  }

  let failed = 0;
  for (const file of files) {
    const t = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as Transcript;
    process.stdout.write(`${t.name} ... `);
    try {
      const reply = await askGemini(
        apiKey,
        "", // soul: coach-chat.ts's HTTP handler injects the real bundled SOUL - not needed to
            // exercise askGemini's own logic, and keeping it out of transcript fixtures avoids
            // duplicating the ~13K-token constant seven times over.
        t.stateMd,
        t.questLog,
        t.history,
        t.userMessage,
        t.mode,
        undefined,
        t.closingFiles ?? undefined,
      );
      const failures = checkTranscript(t, reply);
      if (failures.length === 0) {
        console.log("PASS");
      } else {
        failed++;
        console.log("FAIL");
        for (const f of failures) console.log(`  - ${f}`);
      }
    } catch (err) {
      failed++;
      console.log("ERROR");
      console.log(`  - ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n${files.length - failed}/${files.length} passed.`);
  if (failed > 0) process.exit(1);
}

main();
