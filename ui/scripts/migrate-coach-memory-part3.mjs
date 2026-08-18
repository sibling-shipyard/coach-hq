#!/usr/bin/env node
/**
 * One-time migration: applies coach-redesign-part3-rollout.md's field drops/additions to an
 * athlete repo's user_data/coach/chat_history.json and user_data/ledger/current_week.json.
 * Unlike Part 1/2, this doesn't replace one file shape with a different one - it trims a few
 * dead fields and stamps a couple new ones onto files that already exist in roughly their
 * current shape. Run once, on a scratch branch, never against main directly - see AGENTS.md's
 * git-push rule and Part 1/2's migration scripts, which this follows.
 *
 * Usage:
 *   node ui/scripts/migrate-coach-memory-part3.mjs <path-to-athlete-repo-checkout>
 *
 * chat_history.json:
 *   - adds a root `_meta: { updated_at, updated_by, trace_id }` (sibling of `threads`)
 *   - drops `ageLabel`/`status`/`dayOffset` from every thread (dead on disk - see chatThreads.ts)
 *
 * current_week.json:
 *   - drops `coach_read.tone`/`confidence`/`evidence_refs`
 *   - drops `week.phase_name`/`week.block_name`
 *   - adds a root `trace_id` (sibling of `updated_at`/`updated_by`)
 *   - `coach_comments[]` is untouched - it's a separate system and keeps tone/confidence/evidence_refs
 *
 * Idempotent: safe to run twice. A file already in the new shape is written back unchanged (no
 * _meta/trace_id re-stamped, no diff) rather than treated as an error.
 *
 * Review and commit the result yourself - this script does not touch git.
 */
import fs from "node:fs";
import path from "node:path";

const repoPath = process.argv[2];
if (!repoPath) {
  console.error("Usage: node migrate-coach-memory-part3.mjs <path-to-athlete-repo-checkout>");
  process.exit(1);
}

const coachDir = path.join(repoPath, "user_data", "coach");
const ledgerDir = path.join(repoPath, "user_data", "ledger");
const chatHistoryPath = path.join(coachDir, "chat_history.json");
const currentWeekPath = path.join(ledgerDir, "current_week.json");

const MIGRATION_TRACE_ID = "migration_part3";

function readJsonIfExists(p) {
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, "utf8");
  if (!raw.trim()) return null;
  return JSON.parse(raw);
}

// --- chat_history.json ---------------------------------------------------------------------

const chatHistory = readJsonIfExists(chatHistoryPath);
let chatHistoryChanged = false;

if (chatHistory) {
  const threads = Array.isArray(chatHistory.threads) ? chatHistory.threads : [];
  const trimmedThreads = threads.map((t) => {
    const { ageLabel, status, dayOffset, ...rest } = t;
    if (ageLabel !== undefined || status !== undefined || dayOffset !== undefined) {
      chatHistoryChanged = true;
    }
    return rest;
  });

  const alreadyHasMeta =
    chatHistory._meta
    && typeof chatHistory._meta.updated_at === "string"
    && typeof chatHistory._meta.updated_by === "string"
    && typeof chatHistory._meta.trace_id === "string";
  if (!alreadyHasMeta) chatHistoryChanged = true;

  const meta = alreadyHasMeta
    ? chatHistory._meta
    : { updated_at: new Date().toISOString(), updated_by: "coach", trace_id: MIGRATION_TRACE_ID };

  if (chatHistoryChanged) {
    fs.writeFileSync(chatHistoryPath, JSON.stringify({ _meta: meta, threads: trimmedThreads }, null, 2) + "\n");
  }
} else {
  console.log(`No chat_history.json found at ${coachDir} - skipping.`);
}

// --- current_week.json -----------------------------------------------------------------------

const currentWeek = readJsonIfExists(currentWeekPath);
let currentWeekChanged = false;

if (currentWeek) {
  if (currentWeek.week && typeof currentWeek.week === "object") {
    const { phase_name, block_name, ...restWeek } = currentWeek.week;
    if (phase_name !== undefined || block_name !== undefined) currentWeekChanged = true;
    currentWeek.week = restWeek;
  }

  if (currentWeek.coach_read && typeof currentWeek.coach_read === "object") {
    const { tone, confidence, evidence_refs, ...restRead } = currentWeek.coach_read;
    if (tone !== undefined || confidence !== undefined || evidence_refs !== undefined) {
      currentWeekChanged = true;
    }
    currentWeek.coach_read = restRead;
  }

  if (typeof currentWeek.trace_id !== "string") {
    currentWeek.trace_id = MIGRATION_TRACE_ID;
    currentWeekChanged = true;
  }

  if (currentWeekChanged) {
    fs.writeFileSync(currentWeekPath, JSON.stringify(currentWeek, null, 2) + "\n");
  }
} else {
  console.log(`No current_week.json found at ${ledgerDir} - skipping.`);
}

console.log(
  `chat_history.json: ${chatHistory ? (chatHistoryChanged ? "migrated" : "already up to date, no-op") : "not found"}`,
);
console.log(
  `current_week.json: ${currentWeek ? (currentWeekChanged ? "migrated" : "already up to date, no-op") : "not found"}`,
);
console.log("Review the diffs, then commit on your scratch branch yourself - this script does not touch git.");
