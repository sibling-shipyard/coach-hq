#!/usr/bin/env node
/**
 * carve-skeleton.mjs — Build coach-skeleton from HQ.
 *
 * Skeleton shape (see engine/README.md + diagram): data bands (init/post-init/gen)
 * + SOUL.md copy + minimal sync scripts. No agents, soul layers, templates, or plugins.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SKELETON_REPO = "sibling-shipyard/coach-skeleton";

const ENGINE_DIR = path.join(REPO_ROOT, "engine");

/** Bare-minimum scripts carved into skeleton (gen band only). */
const SKELETON_SCRIPT_FILES = [
  "scripts/regenerate_derived.py",
  "scripts/build-aggregate.mjs",
  "scripts/generate_quest_log.py",
  "scripts/generate_quest_history.py",
];

/** lib/ for build-aggregate path resolution only */
const SKELETON_DIRS = ["lib"];

/** Copied at provision for Strava athletes — NOT in base skeleton */
const STRAVA_PROVISION_BUNDLE = [
  "scripts/run_sync_pipeline.py",
  "strava",
  "core",
];

const SKELETON_ROOT_FILES = [];

const CHALLENGE_V2_TEMPLATE = {
  version: 2,
  last_updated_by: "coach",
  last_updated_at: "2026-01-01",
  challenge: {
    name: "My 60-Day Challenge",
    start_date: "2026-01-01",
    duration_days: 60,
    end_date: "2026-03-01",
  },
  weekly_targets: {
    "Morning Routine": {
      target: 7,
      source: "quest",
      quest_id: "morning_routine",
    },
    "Strength Training": {
      target: 2,
      source: "strava_pattern",
      pattern: "^Strength\\s*#",
    },
    Sport: {
      target: 2,
      source: "strava_sport",
      sport_type: "Badminton",
      pattern: "^(Session|Training|Match)",
    },
  },
  main_quest: {
    id: "main",
    name: "20 Strength Sessions",
    type: "count_target",
    target: 20,
    count_from: "strava",
    count_pattern: "^Strength\\s*#",
    notes: "Regex matched against Strava activity names from challenge start date",
  },
  quests: [
    {
      id: "morning_routine",
      name: "Morning Routine",
      type: "daily_streak",
      category: "side",
      start_date: "2026-01-01",
      status: "active",
      polarity: "default_done",
      tracking: "manual",
      missed_dates: [],
      excused_dates: [],
      notes: "Daily morning routine — skips are excused on rest days",
    },
    {
      id: "example_progress",
      name: "Read a Book",
      type: "progress",
      category: "side",
      start_date: "2026-01-01",
      status: "active",
      tracking: "manual",
      current: 0,
      target: 10,
      unit: "chapters",
    },
  ],
};

const CURRENT_WEEK_TEMPLATE = {
  schema_version: null,
  data_status: "unavailable",
  timezone: "UTC",
  week: null,
  coach_read: null,
  days: [],
  coach_comments: [],
  updated_at: null,
  updated_by: "skeleton-init",
};

const WIDGET_SNAPSHOTS_PLACEHOLDER = {
  schema_version: 1,
  generated_at: "1970-01-01T00:00:00.000Z",
  home: {},
};

const SYNC_STATE_TEMPLATE = {
  oldest_synced: null,
  newest_synced: null,
  total_activities: 0,
  since: null,
  last_run: null,
};

const SYNC_STATUS_TEMPLATE = {
  timestamp: null,
  status: "none",
  activities_synced: 0,
  activities_renamed: 0,
  descriptions_parsed: 0,
  warnings: [],
  commit_message: "",
};

const STATE_MD_TEMPLATE = `# Coach Phelps: state.md (Living Memory)
*Updated every session via the Commit Protocol.*
*For quest status, streaks, and progress — see quest_log.md (auto-generated, read-only).*

## Athlete Profile
*(Filled in during First Session)*
- **Name:**
- **Sport(s) / Activities:**
- **Goal:**
- **Timeline / Upcoming events:**
- **Coaching style preference:**
- **Timezone:**

## Current Season
*(Defined during First Session)*
- **Season name:**
- **Phase:**
- **Phase dates:**

## Recent Session Notes *(rolling — last 3 sessions)*
*(Empty — first session will populate this)*

## Active Injury Flags
*(None — update if injuries arise)*

## Current Week Plan
*(Set during first weekly planning session)*

## Learned Patterns
*(Coach builds this over time — starts empty)*
`;

