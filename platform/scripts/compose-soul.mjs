#!/usr/bin/env node
/**
 * compose-soul.mjs — Deterministic assembly of the composed SOUL builds from soul/ layer files.
 *
 * One source, two targets (ADR 0022):
 *   chat   → platform/SOUL.chat.md    bundled into coach-chat by ui/scripts/build-soul.mjs
 *   claude → platform/SOUL.claude.md  carved into athlete repos for BYO Claude Code
 *
 * The bare `platform/SOUL.md` name is retired so neither runtime silently owns it.
 *
 * Usage:
 *   node platform/scripts/compose-soul.mjs          # write both targets (HQ)
 *   node platform/scripts/compose-soul.mjs --check  # assert both are in sync
 *
 * Section markers in soul/*.md:
 *   <!-- soul:section KEY -->
 *   content
 *   <!-- /soul:section -->
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { repoRoot, soulDir, soulFilePath } from "../../engine/lib/repo-layout.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = repoRoot(__dirname);
const SOUL_DIR = soulDir(REPO_ROOT);

/**
 * Build targets, in emit order. `claude` is a legacy target with an end date (ADR 0022).
 * Deliberately not exported: this module runs `main()` on import, so importing it to read this
 * would compose and exit. validate-soul.mjs mirrors the list instead, and says why.
 */
const TARGETS = ["chat", "claude"];

const FIXED_HEADER = `# Coach Phelps: SOUL.md
`;

const LAYER_FILES = {
  A: "A_identity.md",
  B: "B_engine.md",
  C: "C_athlete.md",
};

/**
 * Assembly order: flat keys or { merge, keys, sources } for merged sections.
 *
 * Targeting (ADR 0022): a step may carry `targets: [...]`, and a merge step may additionally
 * carry `keyTargets: { <key>: [...] }` to override individual keys. Absent = emitted into every
 * target. PR 3 of the v5.8 trim is where targeting starts doing work: every block below marked
 * CLAUDE_ONLY needs a shell, git, or a file read, none of which coach-chat has — its own system
 * prompt tells the model to ignore instructions it cannot execute, so those blocks were pure cost
 * in the chat build. The two composed builds are legitimately different files from here on; they
 * are no longer expected to `diff` clean against each other.
 */
const CLAUDE_ONLY = ["claude"];

const ASSEMBLY = [
  // §1 Boot Sequence — chat is told to skip booting entirely.
  { source: "B", keys: ["s1_boot"], targets: CLAUDE_ONLY },
  {
    source: "B",
    keys: ["s2_guardrails", "s2_guardrails_git"],
    keyTargets: { s2_guardrails_git: CLAUDE_ONLY },
  },
  { source: "A", keys: ["s3", "s4"] },
  {
    merge: "s5",
    keys: ["s5a1", "s5b1", "s5a2", "s5a3", "s5b2", "s5b3_closing_archives", "s5b4", "s5a4"],
    sources: {
      s5a1: "A",
      s5b1: "B",
      s5a2: "A",
      s5a3: "A",
      s5b2: "B",
      s5b3_closing_archives: "B",
      s5b4: "B",
      s5a4: "A",
    },
    // Phase/season close write `archive/phases.md` and `archive/seasons/**`; the app drops both.
    keyTargets: { s5b3_closing_archives: CLAUDE_ONLY },
  },
  {
    merge: "s6",
    keys: ["s6a", "s6b"],
    sources: { s6a: "A", s6b: "B" },
  },
  {
    merge: "s7",
    keys: ["s7", "c_data_locations"],
    sources: { s7: "C", c_data_locations: "C" },
  },
  {
    source: "B",
    keys: [
      "s8",
      "s9",
      "s10_head",
      "s10_first_session",
      "s10_greeting",
      "s10_pre_workout",
      "s10_weekly_kickoff",
      "s10_contract_safety",
      "s10_contract_validator",
      "s10_session_files",
      "s10_timer_fields",
      "s10_logging_intro",
      "s10_logging_lookup",
      "s10_logging_rpe",
      "s10_logging_notes",
      "s10_logging_reconcile",
      "s10_logging_autoname",
      "s10_end_of_day",
      "s10_daily_checkin",
      "s10_sunday_intro",
      "s10_sunday_archive",
      "s10_sunday_rest",
      "s10_exercise_explainer",
      "s10_badminton",
      "s11",
      "s12_head",
      "s12_updates",
      "s12_coach_notes",
      "s12_checklist",
      "s12_checklist_shell",
      "s12_commit_push",
      "s12_confirm",
      "s12_interim_rollback",
    ],
    keyTargets: {
      // The backend injects its own, longer greeting instruction on every turn.
      s10_greeting: CLAUDE_ONLY,
      // Shell validator + `git diff`.
      s10_contract_validator: CLAUDE_ONLY,
      // query_history.py lookups and a write into user_data/activities/hist/.
      s10_logging_lookup: CLAUDE_ONLY,
      s10_logging_notes: CLAUDE_ONLY,
      s10_logging_autoname: CLAUDE_ONLY,
      // Close detection in chat is deterministic (closeSignal.ts), not modelled here.
      s10_end_of_day: CLAUDE_ONLY,
      // archive/week_plans.md write.
      s10_sunday_archive: CLAUDE_ONLY,
      // §11 is script tables end to end.
      s11: CLAUDE_ONLY,
      // The app has its own coach_note mechanism; the file path is BYOB-only.
      s12_coach_notes: CLAUDE_ONLY,
      s12_checklist_shell: CLAUDE_ONLY,
      s12_commit_push: CLAUDE_ONLY,
      s12_interim_rollback: CLAUDE_ONLY,
    },
  },
];

