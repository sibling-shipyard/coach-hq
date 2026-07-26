#!/usr/bin/env node
/**
 * carve-skeleton.mjs — Build coach-skeleton tree from HQ at a pinned SHA.
 *
 * Copies allowlisted engine paths (see docs/m1-plan.md § path map), applies skeleton
 * transforms, runs compose-soul.mjs, and optionally pushes to sibling-shipyard/coach-skeleton.
 *
 * Usage:
 *   node scripts/carve-skeleton.mjs --dry-run [--out-dir ./skeleton-out] [--sha <git-sha>]
 *   node scripts/carve-skeleton.mjs --push [--sha <git-sha>]
 */
import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SKELETON_REPO = "sibling-shipyard/coach-skeleton";

const COPY_FILES = [
  "soul/A_identity.md",
  "soul/B_engine.md",
  "soul/C_athlete.md",
  "scripts/compose-soul.mjs",
  "scripts/generate_quest_log.py",
  "scripts/generate_quest_history.py",
  "scripts/parse_match_description.py",
  "scripts/run_sync_pipeline.py",
  "scripts/build-aggregate.mjs",
  "skills/pipeline-tools.md",
  "AGENTS.md",
  "CLAUDE.md",
  ".github/CONVENTIONS.md",
  "VALIDATION_TESTS.md",
  "HOW_IT_WORKS.md",
  ".env.example",
];

const COPY_DIRS = [
  "strava",
  "core",
  "plugins/badminton",
  "templates",
  ".github/agents",
];

const COPY_WORKFLOWS = [
  "validate-data.yml",
  "validate-soul.yml",
  "apply-coach-patch.yml",
];

const BOOT_DOCS = [
  "docs/current-week-contract.md",
  "docs/milestone-schema.md",
  "docs/activity-enrichment-guide.md",
  "docs/athlete-protein-reference.md",
  "docs/badminton-roster.md",
  "docs/visualization-audio-guide.md",
  "docs/phelps-voice-profile.md",
  "docs/phelps-research-notes.md",
  "docs/soul-calibration.md",
  "docs/timer-state-machine.md",
  "docs/ios-app-spec.md",
  "docs/ios-xcode-setup.md",
];

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