const COACH_NOTES_TEMPLATE = `# Coach Notes
*Coach's private working memory. Append observations, analysis, accountability data points, and anything worth remembering long-term. Append-only.*
`;

const OPPONENT_NOTES_TEMPLATE = `# Opponent Notes
*Optional — sport-specific scouting notes. Starts empty.*
`;

const SKELETON_GITIGNORE = `.env
.env.local
strava/strava_tokens.json
training/activities/history/
__pycache__/
*.pyc
*.pyo
.DS_Store
`;

const SKELETON_README = `# coach-skeleton

Private fork template for \`coach-<user>\` repos. Carved from \`coach-phelps-hq\`.

## What's in this repo

| Band | Paths |
|---|---|
| **init** | \`training/coach/*\`, \`training/activities/history/\` |
| **post-init** | \`training/ledger/*\`, \`sessions/\` |
| **gen** | \`data/aggregate.json\`, \`training/widget_snapshots.json\`, quest/sync outputs |
| **SOUL** | \`SOUL.md\` — committed copy from HQ (not editable) |
| **scripts** | Sync + aggregate only — no agents, no soul source layers |

Dashboard: shared site reads \`data/aggregate.json\`. iOS app pushes history directly.

Pin: \`.coach-engine-version\` · Operator: \`coach-phelps-hq/scripts/carve-skeleton.mjs\`
`;

const SKELETON_CLAUDE = `# Claude Code entry

You are **Coach Phelps**. Read \`SOUL.md\` §1 and boot from \`training/coach/state.md\`.

This is an athlete repo — not the HQ monorepo. No multi-agent routing.
`;

