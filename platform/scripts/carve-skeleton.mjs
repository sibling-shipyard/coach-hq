#!/usr/bin/env node
/**
 * carve-skeleton.mjs — Build coach-skeleton from HQ.
 *
 * BYO tree (see docs/eng-docs/skeleton-layout.md): engine runtime, gen/ placeholders,
 * user_data/ init bands. No agents, soul layers, ui/, ios/, kdb/.
 *
 * SOUL: the carve currently ships **none** — ADR 0021 retired the propagated copy, and this
 * script has not carved a SOUL since. Issue #358 restores it, and it will carve the BYO build
 * `platform/SOUL.claude.md` only; `platform/SOUL.chat.md` is coach-chat's and never leaves HQ.
 *
 * Copy map and band model: kdb/decisions/0011-hq-four-band-layout.md
 * Restructure milestones: docs/eng-docs/hq-restructure-plan.md (R0–R5)
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const SKELETON_REPO = "sibling-shipyard/coach-skeleton";

const ENGINE_DIR = path.join(REPO_ROOT, "engine");
const PLATFORM_DIR = path.join(REPO_ROOT, "platform");

/** Scripts carved into engine/scripts/ */
const SKELETON_SCRIPT_FILES = [
  "scripts/regenerate_derived.py",
  "scripts/build-dashboard-snapshot.mjs",
  "scripts/generate-athlete-insights.mjs",
  "scripts/generate_quest_history.py",
  "scripts/validate-current-week.mts",
];

/** Dirs carved into engine/ */
const SKELETON_ENGINE_DIRS = ["lib", "core"];

/** Workout plan templates copied from platform/skeleton-templates/ → user_data/.../templates/ */
const WORKOUT_TEMPLATES = ["foundation.json", "strength_a.json"];

