#!/usr/bin/env node
/**
 * One-time migration: reads an athlete repo's CURRENT state.md + coach_notes.md +
 * rolling_state.json and writes profile.json/memory.json/injuries.json/coach_log.json in the
 * shapes coach-redesign-part1-memory.md defines, then deletes the three old files. Run once, on a
 * scratch branch, never against main directly - see AGENTS.md's git-push rule and the Part 1
 * rollout plan.
 *
 * Usage:
 *   node ui/scripts/migrate-coach-memory-part1.mjs <path-to-athlete-repo-checkout>
 *
 * Writes the four new files into <repo>/user_data/coach/ and deletes state.md, coach_notes.md,
 * rolling_state.json - review and commit the result yourself, this script does not touch git.
 */
import fs from "node:fs";
import path from "node:path";

const repoPath = process.argv[2];
if (!repoPath) {
  console.error("Usage: node migrate-coach-memory-part1.mjs <path-to-athlete-repo-checkout>");
  process.exit(1);
}

const coachDir = path.join(repoPath, "user_data", "coach");
const ledgerDir = path.join(repoPath, "user_data", "ledger");

function readFileIfExists(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

const stateMd = readFileIfExists(path.join(coachDir, "state.md"));
const coachNotesMd = readFileIfExists(path.join(coachDir, "coach_notes.md"));
const rollingStateRaw = readFileIfExists(path.join(coachDir, "rolling_state.json"));
const challengeV2Raw = readFileIfExists(path.join(ledgerDir, "challenge_v2.json"));

if (!stateMd) {
  console.error(`No state.md found at ${coachDir} - nothing to migrate.`);
  process.exit(1);
}

const MIGRATION_TRACE_ID = "migration_part1";
const today = new Date().toISOString().slice(0, 10);

// --- section helpers -------------------------------------------------------------------------

// (?![\s\S]) asserts true end-of-string regardless of the /m flag - a plain $ here would match
// at the end of the section's own first line too (since /m makes $ match every line ending, not
// just the string's end), truncating the captured section to just its heading's first line. Same
// trick coachChatFiles.ts's isAthleteProfileComplete uses, same bug it warns about.
function section(md, heading) {
  const re = new RegExp(`^##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|(?![\\s\\S]))`, "m");
  const m = md.match(re);
  return m ? m[1].trim() : "";
}

function subsection(md, heading, subheading) {
  const sec = section(md, heading);
  const re = new RegExp(
    `\\*\\*${subheading}:\\*\\*\\s*\\n([\\s\\S]*?)(?=\\n\\*\\*[A-Za-z /]+:\\*\\*|(?![\\s\\S]))`,
    "m",
  );
  const m = sec.match(re);
  return m ? m[1].trim() : "";
}

function fieldLine(sectionText, label) {
  const re = new RegExp(`-\\s+\\*\\*${label}:?\\*\\*\\s*(.+)`, "i");
  const m = sectionText.match(re);
  return m ? m[1].trim() : "";
}

// --- profile.json ------------------------------------------------------------------------------

const profileSection = section(stateMd, "Athlete Profile");
// Strips a trailing "(Nickname)" parenthetical - profile.json's name field is the plain name,
// per the spec's own example ("Akash", not "Akash Suresh (Akash)").
const rawName = fieldLine(profileSection, "Name");
const name = rawName ? rawName.replace(/\s*\([^)]*\)\s*$/, "").trim() : null;
const timezoneRaw = fieldLine(profileSection, "Timezone");
const timezoneMatch = timezoneRaw.match(/([A-Za-z_]+\/[A-Za-z_]+)/);
const timezone = timezoneMatch ? timezoneMatch[1] : "UTC";
const weightRaw = fieldLine(profileSection, "Weight");
const weightMatch = weightRaw.match(/([\d.]+)\s*kg/i);
const weight_kg = weightMatch ? Number(weightMatch[1]) : null;

let coach_since = null;
if (challengeV2Raw) {
  try {
    coach_since = JSON.parse(challengeV2Raw).coach_since ?? null;
  } catch {
    coach_since = null;
  }
}

const profileJson = {
  version: 1,
  coach_since,
  name,
  dob: null, // not present in today's state.md - left null, filled later if ever collected
  timezone,
  height_cm: null, // not present in today's state.md
  weight_kg,
};

// --- memory.json ---------------------------------------------------------------------------