function parseArgs(argv) {
  const opts = { dryRun: false, push: false, sha: null, outDir: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--push") opts.push = true;
    else if (arg === "--sha") opts.sha = argv[++i];
    else if (arg === "--out-dir") opts.outDir = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage:
  node scripts/carve-skeleton.mjs --dry-run [--out-dir DIR] [--sha SHA]
  node scripts/carve-skeleton.mjs --push [--sha SHA]`);
      process.exit(0);
    }
  }
  if (!opts.dryRun && !opts.push) {
    console.error("Specify --dry-run or --push");
    process.exit(1);
  }
  if (opts.dryRun && opts.push) {
    console.error("Use only one of --dry-run or --push");
    process.exit(1);
  }
  return opts;
}

function gitSha(override) {
  if (override) return override;
  return execSync("git rev-parse HEAD", { cwd: REPO_ROOT, encoding: "utf-8" }).trim();
}

function copyFile(srcRel, destRoot) {
  const src = path.join(REPO_ROOT, srcRel);
  const dest = path.join(destRoot, srcRel);
  if (!fs.existsSync(src)) {
    throw new Error(`Missing source file: ${srcRel}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(srcRel, destRoot) {
  const src = path.join(REPO_ROOT, srcRel);
  const dest = path.join(destRoot, srcRel);
  if (!fs.existsSync(src)) {
    throw new Error(`Missing source directory: ${srcRel}`);
  }
  fs.cpSync(src, dest, { recursive: true });
}

function writeJson(destRoot, relPath, data) {
  const dest = path.join(destRoot, relPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, `${JSON.stringify(data, null, 2)}\n`);
}

function writeText(destRoot, relPath, text) {
  const dest = path.join(destRoot, relPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, text.endsWith("\n") ? text : `${text}\n`);
}

function copyFromEngine(outDir, rel) {
  const src = path.join(ENGINE_DIR, rel);
  const dest = path.join(outDir, rel);
  if (!fs.existsSync(src)) {
    throw new Error(`Missing engine/${rel}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.statSync(src).isDirectory()) {
    fs.cpSync(src, dest, { recursive: true });
    // Never ship local OAuth tokens
    const tokens = path.join(dest, "strava_tokens.json");
    if (tokens.includes("strava") && fs.existsSync(tokens)) {
      fs.unlinkSync(tokens);
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

function copyWorkflows(outDir) {
  const wfDir = path.join(outDir, ".github/workflows");
  fs.mkdirSync(wfDir, { recursive: true });

  fs.copyFileSync(
    path.join(ENGINE_DIR, ".github/workflows/sync.user.yml"),
    path.join(wfDir, "sync.yml"),
  );

  for (const wf of ["validate-data.yml", "apply-coach-patch.yml"]) {
    fs.copyFileSync(path.join(ENGINE_DIR, ".github/workflows", wf), path.join(wfDir, wf));
  }
  // No validate-soul — skeleton carries SOUL.md copy only, no soul/ layers
}

function ensureComposedSoul() {
  const compose = spawnSync("node", ["engine/scripts/compose-soul.mjs"], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  });
  if (compose.status !== 0) {
    console.error(compose.stderr || compose.stdout);
    throw new Error("engine/scripts/compose-soul.mjs failed before carve");
  }
}

function carve(outDir, sha) {
  console.log(`Carving skeleton → ${outDir}`);
  console.log(`Pinned HQ SHA: ${sha}`);

  ensureComposedSoul();

  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outDir, { recursive: true });

  for (const rel of SKELETON_SCRIPT_FILES) {
    copyFromEngine(outDir, rel);
  }
  for (const rel of SKELETON_DIRS) {
    copyFromEngine(outDir, rel);
  }
  copyWorkflows(outDir);

  for (const rel of SKELETON_ROOT_FILES) {
    copyFile(rel, outDir);
  }

  copyFile("SOUL.md", outDir);

  writeText(outDir, ".coach-engine-version", `hq_sha=${sha}`);
  writeText(outDir, "README.md", SKELETON_README);
  writeText(outDir, "CLAUDE.md", SKELETON_CLAUDE);
  writeText(outDir, ".gitignore", SKELETON_GITIGNORE);

  // init band
  writeText(outDir, "training/coach/state.md", STATE_MD_TEMPLATE);
  writeText(outDir, "training/coach/coach_notes.md", COACH_NOTES_TEMPLATE);
  writeText(outDir, "training/coach/opponent_notes.md", OPPONENT_NOTES_TEMPLATE);
  writeText(outDir, "training/activities/history/.gitkeep", "");

  // post-init band (empty templates)
  writeJson(outDir, "training/ledger/challenge_v2.json", CHALLENGE_V2_TEMPLATE);
  writeJson(outDir, "training/ledger/current_week.json", CURRENT_WEEK_TEMPLATE);
  writeText(outDir, "sessions/.gitkeep", "");

  // gen band placeholders / seeds
  writeJson(outDir, "training/activities/sleep_log.json", []);
  writeJson(outDir, "training/sync_state.json", SYNC_STATE_TEMPLATE);
  writeJson(outDir, "training/sync_status.json", SYNC_STATUS_TEMPLATE);
  writeJson(outDir, "training/widget_snapshots.json", WIDGET_SNAPSHOTS_PLACEHOLDER);

  console.log("✓ Skeleton tree carved (SOUL.md copy + data bands + minimal scripts)");
  return outDir;
}

function pushSkeleton(outDir, sha) {
  const gitDir = path.join(outDir, ".git");
  if (!fs.existsSync(gitDir)) {
    execSync("git init -b main", { cwd: outDir, stdio: "inherit" });
  }
  execSync("git add -A", { cwd: outDir, stdio: "inherit" });
  try {
    execSync(`git commit -m "core: carve skeleton from hq ${sha.slice(0, 12)}"`, {
      cwd: outDir,
      stdio: "inherit",
    });
  } catch {
    console.log("Nothing to commit (unchanged tree)");
  }

  try {
    execSync(`gh repo view ${SKELETON_REPO}`, { stdio: "pipe" });
  } catch {
    console.log(`Creating ${SKELETON_REPO}...`);
    execSync(
      `gh repo create ${SKELETON_REPO} --private --description "Coach Phelps fork template (carved from HQ)"`,
      { stdio: "inherit" },
    );
  }

  const remoteUrl = `https://github.com/${SKELETON_REPO}.git`;
  try {
    execSync(`git remote get-url origin`, { cwd: outDir, stdio: "pipe" });
    execSync(`git remote set-url origin ${remoteUrl}`, { cwd: outDir, stdio: "inherit" });
  } catch {
    execSync(`git remote add origin ${remoteUrl}`, { cwd: outDir, stdio: "inherit" });
  }

  execSync("git push -u origin main --force", { cwd: outDir, stdio: "inherit" });
  console.log(`✓ Pushed to https://github.com/${SKELETON_REPO}`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const sha = gitSha(opts.sha);
  const outDir = opts.outDir
    ? path.resolve(opts.outDir)
    : opts.dryRun
      ? path.join(REPO_ROOT, "skeleton-out")
      : path.join(REPO_ROOT, ".skeleton-push");

  carve(outDir, sha);

  if (opts.push) {
    pushSkeleton(outDir, sha);
  } else {
    console.log(`Dry-run output: ${outDir}`);
  }
}

main();