const CHALLENGE_V2_TEMPLATE = {
  // Canonical shape per ADR 0006 — season block (not challenge), weekly_targets as
  // flat numbers (not source-config objects; nothing in the dashboard/iOS consumes
  // the richer shape — see docs/eng-docs/challenge-v2-schema.md).
  version: 4,
  last_updated_by: "coach",
  last_updated_at: "2026-01-01",
  season: {
    name: "My 60-Day Challenge",
    start_date: "2026-01-01",
    end_date: "2026-03-01",
  },
  // Populated with real example content, like main_quest below, rather than omitted —
  // every athlete's coaching model gets a phase/block from day one.
  phase: {
    name: "Block 1",
    start_date: "2026-01-01",
    current_block: {
      id: "block_1",
      name: "Block 1",
      start_date: "2026-01-01",
      end_date: "2026-01-28",
      note: "First training block of the season.",
    },
  },
  weekly_targets: {
    strength: 2,
    cardio: 1,
  },
  main_quest: {
    id: "main",
    name: "20 Strength Sessions",
    type: "count_target",
    target: 20,
    count_pattern: "^WeightTraining\\s*#",
    notes: "Regex (case-insensitive) matched against synced activity names from the season start date. Update the pattern to match this athlete's actual naming — check gen/dashboard_snapshot.json for real activity names, don't assume this example matches.",
  },
  quests: [
    {
      id: "morning_routine",
      name: "Morning Routine",
      type: "daily_streak",
      category: "side",
      start_date: "2026-01-01",
      status: "active",
      polarity: "default_not_done",
      tracking: "manual",
      completed_dates: [],
      excused_dates: [],
      notes: "Daily morning routine — logged days go in completed_dates, rest/travel days in excused_dates",
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

const PLUGINS_TEMPLATE = {
  enabled: [],
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
  trace_id: null,
};

const DASHBOARD_SNAPSHOT_PLACEHOLDER = {
  schema_version: 1,
  generated_at: "1970-01-01T00:00:00.000Z",
  activities: [],
  ledger_schema: "challenge_v2_v4",
  ledger: null,
  challenge_v2: CHALLENGE_V2_TEMPLATE,
  current_week: CURRENT_WEEK_TEMPLATE,
  sync_status: {
    status: "none",
    timestamp: null,
    activities_synced: 0,
    activities_renamed: 0,
    descriptions_parsed: 0,
    warnings: [],
  },
  sleep_log: [],
  quest_history: { generated_at: "", quests: {} },
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
  counter_year: null,
  counters: {},
  hk_last_synced: null,
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

const QUEST_HISTORY_PLACEHOLDER = {
  generated_at: "",
  quests: {},
};

const STATE_MD_TEMPLATE = `# Coach Phelps: state.md (Living Memory)
*Updated every session via the Commit Protocol.*

## Athlete Profile
*(Filled in during First Session)*
- **Name:**
- **Sport(s) / Activities:**
- **Goal:**
- **Timeline / Upcoming events:**
- **Coaching style preference:**
- **Age:**
- **Height:**
- **Weight:**
- **Timezone:**
  *(inferred from the athlete's stated city/country, not asked directly — see FSP §10)*

## Equipment
*(Filled in during First Session — update as equipment changes)*

## Current Season
*(Defined during First Session)*
- **Season name:**
- **Phase:**
- **Phase dates:**

## Current Phase / Block Context
*(Optional — only if this athlete's coaching model uses phases/blocks within a season. Leave empty otherwise.)*

## Recent Session Notes *(rolling — last 3 sessions)*
*(Empty — first session will populate this)*

## Fitness Baseline
*(Coach builds this over time — starts empty)*

## RPE Calibration
*(Individual anchors so "RPE 7" means the same thing every session — starts empty)*

| RPE | Anchor |
|-----|--------|

## Sleep Log (rolling 7 days)
*(Rolling 7-day window. Drop oldest when adding new — starts empty)*

| Date | Sleep | Resting HR | Notes |
|------|-------|------------|-------|

## Active Injury Flags
*(None — update if injuries arise)*

## Current Week Plan
*(Set during first weekly planning session)*

## Coaching Priorities
*(Coach builds this over time — starts empty)*

## Learned Patterns
**Training:**
*(Coach builds this over time — starts empty)*

**Nutrition:**
*(Coach builds this over time — starts empty)*

**Mental / Performance:**
*(Coach builds this over time — starts empty)*
`;

const COACH_NOTES_TEMPLATE = `# Coach Notes
*Coach's private working memory. Append observations, analysis, accountability data points, and anything worth remembering long-term. Append-only.*
`;

// SOUL's closing-ritual (platform/soul/B_engine.md "Closing a phase") writes a
// retrospective here whenever a phase/block closes — scaffolded so every athlete has
// somewhere for it to land, whether or not their coaching model actually uses phases.
const ARCHIVE_PHASES_TEMPLATE = `# Archived Phases & Blocks
*(Empty — populated when a phase/block closes.)*
`;

// Named alongside archive/phases.md in B_engine.md's closing-ritual commit list —
// closed-week history, distinct from the phase-level retrospective above.
const ARCHIVE_WEEK_PLANS_TEMPLATE = `# Archived Week Plans
*(Empty — populated as weeks close.)*
`;

const SKELETON_GITIGNORE = `.env
.env.local
user_data/activities/hist/
__pycache__/
*.pyc
*.pyo
.DS_Store
`;

const SKELETON_README = `# coach-skeleton

Private fork template for \`coach-<user>\` repos. Carved from \`coach-phelps-hq\`. This repo is a
data/backing store for the hosted Coach Phelps web + iOS app — Coach Phelps's persona and
coaching logic live once in HQ (\`coach-phelps-hq\`), not duplicated here; there is no local/BYO
coaching mode.

## What's in this repo

| Band | Paths |
|---|---|
| **init** | \`user_data/coach/*\`, \`user_data/activities/hist/\` |
| **post-init** | \`user_data/ledger/*\`, \`user_data/activities/workout_plans/sessions/\` |
| **gen** | \`gen/dashboard_snapshot.json\`, \`gen/athlete_insights.json\`, \`gen/sync_status.json\`, \`gen/widget_snapshots.json\` |
| **engine** | Runtime scripts, core, and shared naming/query logic — carved from HQ; coach must not edit |

Dashboard: shared site reads \`gen/dashboard_snapshot.json\`. iOS app pushes \`user_data/activities/hist/\` directly.

Pin: \`.coach-engine-version\` · Operator: \`coach-phelps-hq/platform/scripts/carve-skeleton.mjs\`
`;

const SETUP_MD = `# Setup — coach-<user> repo

One checklist to go from fork to first coaching session. Budget ~10 minutes. This repo is a
data/backing store for the hosted Coach Phelps web + iOS app — you never open a local coding
tool against it; all coaching happens through the app.

---

## 1. Clone your repo

Fork \`sibling-shipyard/coach-skeleton\` (or use the private repo your operator created), then:

\`\`\`bash
git clone https://github.com/YOUR_USERNAME/coach-YOUR_NAME.git
cd coach-YOUR_NAME
\`\`\`

---

## 2. GitHub secrets

**None required.** The Sync workflow runs under the built-in \`GITHUB_TOKEN\` (granted
\`contents: write\`), which GitHub provisions automatically for every Actions run. You do **not**
need to create a \`PAT_TOKEN\` or any other secret to push sync output.

---

## 3. Install the GitHub App

The Coach Phelps web dashboard and iOS app need the **Coach Phelps GitHub App** installed on
your repo.

1. Your operator sends you the app install link (or open the shared dashboard and sign in).
2. Install the app on **this repo only** (or all repos if you prefer).
3. Grant the permissions it requests (read repo contents, trigger workflows).

---

## 4. Open the Coach Phelps app

Sign in on the web dashboard or the iOS app and connect this repo. Coach detects the blank
Athlete Profile in \`user_data/coach/state.md\` and runs the First Session intake automatically
the first time you open chat.

---

## 5. First sync

Trigger the pipeline once so \`gen/\` is populated:

1. **GitHub → Actions → Sync → Run workflow**, or
2. Locally: \`python3 engine/scripts/regenerate_derived.py\`, then run the dashboard snapshot and athlete insights generators.

After sync, \`gen/dashboard_snapshot.json\` and \`gen/athlete_insights.json\` reflect your ledger and activity history.

---

## Troubleshooting

- **Sync workflow fails:** open **Actions → Sync** and read the failed run's log. The workflow uses the built-in \`GITHUB_TOKEN\` (no secret to set); if pushes are rejected, confirm the repo's **Settings → Actions → General → Workflow permissions** is set to **Read and write**.
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
  node platform/scripts/carve-skeleton.mjs --dry-run [--out-dir DIR] [--sha SHA]
  node platform/scripts/carve-skeleton.mjs --push [--sha SHA]`);
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

/** Copy engine/<rel> → outDir/engine/<rel> */
function copyFromEngine(outDir, rel) {
  const src = path.join(ENGINE_DIR, rel);
  const dest = path.join(outDir, "engine", rel);
  if (!fs.existsSync(src)) {
    throw new Error(`Missing engine/${rel}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.statSync(src).isDirectory()) {
    fs.cpSync(src, dest, { recursive: true });
  } else {
    fs.copyFileSync(src, dest);
  }
}

function copyEngineTemplate(outDir, filename) {
  const src = path.join(PLATFORM_DIR, "skeleton-templates", filename);
  const dest = path.join(
    outDir,
    "user_data/activities/workout_plans/templates",
    filename,
  );
  if (!fs.existsSync(src)) {
    throw new Error(`Missing platform/skeleton-templates/${filename}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
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
}

function carve(outDir, sha) {
  console.log(`Carving skeleton → ${outDir}`);
  console.log(`Pinned HQ SHA: ${sha}`);

  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outDir, { recursive: true });

  for (const rel of SKELETON_SCRIPT_FILES) {
    copyFromEngine(outDir, rel);
  }
  for (const rel of SKELETON_ENGINE_DIRS) {
    copyFromEngine(outDir, rel);
  }
  copyWorkflows(outDir);

  writeText(outDir, ".coach-engine-version", `hq_sha=${sha}`);
  writeText(outDir, "README.md", SKELETON_README);
  writeText(outDir, "SETUP.md", SETUP_MD);
  writeText(outDir, ".gitignore", SKELETON_GITIGNORE);
  const validateWrapperSrc = path.join(REPO_ROOT, "engine/scripts/validate-current-week");
  fs.copyFileSync(validateWrapperSrc, path.join(outDir, "engine/scripts/validate-current-week"));
  fs.chmodSync(path.join(outDir, "engine/scripts/validate-current-week"), 0o755);

  // user_data — init band
  writeText(outDir, "user_data/coach/state.md", STATE_MD_TEMPLATE);
  writeText(outDir, "user_data/coach/coach_notes.md", COACH_NOTES_TEMPLATE);
  writeJson(outDir, "user_data/coach/sleep_log.json", []);
  writeJson(outDir, "user_data/coach/chat_history.json", { threads: [] });
  writeText(outDir, "user_data/coach/reference/.gitkeep", "");
  writeText(outDir, "user_data/coach/archive/phases.md", ARCHIVE_PHASES_TEMPLATE);
  writeText(outDir, "user_data/coach/archive/week_plans.md", ARCHIVE_WEEK_PLANS_TEMPLATE);
  writeText(outDir, "user_data/activities/hist/.gitkeep", "");
  writeJson(outDir, "user_data/activities/sync_state.json", SYNC_STATE_TEMPLATE);

  for (const tpl of WORKOUT_TEMPLATES) {
    copyEngineTemplate(outDir, tpl);
  }
  writeText(outDir, "user_data/activities/workout_plans/sessions/.gitkeep", "");

  // user_data — post-init band
  writeJson(outDir, "user_data/ledger/challenge_v2.json", CHALLENGE_V2_TEMPLATE);
  writeJson(outDir, "user_data/ledger/plugins.json", PLUGINS_TEMPLATE);
  writeJson(outDir, "user_data/ledger/current_week.json", CURRENT_WEEK_TEMPLATE);

  // gen band placeholders
  writeJson(outDir, "gen/dashboard_snapshot.json", DASHBOARD_SNAPSHOT_PLACEHOLDER);
  writeJson(outDir, "gen/athlete_insights.json", { generated_at: "1970-01-01T00:00:00Z", window_days: 365, sports: {} });
  writeJson(outDir, "gen/widget_snapshots.json", WIDGET_SNAPSHOTS_PLACEHOLDER);
  writeJson(outDir, "gen/quest_history.json", QUEST_HISTORY_PLACEHOLDER);
  writeJson(outDir, "gen/sync_status.json", SYNC_STATUS_TEMPLATE);

  console.log("✓ Full BYO skeleton tree carved");
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