function splitList(raw) {
  return raw
    .split(/,|•/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const sports = splitList(fieldLine(profileSection, "Sport\\(s\\) / Activities"));

function note(text) {
  return { text: text.trim(), updated_at: today, trace_id: MIGRATION_TRACE_ID };
}

const equipmentSection = section(stateMd, "Equipment");
const fitnessBaselineSection = section(stateMd, "Fitness Baseline");
const coachingPrioritiesSection = section(stateMd, "Coaching Priorities");
const trainingPatterns = subsection(stateMd, "Learned Patterns", "Training");
const nutritionPatterns = subsection(stateMd, "Learned Patterns", "Nutrition");
const mentalPatterns = subsection(stateMd, "Learned Patterns", "Mental / Performance");

const memoryJson = {
  version: 1,
  _meta: { updated_at: today, updated_by: "migration", trace_id: MIGRATION_TRACE_ID },
  sports,
  notes: {
    fitness_baseline: note(fitnessBaselineSection),
    coaching_priorities: note(coachingPrioritiesSection),
    "learned_patterns.training": note(trainingPatterns),
    "learned_patterns.nutrition": note(nutritionPatterns),
    "learned_patterns.mental": note(mentalPatterns),
    equipment: note(equipmentSection),
  },
};

// --- injuries.json -----------------------------------------------------------------------------

const injurySection = section(stateMd, "Active Injury Flags");
const injuryLines = injurySection
  .split(/\n(?=- \*\*)/)
  .map((l) => l.trim())
  .filter(Boolean);

let injuryCounter = 0;
const flags = injuryLines.map((line) => {
  injuryCounter += 1;
  const labelMatch = line.match(/-\s+\*\*([^*]+):\*\*/);
  const label = labelMatch ? labelMatch[1].trim() : `flag_${injuryCounter}`;
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return {
    id: `inj_${slug || injuryCounter}`,
    text: line.replace(/^-\s+/, "").trim(),
    status: "active",
    // Migration doesn't try to parse each flag's "Onset ..." date out of free text - opened_at is
    // set to today (the migration date) since that's the one date this script can state with
    // confidence. Flag content (including the real onset date) is preserved verbatim in `text`.
    // This only ever runs against Skanda's or Akash's own repo (the only two athletes) - before
    // running this for real (not a scratch-branch test), ask them for each flag's actual onset
    // date and pass it in instead of defaulting to today, so opened_at reflects reality rather
    // than the day the migration happened to run.
    opened_at: today,
    resolved_at: null,
  };
});

const injuriesJson = { flags };

// --- sessions.json -----------------------------------------------------------------------------

const rows = [];

// state.md's "Recent Session Notes" rolling section - each bullet is "- **date — title:** text".
// Heading text after "Recent Session Notes" varies (an italic annotation) so match on the fixed
// prefix only, same way the real isAthleteProfileComplete matches "## Athlete Profile" alone.
const recentSection = section(stateMd, "Recent Session Notes[^\\n]*");
const recentLines = recentSection
  .split(/\n(?=- \*\*)/)
  .map((l) => l.trim())
  .filter(Boolean);
for (const line of recentLines) {
  const m = line.match(/^-\s+\*\*(\d{4}-\d{2}-\d{2})[^:]*:\*\*\s*(.+)$/s);
  if (!m) continue;
  const [, date, text] = m;
  rows.push({
    id: `sess_${date}_${Math.random().toString(36).slice(2, 6)}`,
    date,
    ts: `${date}T00:00:00Z`,
    type: "chat",
    text: text.trim(),
    trace_id: MIGRATION_TRACE_ID,
  });
}

// coach_notes.md's "## YYYY-MM-DD — title" sections, one row per section
const noteSections = coachNotesMd
  .split(/\n(?=## \d{4}-\d{2}-\d{2})/)
  .map((s) => s.trim())
  .filter(Boolean);
for (const sec of noteSections) {
  const headerMatch = sec.match(/^##\s+(\d{4}-\d{2}-\d{2})[^\n]*\n([\s\S]*)$/);
  if (!headerMatch) continue;
  const [, date, body] = headerMatch;
  const text = body.trim();
  if (!text) continue;
  rows.push({
    id: `sess_${date}_${Math.random().toString(36).slice(2, 6)}`,
    date,
    ts: `${date}T00:00:00Z`,
    type: "chat",
    text,
    trace_id: MIGRATION_TRACE_ID,
  });
}

// rolling_state.json - already {date, text} entries, same shape modulo id/ts/type/trace_id
if (rollingStateRaw && rollingStateRaw.trim()) {
  try {
    const parsed = JSON.parse(rollingStateRaw);
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (typeof entry.date !== "string" || typeof entry.text !== "string") continue;
        rows.push({
          id: `sess_${entry.date}_${Math.random().toString(36).slice(2, 6)}`,
          date: entry.date,
          ts: `${entry.date}T00:00:00Z`,
          type: "chat",
          text: entry.text,
          trace_id: MIGRATION_TRACE_ID,
        });
      }
    }
  } catch {
    console.warn("rolling_state.json present but unparsable - skipped");
  }
}

// Sort oldest-first, dedupe exact (date, text) pairs that would come from rolling_state.json
// overlapping the tail of Recent Session Notes.
rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
const seen = new Set();
const dedupedRows = rows.filter((r) => {
  const key = `${r.date}|${r.text}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

const coachLogJson = { version: 1, rows: dedupedRows };

// --- write ---------------------------------------------------------------------------------

fs.writeFileSync(path.join(coachDir, "profile.json"), JSON.stringify(profileJson, null, 2) + "\n");
fs.writeFileSync(path.join(coachDir, "memory.json"), JSON.stringify(memoryJson, null, 2) + "\n");
fs.writeFileSync(
  path.join(coachDir, "injuries.json"),
  JSON.stringify(injuriesJson, null, 2) + "\n",
);
fs.writeFileSync(
  path.join(coachDir, "coach_log.json"),
  JSON.stringify(coachLogJson, null, 2) + "\n",
);

// Full replace, not a parallel-file era: once the four new files are written, the old ones this
// migration read from go away entirely (Skanda's direction - no permanent parallel-file period).
const removed = [];
for (const name of ["state.md", "coach_notes.md", "rolling_state.json"]) {
  const p = path.join(coachDir, name);
  if (fs.existsSync(p)) {
    fs.rmSync(p);
    removed.push(name);
  }
}

console.log(
  `Wrote profile.json, memory.json, injuries.json (${flags.length} flags), coach_log.json (${dedupedRows.length} rows) to ${coachDir}`,
);
console.log(`Removed: ${removed.length > 0 ? removed.join(", ") : "(none found)"}`);
console.log(
  "Review the diffs, then commit on your scratch branch yourself - this script does not touch git.",
);
