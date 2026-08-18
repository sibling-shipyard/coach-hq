#!/usr/bin/env node
/**
 * One-time migration: reads an athlete repo's CURRENT user_data/ledger/challenge_v2.json and
 * writes seasons.json/quests.json/progress.json/progressions.json in the shapes
 * coach-redesign-part2-ledger.md defines, then deletes challenge_v2.json and any
 * user_data/coach/archive/seasons/ folder. Run once, on a scratch branch, never against main
 * directly - see AGENTS.md's git-push rule and Part 1's migration script, which this follows.
 *
 * Usage:
 *   node ui/scripts/migrate-coach-memory-part2.mjs <path-to-athlete-repo-checkout>
 *
 * Writes the four new files into <repo>/user_data/coach/ and deletes
 * user_data/ledger/challenge_v2.json plus user_data/coach/archive/seasons/ - review and commit
 * the result yourself, this script does not touch git.
 *
 * Note: this only migrates the CURRENT season from challenge_v2.json. Past seasons under
 * archive/seasons/ (each with its own challenge_v2.json) are not replayed into
 * seasons.json/progress.json here -
 * per the spec doc, a completed/retired season just needs a row in seasons[], and reconstructing
 * full daily progress history for past seasons from old snapshots is real work I'm not doing
 * silently as a side effect of this migration. Flagged in my report - do this by hand later if
 * the archived seasons' history actually matters, or accept it starts blank from here.
 */
import fs from "node:fs";
import path from "node:path";

const repoPath = process.argv[2];
if (!repoPath) {
  console.error("Usage: node migrate-coach-memory-part2.mjs <path-to-athlete-repo-checkout>");
  process.exit(1);
}

const coachDir = path.join(repoPath, "user_data", "coach");
const ledgerDir = path.join(repoPath, "user_data", "ledger");
const archiveSeasonsDir = path.join(coachDir, "archive", "seasons");

