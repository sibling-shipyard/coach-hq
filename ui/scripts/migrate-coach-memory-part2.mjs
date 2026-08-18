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

// Found in review: a "milestone"-type quest was being relabeled "progress" and kept in
// quests.json, carrying its (usually prose, e.g. "3x5 negatives") current/target straight into a
// type whose rendering assumes a numeric target (coachContext.ts renders progress-type quests as
// "<value>/<target> <unit>" - a real fraction). Verified this is actually broken, not just
// theoretical: built a synthetic milestone-type quest and ran it through the full pipeline
// (migration -> renderQuestContext) - it rendered as "3x5 negatives/3x5 strict", nonsense as a
// progress readout. The right fix isn't converting the type, it's routing the whole thing to
// progressions.json instead - that file already has exactly this shape (current/target/unit as
// prose, no numeric-fraction assumption anywhere it's rendered). A milestone-type quest never
// becomes a quests.json entry or a progress.json row at all now.
const questsSrc = Array.isArray(challenge.quests) ? challenge.quests : [];
const milestoneQuestsSrc = questsSrc.filter((q) => q.type === "milestone");
const realQuestsSrc = questsSrc.filter((q) => q.type !== "milestone");
const quests = realQuestsSrc.map((q) => {
  const quest = {
    id: q.id,
    name: q.name,
    type: q.type,
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
// upserted by (quest_id, date) same as quest_event would at runtime - a real Map keyed by
// quest_id+date, not just an id string that happens to look the same. Found in review: the
// previous version called this "upserted" in the comment but pushRow unconditionally pushed, so
// a date appearing in two of completed_dates/excused_dates/missed_dates for the same quest (the
// exact invariant SOUL's own docs warn against - "write to ONE array only, not both for the same
// date") would silently produce two rows sharing one id instead of one row winning. Fixed to a
// real upsert: last write for a given quest_id+date wins, same as the runtime applier.
//
// Runs over side quests AND main_quest (quest_id "main", per coach-redesign-part2-ledger.md's
// answered question #1 - the main quest's progress is split the same way side quests are).
// Found in review: this used to only iterate questsSrc (side quests), silently dropping the main
// quest's own completed_dates/current if it had any. A count_target main quest (this athlete's
// real data) computes its progress live from activity history, not stored dates, so this was a
// no-op here - but the loop needs to cover main_quest generically, not just for this one athlete.
// milestone-type quests are excluded here (realQuestsSrc, not questsSrc) - they route to
// progressions.json below instead, never a progress.json row.
const rowsByKey = new Map();
for (const q of [mainQuestSrc, ...realQuestsSrc]) {
  const questId = q === mainQuestSrc ? mainQuest.id : q.id;
  const upsertRow = (date, status, value) => {
    rowsByKey.set(`${questId}|${date}`, {
      id: `pr_${questId}_${date}`,
      quest_id: questId,
      season_id: seasonId,
      date,
      status,
      value: value ?? null,
      source: "model",
      ts: `${date}T00:00:00Z`,
      trace_id: MIGRATION_TRACE_ID,
    });
  };
  for (const date of q.completed_dates ?? []) upsertRow(date, "completed");
  for (const date of q.excused_dates ?? []) upsertRow(date, "excused");
  for (const date of q.missed_dates ?? []) upsertRow(date, "missed");
  if (q.type === "progress" && q.current != null) {
    // No per-date history for progress-type quests in challenge_v2.json - only today's snapshot
    // exists, so it becomes one row dated today.
    upsertRow(today, "completed", q.current);
  }
}
const rows = [...rowsByKey.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

const progressJson = { version: 1, rows };

// --- progressions.json -------------------------------------------------------------------------

// No SEPARATE milestones[]/progressions data exists in challenge_v2.json today (confirmed via
// grep before writing this script). What does exist, if any: milestone-TYPE quests inside the
// quests[] array (VALID_QUEST_TYPES included "milestone" as a quest type, distinct from a real
// milestones/progressions list) - those route here now instead of into quests.json/progress.json
// (see the quests[] mapping above for why). current/target/unit are already prose-shaped for
// this type, so no conversion needed - this is the shape they were always meant for.
const migratedMilestones = milestoneQuestsSrc.map((q) => ({
  id: q.id,
  name: q.name,
  current: q.current ?? "",
  target: q.target ?? "",
  unit: q.unit ?? null,
  history: [],
}));

const progressionsJson = {
  version: 1,
  _meta: { updated_at: today, updated_by: "migration", trace_id: MIGRATION_TRACE_ID },
  progressions: migratedMilestones,
};

// --- write ---------------------------------------------------------------------------------

fs.writeFileSync(path.join(coachDir, "seasons.json"), JSON.stringify(seasonsJson, null, 2) + "\n");
fs.writeFileSync(path.join(coachDir, "quests.json"), JSON.stringify(questsJson, null, 2) + "\n");
fs.writeFileSync(path.join(coachDir, "progress.json"), JSON.stringify(progressJson, null, 2) + "\n");
fs.writeFileSync(path.join(coachDir, "progressions.json"), JSON.stringify(progressionsJson, null, 2) + "\n");

fs.rmSync(path.join(ledgerDir, "challenge_v2.json"));

// The season-closing recap/archive ritual is dropped entirely for now, not just its JSON
// snapshots - confirmed with Skanda (issue #411 tracks revisiting whether it comes back in some
// form later). archive/seasons/ (recap.md, roadmap.md, challenge_v2.json snapshots alike) is
// removed wholesale. If that content ever needs recovering, it's in this migration commit's
// parent in git history, on whatever branch this ran on.
let removedArchive = false;
if (fs.existsSync(archiveSeasonsDir)) {
  fs.rmSync(archiveSeasonsDir, { recursive: true });
  removedArchive = true;
}

console.log(
  `Wrote seasons.json (1 season), quests.json (${quests.length} quests), progress.json (${rows.length} rows), progressions.json (empty) to ${coachDir}`,
);
console.log(
  `Removed: user_data/ledger/challenge_v2.json${removedArchive ? ", user_data/coach/archive/seasons/ (recap ritual dropped for now - issue #411)" : ""}`,
);
console.log("Review the diffs, then commit on your scratch branch yourself - this script does not touch git.");
