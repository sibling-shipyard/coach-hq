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
    keys: ["s5a1", "s5b1", "s5a2", "s5a3", "s5b3_closing_archives", "s5b4", "s5a4"],
    sources: {
      s5a1: "A",
      s5b1: "B",
      s5a2: "A",
      s5a3: "A",
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
      "s10_first_session_head",
      "s10_first_session_trigger",
      "s10_first_session_pull",
      "s10_first_session_body",
      "s10_first_session_commit",
      "s10_first_session_transition",
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
      "s10_badminton_guardrail",
      "s10_badminton_pointer",
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
      // First Session is ~50 lines the chat build only needs on a brand-new athlete's first
      // conversation, so it is injected per-turn instead (see HORCRUXES below) rather than
      // riding in the cached prefix forever. The claude build keeps it inline — BYOB has no
      // injection seam. `_trigger` describes boot detection, `_pull` and `_commit` need a
      // shell, so those three stay claude-only even in the horcrux.
      s10_first_session_head: CLAUDE_ONLY,
      s10_first_session_trigger: CLAUDE_ONLY,
      s10_first_session_pull: CLAUDE_ONLY,
      s10_first_session_body: CLAUDE_ONLY,
      s10_first_session_commit: CLAUDE_ONLY,
      s10_first_session_transition: CLAUDE_ONLY,
      // The file map, score format and taxonomy rules moved to an on-demand doc; the gate and
      // its pointer are BYOB-only because the app can read neither. The one-line "never invent
      // games from HR" guardrail stays in both — chat sees badminton activities too.
      s10_badminton_pointer: CLAUDE_ONLY,
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
      s12_checklist_shell: CLAUDE_ONLY,
      s12_commit_push: CLAUDE_ONLY,
      s12_interim_rollback: CLAUDE_ONLY,
    },
  },
];

/**
 * Fragments: blocks that ship to a runtime *conditionally*, not as part of a composed build.
 *
 * They exist because the chat runtime pays for its whole prompt on every turn, and the cached
 * prefix is hashed (soulCache.ts) — so a block only one athlete in a hundred needs is pure cost
 * for everyone else, and putting it in the prefix per-athlete would fork the cache. A horcrux is
 * emitted as its own file, bundled by ui/scripts/build-soul.mjs, and injected into the *dynamic*
 * half of the prompt (buildDynamicText's extraContext) when the backend's predicate says so.
 *
 * A horcrux is not a third target: TARGETS stays ["chat","claude"] so validate-soul's mirrored
 * list keeps matching. The claude build carries these blocks inline as usual — BYOB has no
 * injection seam and no per-turn cost.
 */
const HORCRUXES = [
  {
    // Injected when isAthleteProfileComplete(state.md) is false — coach-chat.ts.
    out: "first-session.md",
    source: "B",
    keys: ["s10_first_session_head", "s10_first_session_body", "s10_first_session_transition"],
  },
];

const HORCRUX_DIR = path.join(REPO_ROOT, "platform", "horcruxes");

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

const LIST_ITEM_RE = /^\s*(?:\d+\.|[-*+])\s/;
const CONTINUATION_RE = /^\s+\S/;

/**
 * True when `block` ends mid-list — either on a list item or on an indented
 * continuation line belonging to one.
 */
function endsInsideList(block) {
  const lines = block.split("\n");
  const last = lines[lines.length - 1];
  if (LIST_ITEM_RE.test(last)) return true;
  return CONTINUATION_RE.test(last) && lines.some((line) => LIST_ITEM_RE.test(line));
}

/**
 * Blocks are normally separated by a blank line, but a target seam can fall *inside* a
 * list — §10's "Logging a Workout" steps and §12's checklist are each split across several
 * keys so the shell-only ones can be claude-only. Joining those with "\n\n" would punch a
 * blank line into the middle of a list that reads as one list in the source layer, so a
 * seam between two list items closes up to a single newline.
 */
function joinBlocks(blocks) {
  const kept = blocks.filter(Boolean);
  if (kept.length === 0) return "";
  return kept.reduce((acc, block) => {
    const glue = LIST_ITEM_RE.test(block.split("\n")[0]) && endsInsideList(acc) ? "\n" : "\n\n";
    return acc + glue + block;
  });
}

/**
 * Renumber ordered lists per target. Dropping claude-only steps out of the chat build leaves
 * holes in the source layer's hand-written numbering ("1. … 4. … 6."), and a model reading
 * step 4 with no step 2 above it is being told instructions are missing. A run ends at the
 * first line that is neither a list item nor an indented continuation — including a blank
 * line, which after joinBlocks() no longer appears inside a list. Fenced code is skipped so
 * a future SOUL edit can show a numbered sample without it being silently rewritten.
 */
function renumberOrderedLists(text) {
  let counter = 0;
  let inFence = false;
  return text
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        counter = 0;
        return line;
      }
      if (inFence) return line;
      const match = /^(\d+)\.(\s)/.exec(line);
      if (match) {
        counter += 1;
        return `${counter}.${match[2]}${line.slice(match[0].length)}`;
      }
      if (line.trim() === "" || CONTINUATION_RE.test(line)) return line;
      counter = 0;
      return line;
    })
    .join("\n");
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

  return `${renumberOrderedLists(joinBlocks(parts))}\n`;
}

function composeHorcrux(horcrux) {
  const { byLayer } = loadAllSections();
  const blocks = horcrux.keys.map((key) => getSection(byLayer, horcrux.source, key));
  return `${renumberOrderedLists(joinBlocks(blocks))}\n`;
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
    builds = [
      ...TARGETS.map((target) => ({
        outPath: soulFilePath(REPO_ROOT, target),
        composed: composeSoul(target),
      })),
      ...HORCRUXES.map((horcrux) => ({
        outPath: path.join(HORCRUX_DIR, horcrux.out),
        composed: composeHorcrux(horcrux),
      })),
    ];
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