Forkable starter for a private \`coach-<user>\` repo. Carved from \`coach-phelps-hq\` at a pinned engine SHA (see \`.coach-engine-version\`).

- **Dashboard:** shared site reads \`data/aggregate.json\` from your repo after sync.
- **BYO Claude:** boot reads \`SOUL.md\` + \`training/coach/state.md\`.
- **Sync:** GitHub Actions \`sync.yml\` — set repo variable \`SYNC_SOURCE\` to \`ios\` or \`strava\`.

Operator onboarding: see \`coach-phelps-hq\` \`docs/m1-plan.md\` and \`scripts/provision-user.sh\` (M1b).
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

function adaptAgentsMd(content) {
  return content
    .replace(
      "AI coaching system for the athlete — data, training pipeline, Strava sync, and UI in a single monorepo.",
      "AI coaching system for your athlete data — training pipeline, Strava or iOS sync, and BYO Claude boot in this repo.",
    )
    .replace(
      "**Watch-out:** this repo contains a large `ui/` React app, and the remote/web harness frames\n" +
        "every session as a generic engineer (\"complete the task, make changes, commit, push\"). Neither\n" +
        "the big codebase nor that framing makes you an engineer by default — that gravity is exactly\n" +
        "what mis-routes a \"Hi Coach\" session into code/PR triage. **Default to Coach Phelps** unless\n" +
        "the athlete's words clearly point to another role; if the signals genuinely conflict, ask before acting.",
      "**Watch-out:** remote harnesses may frame every session as a generic engineer. **Default to Coach Phelps** unless the athlete's words clearly point to another role.",
    )
    .replace("- `ui/` — React + Vite frontend\n", "")
    .replace("- `ios/` — native Swift/SwiftUI app (HealthKit sync), builds locally in Xcode, no CI deploy\n", "")
    .replace(
      "- **UI data files:** All files in `ui/client/src/data/` are managed exclusively by the sync\n" +
        "pipeline — do not manually edit them. `challenge_v2.json` in `ui/client/src/data/` is updated\n" +
        "on sync, not during coach sessions.\n\n",
      "- **Aggregate contract:** `data/aggregate.json` is generated by sync — do not hand-edit.\n\n",
    )
    .replace(
      "Do not copy `challenge_v2.json` to `ui/client/src/data/` manually — the sync pipeline handles that.",
      "Dashboard reads `data/aggregate.json` from this repo via the shared hosted site.",
    );
}

function adaptHowItWorks(content) {
  return content.replace(
    /For setup, see \[SETUP\.md\]\(SETUP\.md\)[^\n]*\n/g,
    "For setup, install the GitHub App on this repo and use the shared Coach Phelps site.\n",
  );
}

function carve(outDir, sha) {
  console.log(`Carving skeleton → ${outDir}`);
  console.log(`Pinned HQ SHA: ${sha}`);

  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outDir, { recursive: true });

  for (const rel of COPY_FILES) {
    copyFile(rel, outDir);
  }
  for (const rel of COPY_DIRS) {
    copyDir(rel, outDir);
  }
  for (const rel of BOOT_DOCS) {
    copyFile(rel, outDir);
  }
  for (const wf of COPY_WORKFLOWS) {
    copyFile(path.join(".github/workflows", wf), outDir);
  }

  copyFile("scripts/templates/sync.yml", outDir);
  fs.renameSync(
    path.join(outDir, "scripts/templates/sync.yml"),
    path.join(outDir, ".github/workflows/sync.yml"),
  );
  fs.rmSync(path.join(outDir, "scripts/templates"), { recursive: true, force: true });

  writeText(outDir, ".coach-engine-version", `hq_sha=${sha}`);
  writeText(outDir, "README.md", SKELETON_README);
  writeText(outDir, ".gitignore", SKELETON_GITIGNORE);
  writeText(outDir, "training/coach/state.md", STATE_MD_TEMPLATE);
  writeText(outDir, "training/coach/coach_notes.md", COACH_NOTES_TEMPLATE);
  writeText(outDir, "training/coach/opponent_notes.md", OPPONENT_NOTES_TEMPLATE);
  writeJson(outDir, "training/ledger/challenge_v2.json", CHALLENGE_V2_TEMPLATE);
  writeJson(outDir, "training/ledger/current_week.json", CURRENT_WEEK_TEMPLATE);
  writeJson(outDir, "training/activities/sleep_log.json", []);
  writeJson(outDir, "training/sync_state.json", SYNC_STATE_TEMPLATE);
  writeJson(outDir, "training/sync_status.json", SYNC_STATUS_TEMPLATE);
  writeJson(outDir, "training/widget_snapshots.json", WIDGET_SNAPSHOTS_PLACEHOLDER);
  writeJson(outDir, "plugins/badminton/data/badminton_match_data.json", []);
  writeText(outDir, "training/activities/history/.gitkeep", "");
  writeText(outDir, "sessions/.gitkeep", "");

  const agentsPath = path.join(outDir, "AGENTS.md");
  fs.writeFileSync(agentsPath, adaptAgentsMd(fs.readFileSync(agentsPath, "utf-8")));

  const howPath = path.join(outDir, "HOW_IT_WORKS.md");
  fs.writeFileSync(howPath, adaptHowItWorks(fs.readFileSync(howPath, "utf-8")));

  const compose = spawnSync("node", ["scripts/compose-soul.mjs"], {
    cwd: outDir,
    encoding: "utf-8",
  });
  if (compose.status !== 0) {
    console.error(compose.stderr || compose.stdout);
    throw new Error("compose-soul.mjs failed in skeleton output");
  }

  const check = spawnSync("node", ["scripts/compose-soul.mjs", "--check"], {
    cwd: outDir,
    encoding: "utf-8",
  });
  if (check.status !== 0) {
    console.error(check.stderr || check.stdout);
    throw new Error("SOUL.md drift check failed after compose");
  }

  console.log("✓ Skeleton tree carved and SOUL composed");
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
