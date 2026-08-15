#!/usr/bin/env -S npx tsx
/**
 * eval-coach-chat.ts — runs the golden transcripts in
 * ui/api/_tests/coach-chat-eval/transcripts/ through the real askGemini() logic against a live
 * Gemini key, and checks the structural rubric: valid schema, no fabricated "saved" language,
 * session_closed only true when the transcript expects it, coach_note present when expected.
 *
 * Deliberately NOT automated here (see docs/eng-docs/llm-provider-current.md's Eval section):
 * persona/voice-match judging - that needs a second model call per transcript, a real added cost
 * per run, so it stays a manual/human read for now. This script only catches objective
 * regressions.
 *
 * Usage: npm run eval:coach-chat (from ui/), needs GEMINI_API_KEY in ui/.env.local or env.
 */
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
  history: ChatMessage[];
  userMessage: string;
  expect: {
    sessionClosed?: boolean;
    noFabricatedSaveLanguage?: boolean;
    // coach-chat-reliability-debug: asserts reply.coach_note came back as a real, non-empty
    // (after trimming) plain-English note - the one thing that actually gets saved on a close in
    // the stripped-down design.
    coachNoteReported?: boolean;
  };
}

const SAVE_CLAIM_PHRASES = ["saved", "logged it", "locked in", "committed", "noted it down", "recorded"];

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