function readFileIfExists(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

const challengeRaw = readFileIfExists(path.join(ledgerDir, "challenge_v2.json"));
if (!challengeRaw) {
  console.error(`No challenge_v2.json found at ${ledgerDir} - nothing to migrate.`);
  process.exit(1);
}

const challenge = JSON.parse(challengeRaw);
const MIGRATION_TRACE_ID = "migration_part2";
const today = new Date().toISOString().slice(0, 10);

// --- seasons.json ------------------------------------------------------------------------------

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const seasonId = `s_${slugify(challenge.season?.name ?? "current")}`;
const seasonsJson = {
  version: 1,
  _meta: { updated_at: today, updated_by: "migration", trace_id: MIGRATION_TRACE_ID },
  current_season_id: seasonId,
  seasons: [
    {
      id: seasonId,
      name: challenge.season?.name ?? "",
      start_date: challenge.season?.start_date ?? "",
      end_date: challenge.season?.end_date ?? "",
      status: "active",
    },
  ],
};

// --- quests.json ---------------------------------------------------------------------------

// weekly_targets: today's file only has {category: number} - no "quest" source is derivable
// from challenge_v2.json alone, so every target migrates with source omitted (manually tracked),
// same as an athlete-set target with no linked quest.
const weeklyTargets = {};
for (const [key, target] of Object.entries(challenge.weekly_targets ?? {})) {
  weeklyTargets[key] = { target };
}

const mainQuestSrc = challenge.main_quest ?? {};
const mainQuest = {
  id: mainQuestSrc.id ?? "main",
  name: mainQuestSrc.name ?? "",
  type: mainQuestSrc.type ?? "count_target",
  target: mainQuestSrc.target ?? 0,
};
if (mainQuestSrc.count_pattern) mainQuest.count_pattern = mainQuestSrc.count_pattern;

const questsSrc = Array.isArray(challenge.quests) ? challenge.quests : [];
const quests = questsSrc.map((q) => {
  const quest = {
    id: q.id,
    name: q.name,
    type: q.type === "milestone" ? "progress" : q.type, // milestone type dropped - closest fit
    start_date: q.start_date,
    end_date: q.status === "active" ? null : today,
    status: q.status === "active" ? "active" : q.status === "completed" ? "graduated" : "retired",
    source: "model", // every quest in challenge_v2.json today was Coach-set, not athlete-requested
  };
  if (q.polarity) quest.polarity = q.polarity;
  if (q.target != null) quest.target = q.target;
  if (q.unit) quest.unit = q.unit;
  return quest;
});

const questsJson = {
  version: 1,
  _meta: { updated_at: today, updated_by: "migration", trace_id: MIGRATION_TRACE_ID },
  weekly_targets: weeklyTargets,
  main_quest: mainQuest,
  quests,
};

// --- progress.json -----------------------------------------------------------------------------

// challenge_v2.json's per-quest completed_dates/excused_dates arrays become one row per date,
// upserted by (quest_id, date) same as quest_event would at runtime. missed_dates isn't present
// in the current live file (nothing ever wrote to it) but handled the same way if it exists.
const rows = [];
let rowCounter = 0;
for (const q of questsSrc) {
  const pushRow = (date, status, value) => {
    rowCounter += 1;
    rows.push({
      id: `pr_${q.id}_${date}`,
      quest_id: q.id,
      season_id: seasonId,
      date,
      status,
      value: value ?? null,
      source: "model",
      ts: `${date}T00:00:00Z`,
      trace_id: MIGRATION_TRACE_ID,
    });
  };
  for (const date of q.completed_dates ?? []) pushRow(date, "completed");
  for (const date of q.excused_dates ?? []) pushRow(date, "excused");
  for (const date of q.missed_dates ?? []) pushRow(date, "missed");
  if (q.type === "progress" && q.current != null) {
    // No per-date history for progress-type quests in challenge_v2.json - only today's snapshot
    // exists, so it becomes one row dated today.
    pushRow(today, "completed", q.current);
  }
}
rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

const progressJson = { version: 1, rows };

// --- progressions.json -------------------------------------------------------------------------

// No milestones/progressions data exists in challenge_v2.json today (confirmed via grep before
// writing this script) - starts empty, same as any brand-new file.
const progressionsJson = {
  version: 1,
  _meta: { updated_at: today, updated_by: "migration", trace_id: MIGRATION_TRACE_ID },
  progressions: [],
};

// --- write ---------------------------------------------------------------------------------

fs.writeFileSync(path.join(coachDir, "seasons.json"), JSON.stringify(seasonsJson, null, 2) + "\n");
fs.writeFileSync(path.join(coachDir, "quests.json"), JSON.stringify(questsJson, null, 2) + "\n");
fs.writeFileSync(path.join(coachDir, "progress.json"), JSON.stringify(progressJson, null, 2) + "\n");
fs.writeFileSync(path.join(coachDir, "progressions.json"), JSON.stringify(progressionsJson, null, 2) + "\n");

fs.rmSync(path.join(ledgerDir, "challenge_v2.json"));

// "No archive folder" (coach-redesign-part2-ledger.md) only ever meant the JSON snapshots
// (archive/seasons/*/challenge_v2.json), not the prose retrospectives sitting alongside them
// (recap.md, roadmap.md) - those are real season history an athlete wrote, not a data-model
// artifact. Remove only the JSON, leave everything else untouched.
let removedSnapshots = 0;
if (fs.existsSync(archiveSeasonsDir)) {
  for (const seasonDir of fs.readdirSync(archiveSeasonsDir)) {
    const snapshotPath = path.join(archiveSeasonsDir, seasonDir, "challenge_v2.json");
    if (fs.existsSync(snapshotPath)) {
      fs.rmSync(snapshotPath);
      removedSnapshots++;
    }
  }
}

console.log(
  `Wrote seasons.json (1 season), quests.json (${quests.length} quests), progress.json (${rows.length} rows), progressions.json (empty) to ${coachDir}`,
);
console.log(
  `Removed: user_data/ledger/challenge_v2.json${removedSnapshots > 0 ? ` + ${removedSnapshots} archive/seasons/*/challenge_v2.json snapshot(s) (recap.md/roadmap.md left untouched)` : ""}`,
);
console.log("Review the diffs, then commit on your scratch branch yourself - this script does not touch git.");
