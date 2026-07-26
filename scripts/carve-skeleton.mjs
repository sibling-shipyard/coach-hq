#!/usr/bin/env node
/**
 * carve-skeleton.mjs — Build coach-skeleton from HQ.
 *
 * Full BYO tree (see docs/skeleton-layout.md): composed SOUL.md, engine runtime,
 * gen/ placeholders, user_data/ init bands. No agents, soul layers, ui/, ios/, kdb/.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SKELETON_REPO = "sibling-shipyard/coach-skeleton";

const ENGINE_DIR = path.join(REPO_ROOT, "engine");

/** Scripts carved into engine/scripts/ */
const SKELETON_SCRIPT_FILES = [
  "scripts/regenerate_derived.py",
  "scripts/build-aggregate.mjs",
  "scripts/generate_quest_log.py",
  "scripts/generate_quest_history.py",
  "scripts/run_sync_pipeline.py",
];

/** Dirs carved into engine/ (strava always included — inactive without STRAVA_* secrets) */
const SKELETON_ENGINE_DIRS = ["lib", "strava", "core"];

/** Workout plan templates copied from engine/templates/ → user_data/.../templates/ */
const WORKOUT_TEMPLATES = ["foundation.json", "strength_a.json"];

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

const AGGREGATE_PLACEHOLDER = {
  schema_version: 1,
  generated_at: "1970-01-01T00:00:00.000Z",
  activities: [],
  challenge_v2: null,
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
*For quest status, streaks, and progress — see gen/quest_log.md (auto-generated, read-only).*

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

const QUEST_LOG_STARTER = `# Quest Log
> Auto-generated from user_data/ledger/challenge_v2.json + activity history. **DO NOT EDIT.**
> Regenerated by the sync pipeline or \`python3 engine/scripts/generate_quest_log.py\`.

*(Empty — run your first sync or coaching session to populate.)*
`;

const SKELETON_GITIGNORE = `.env
.env.local
engine/strava/strava_tokens.json
user_data/activities/hist/
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
| **init** | \`user_data/coach/*\`, \`user_data/activities/hist/\` |
| **post-init** | \`user_data/ledger/*\`, \`user_data/activities/workout_plans/sessions/\` |
| **gen** | \`gen/aggregate.json\`, \`gen/quest_log.md\`, \`gen/sync_status.json\`, \`gen/widget_snapshots.json\` |
| **SOUL** | \`SOUL.md\` — committed copy from HQ (not editable) |
| **engine** | Runtime scripts, strava, core — carved from HQ; coach must not edit |

Dashboard: shared site reads \`gen/aggregate.json\`. iOS app pushes \`user_data/activities/hist/\` directly.

Pin: \`.coach-engine-version\` · Operator: \`coach-phelps-hq/scripts/carve-skeleton.mjs\`
`;

const SKELETON_CLAUDE = `# Claude Code entry

You are **Coach Phelps**. Read \`SOUL.md\` §1 and boot from \`user_data/coach/state.md\`.

This is an athlete repo — not the HQ monorepo. No multi-agent routing.
`;

const SETUP_MD = `# Setup — Bring Your Own Claude

One checklist to go from fork to first coaching session. Budget ~20 minutes.

---

## 1. Clone your repo

Fork \`sibling-shipyard/coach-skeleton\` (or use the private repo your operator created), then:

\`\`\`bash
git clone https://github.com/YOUR_USERNAME/coach-YOUR_NAME.git
cd coach-YOUR_NAME
\`\`\`

---

## 2. Add GitHub secrets

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**.

| Secret | Required | Notes |
|---|---|---|
| \`PAT_TOKEN\` | **Yes** | Fine-grained PAT with **Contents: Read and write** and **Workflows: Read and write** on this repo. Lets CI push sync output and coach commits. |
| \`STRAVA_CLIENT_ID\` | No | Only if you sync via Strava (see step 4). |
| \`STRAVA_CLIENT_SECRET\` | No | Same. |
| \`STRAVA_REFRESH_TOKEN\` | No | From \`engine/strava/oauth_reauth.py\` after local auth. |

---

## 3. Install the GitHub App

The shared Coach Phelps dashboard and Claude Code mobile need the **Coach Phelps GitHub App** installed on your repo.

1. Your operator sends you the app install link (or open the shared dashboard and sign in).
2. Install the app on **this repo only** (or all repos if you prefer).
3. Grant the permissions it requests (read repo contents, trigger workflows).

Without the app, local Claude Code still works; the shared dashboard and mobile repo connector will not.

---

## 4. Optional — Strava sync

Skip this if you use the **iOS app** to push activities, or if you want to start coaching before syncing history.

1. Create a Strava API app at [strava.com/settings/api](https://www.strava.com/settings/api) (callback: \`localhost\`).
2. \`cp .env.example .env\` and fill in \`STRAVA_CLIENT_ID\` and \`STRAVA_CLIENT_SECRET\`.
3. \`pip3 install requests\`
4. \`python3 engine/strava/oauth_reauth.py\` — authorize in the browser; tokens save to \`engine/strava/strava_tokens.json\` (git-ignored).
5. Copy \`STRAVA_CLIENT_ID\`, \`STRAVA_CLIENT_SECRET\`, and the refresh token from \`strava_tokens.json\` into repo secrets (step 2).
6. Test locally: \`python3 engine/strava/fetch_strava.py --last 3\`

When \`STRAVA_*\` secrets are set, the **Sync** workflow runs the full Strava pipeline. Without them, it runs \`regenerate_derived.py\` only (iOS / manual history path).

---

## 5. Open Claude Code

**Recommended (local):**
\`\`\`bash
claude
\`\`\`
Run from the repo root. Requires a Claude Pro (or Max/Team/Enterprise) plan.

**Claude.ai:** upload \`SOUL.md\` and \`user_data/coach/state.md\` as attachments.

**Mobile:** Claude app → connect GitHub → Claude Code mode → select this repo.

Coach detects the blank Athlete Profile in \`user_data/coach/state.md\` and runs the First Session intake automatically.

---

## 6. First sync

Trigger the pipeline once so \`gen/\` is populated:

1. **GitHub → Actions → Sync → Run workflow**, or
2. Locally: \`python3 engine/scripts/regenerate_derived.py\` then \`node engine/scripts/build-aggregate.mjs --aggregate\`

After sync, \`gen/quest_log.md\` and \`gen/aggregate.json\` reflect your challenge and any activity history.

---

## Troubleshooting

- **Sync workflow fails:** check \`PAT_TOKEN\` and (if Strava) all three \`STRAVA_*\` secrets.
- **Strava tokens expired:** re-run \`python3 engine/strava/oauth_reauth.py\` and update \`STRAVA_REFRESH_TOKEN\` secret.
- **Coach can't push from mobile:** use **Actions → Apply Coach Patch** with the \`===FILE===\` payload from your session.
`;

const ENV_EXAMPLE = `# Local Strava auth only — CI uses repo secrets (see SETUP.md)
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=
STRAVA_REFRESH_TOKEN=
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

/** Copy engine/<rel> → outDir/engine/<rel>; strip strava_tokens.json from strava/ */
function copyFromEngine(outDir, rel) {
  const src = path.join(ENGINE_DIR, rel);
  const dest = path.join(outDir, "engine", rel);
  if (!fs.existsSync(src)) {
    throw new Error(`Missing engine/${rel}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.statSync(src).isDirectory()) {
    fs.cpSync(src, dest, { recursive: true });
    const tokens = path.join(dest, "strava_tokens.json");
    if (fs.existsSync(tokens)) {
      fs.unlinkSync(tokens);
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

function copyEngineTemplate(outDir, filename) {
  const src = path.join(ENGINE_DIR, "templates", filename);
  const dest = path.join(
    outDir,
    "user_data/activities/workout_plans/templates",
    filename,
  );
  if (!fs.existsSync(src)) {
    throw new Error(`Missing engine/templates/${filename}`);
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
  for (const rel of SKELETON_ENGINE_DIRS) {
    copyFromEngine(outDir, rel);
  }
  copyWorkflows(outDir);

  fs.copyFileSync(path.join(REPO_ROOT, "SOUL.md"), path.join(outDir, "SOUL.md"));

  writeText(outDir, ".coach-engine-version", `hq_sha=${sha}`);
  writeText(outDir, "README.md", SKELETON_README);
  writeText(outDir, "CLAUDE.md", SKELETON_CLAUDE);
  writeText(outDir, "SETUP.md", SETUP_MD);
  writeText(outDir, ".gitignore", SKELETON_GITIGNORE);
  writeText(outDir, ".env.example", ENV_EXAMPLE);

  // user_data — init band
  writeText(outDir, "user_data/coach/state.md", STATE_MD_TEMPLATE);
  writeText(outDir, "user_data/coach/coach_notes.md", COACH_NOTES_TEMPLATE);
  writeText(outDir, "user_data/coach/opponent_notes.md", OPPONENT_NOTES_TEMPLATE);
  writeJson(outDir, "user_data/coach/sleep_log.json", []);
  writeJson(outDir, "user_data/coach/chat_history.json", []);
  writeText(outDir, "user_data/coach/reference/.gitkeep", "");
  writeText(outDir, "user_data/activities/hist/.gitkeep", "");
  writeJson(outDir, "user_data/activities/sync_state.json", SYNC_STATE_TEMPLATE);

  for (const tpl of WORKOUT_TEMPLATES) {
    copyEngineTemplate(outDir, tpl);
  }
  writeText(outDir, "user_data/activities/workout_plans/sessions/.gitkeep", "");

  // user_data — post-init band
  writeJson(outDir, "user_data/ledger/challenge_v2.json", CHALLENGE_V2_TEMPLATE);
  writeJson(outDir, "user_data/ledger/current_week.json", CURRENT_WEEK_TEMPLATE);

  // gen band placeholders
  writeJson(outDir, "gen/aggregate.json", AGGREGATE_PLACEHOLDER);
  writeJson(outDir, "gen/widget_snapshots.json", WIDGET_SNAPSHOTS_PLACEHOLDER);
  writeText(outDir, "gen/quest_log.md", QUEST_LOG_STARTER);
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