const SECTION_MARKER_RE =
  /<!--\s*soul:section\s+(\S+)\s*-->\n([\s\S]*?)<!--\s*\/soul:section\s*-->/g;
const LAYER_HEADER_RE = /^# Layer [ABC] —[^\n]*\n?/;

function stripLayerHeader(content) {
  return content.replace(LAYER_HEADER_RE, "");
}

function parseSections(content, fileLabel) {
  const sections = new Map();
  const body = stripLayerHeader(content);
  let match;

  SECTION_MARKER_RE.lastIndex = 0;
  while ((match = SECTION_MARKER_RE.exec(body)) !== null) {
    const key = match[1];
    const value = match[2].replace(/\n+$/, "");
    if (sections.has(key)) {
      throw new Error(`${fileLabel}: duplicate section key "${key}"`);
    }
    sections.set(key, value);
  }

  return sections;
}

function loadLayerSections(layer) {
  const filename = LAYER_FILES[layer];
  const filePath = path.join(SOUL_DIR, filename);

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Missing ${path.relative(REPO_ROOT, filePath)} — soul split files not present yet`,
    );
  }

  const content = fs.readFileSync(filePath, "utf-8");
  return parseSections(content, filename);
}

function loadAllSections() {
  const byLayer = {
    A: loadLayerSections("A"),
    B: loadLayerSections("B"),
    C: loadLayerSections("C"),
  };

  const flat = new Map();
  for (const [layer, sections] of Object.entries(byLayer)) {
    for (const [key, value] of sections) {
      if (flat.has(key)) {
        throw new Error(`Duplicate section key "${key}" across soul/ layer files`);
      }
      flat.set(key, value);
    }
  }

  return { byLayer, flat };
}

function getSection(byLayer, layer, key) {
  const sections = byLayer[layer];
  if (!sections.has(key)) {
    throw new Error(
      `Missing section "${key}" in soul/${LAYER_FILES[layer]} (required for compose)`,
    );
  }
  return sections.get(key);
}

function joinBlocks(blocks) {
  return blocks.filter(Boolean).join("\n\n");
}

/** Which targets a key inside a step is emitted into: key override → step → all. */
function targetsForKey(step, key) {
  return step.keyTargets?.[key] ?? step.targets ?? TARGETS;
}

function assertKnownTargets() {
  for (const step of ASSEMBLY) {
    const declared = [step.targets ?? [], ...Object.values(step.keyTargets ?? {})].flat();
    for (const target of declared) {
      if (!TARGETS.includes(target)) {
        throw new Error(`Unknown target "${target}" in ASSEMBLY (known: ${TARGETS.join(", ")})`);
      }
    }
  }
}

function composeSoul(target) {
  const { byLayer } = loadAllSections();
  const parts = [FIXED_HEADER.trimEnd()];

  for (const step of ASSEMBLY) {
    const keys = step.keys.filter((key) => targetsForKey(step, key).includes(target));
    if (keys.length === 0) continue;

    if (!step.merge) {
      for (const key of keys) {
        parts.push(getSection(byLayer, step.source, key));
      }
      continue;
    }

    parts.push(joinBlocks(keys.map((key) => getSection(byLayer, step.sources[key], key))));
  }

  return `${parts.filter(Boolean).join("\n\n")}\n`;
}

function summarizeDiff(relPath, expected, actual) {
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");
  const max = Math.max(expectedLines.length, actualLines.length);
  const diffs = [];

  for (let i = 0; i < max; i++) {
    const e = expectedLines[i];
    const a = actualLines[i];
    if (e !== a) {
      diffs.push({ line: i + 1, expected: e ?? "<EOF>", actual: a ?? "<EOF>" });
    }
  }

  console.error(`${relPath} drift detected — composed output differs from committed file.`);
  console.error(
    `  lines: expected ${expectedLines.length}, actual ${actualLines.length}, differing ${diffs.length}`,
  );

  const preview = diffs.slice(0, 8);
  if (preview.length > 0) {
    console.error("  first differences:");
    for (const { line, expected: e, actual: a } of preview) {
      console.error(`    L${line}:`);
      console.error(`      - ${JSON.stringify(e)}`);
      console.error(`      + ${JSON.stringify(a)}`);
    }
    if (diffs.length > preview.length) {
      console.error(`    … and ${diffs.length - preview.length} more line(s)`);
    }
  }

  console.error("  fix: node platform/scripts/compose-soul.mjs");
}

function main() {
  const checkOnly = process.argv.includes("--check");

  let builds;
  try {
    assertKnownTargets();
    builds = TARGETS.map((target) => ({
      target,
      outPath: soulFilePath(REPO_ROOT, target),
      composed: composeSoul(target),
    }));
  } catch (err) {
    console.error(`::error::${err.message}`);
    process.exit(1);
  }

  let failed = false;

  for (const { outPath, composed } of builds) {
    const relPath = path.relative(REPO_ROOT, outPath);

    if (checkOnly) {
      if (!fs.existsSync(outPath)) {
        console.error(`::error::${relPath} not found`);
        failed = true;
        continue;
      }
      const committed = fs.readFileSync(outPath, "utf-8");
      if (committed === composed) {
        console.log(`${relPath} is in sync with soul/ layer files.`);
        continue;
      }
      summarizeDiff(relPath, composed, committed);
      failed = true;
      continue;
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, composed, "utf-8");
    console.log(`Wrote ${relPath} (${composed.split("\n").length - 1} lines)`);
  }

  process.exit(failed ? 1 : 0);
}

main();
