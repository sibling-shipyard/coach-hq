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
    fileUpdatesPathsSubsetOf?: string[];
    hasCommitMessage?: boolean;
    noFabricatedSaveLanguage?: boolean;
    // P1 (coach-intent-schema.md) additions - the model now reports coach_note/session_note/
    // quest_events/sleep as plain facts instead of file_updates for those four fields, so the
    // rubric needs its own checks for them rather than reusing the file_updates-shaped ones above.
    /**
     * Every quest_id listed here must appear in reply.quest_events. Independent of this list,
     * EVERY quest_id the model returns (whether listed here or not) is checked against the ids
     * actually rendered in the transcript's own questLog (the `` `id` `` tokens next to each
     * quest) - a quest_id that isn't one of those is a fabricated id, not just a missed
     * expectation, and fails the transcript even if this array is empty.
     */
    questEventsInclude?: string[];
    /** reply.sleep must be present with a real date (YYYY-MM-DD) and a positive hours value. */
    sleepReported?: boolean;
    /**
     * No file_updates entry may target coach_notes.md, challenge_v2.json, or sleep_log.json -
     * P1 moved all three off the edit/merge_patch path entirely, so a proposal for any of them
     * (in any field: edits, merge_patch, or content) means Gemini is still trying to write them
     * the old way. Checked unconditionally below regardless of this flag - it's here so a
     * transcript can label the check explicitly in its own expectations for readability, not to
     * gate whether the check runs at all.
     */
    noMergePatchesForRemovedFiles?: boolean;
  };
}

const SAVE_CLAIM_PHRASES = ["saved", "logged it", "locked in", "committed", "noted it down", "recorded"];

// P1: coach_notes.md/challenge_v2.json/sleep_log.json dropped out of MARKDOWN_EDIT_FILES/
// JSON_MERGE_FILES in coach-chat.ts - isCoachWritable() already rejects file_updates for these
// (caught below by the existing "non-writable path" check), but this list gives that specific
// regression its own named, greppable failure message instead of folding into the generic one.
const REMOVED_FROM_FILE_UPDATES = new Set([
  "user_data/coach/coach_notes.md",
  "user_data/ledger/challenge_v2.json",
  "user_data/coach/sleep_log.json",
]);

// Pulls every `` `quest_id` `` token out of a transcript's questLog fixture text - mirrors how
// gen/quest_log.md actually renders ids (backtick-wrapped, next to each quest's name/heading,
// see engine/scripts/generate_quest_log.py). Used to catch a fabricated quest_id: one that isn't
// anywhere in the quest log the model was actually shown this turn.
function realQuestIds(questLog: string): Set<string> {
  const ids = new Set<string>();
  for (const m of questLog.matchAll(/`([a-zA-Z0-9_-]+)`/g)) ids.add(m[1]);
  return ids;
}

function checkTranscript(t: Transcript, reply: Awaited<ReturnType<typeof askGemini>>): string[] {
  const failures: string[] = [];
  const fileUpdates = reply.file_updates ?? [];

  // reasoning must never leak into what the athlete sees - askGemini() already strips it before
  // returning, this is a belt-and-suspenders check against a regression in that stripping.
  if ("reasoning" in reply) failures.push("`reasoning` field leaked through into the returned reply");

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

  // Unconditional, not gated by expect.noMergePatchesForRemovedFiles - a proposal for any of
  // these three paths is always wrong post-P1, on every transcript, not just ones that opted in.
  for (const update of fileUpdates) {
    if (REMOVED_FROM_FILE_UPDATES.has(update.path)) {
      failures.push(`file_updates proposed for ${update.path} - P1 moved this off edits/merge_patch onto plain facts`);
    }
  }

  if (t.expect.questEventsInclude) {
    const returnedIds = new Set((reply.quest_events ?? []).map((e) => e.quest_id));
    for (const expectedId of t.expect.questEventsInclude) {
      if (!returnedIds.has(expectedId)) {
        failures.push(`expected quest_events to include quest_id "${expectedId}", got [${[...returnedIds].join(", ")}]`);
      }
    }
  }

  // Runs whenever quest_events came back at all, regardless of expect.questEventsInclude - a
  // fabricated id is a failure on any transcript, not just ones asserting a specific completion.
  if (reply.quest_events && reply.quest_events.length > 0) {
    const validIds = realQuestIds(t.questLog);
    for (const event of reply.quest_events) {
      if (!event.quest_id || !validIds.has(event.quest_id)) {
        failures.push(`quest_events entry has quest_id "${event.quest_id}" not found in this turn's questLog - likely fabricated`);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(event.date)) {
        failures.push(`quest_events entry for "${event.quest_id}" has a non-YYYY-MM-DD date: "${event.date}"`);
      }
    }
  }

  if (t.expect.sleepReported) {
    if (!reply.sleep) {
      failures.push("expected sleep to be reported, got none");
    } else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(reply.sleep.date)) {
        failures.push(`sleep.date is not YYYY-MM-DD: "${reply.sleep.date}"`);
      }
      if (typeof reply.sleep.hours !== "number" || !(reply.sleep.hours > 0)) {
        failures.push(`sleep.hours is not a real positive number: ${reply.sleep.hours}`);
      }
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
