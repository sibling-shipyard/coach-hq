#!/usr/bin/env node
/**
 * compose-soul.mjs — Deterministic assembly of SOUL.md from soul/ layer files.
 *
 * Usage:
 *   node engine/scripts/compose-soul.mjs          # write SOUL.md (HQ)
 *   node scripts/compose-soul.mjs --check         # skeleton / user repo
 *
 * Section markers in soul/*.md:
 *   <!-- soul:section KEY -->
 *   content
 *   <!-- /soul:section -->
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { repoRoot, soulDir } from "../lib/repo-layout.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = repoRoot(__dirname);
const SOUL_DIR = soulDir(REPO_ROOT);
const SOUL_OUT = path.join(REPO_ROOT, "SOUL.md");

const FIXED_HEADER = `# Coach Phelps: SOUL.md
**Version:** v5.7 (hq-adopted reconciliation)
**Last Updated:** 2026-07-26
`;

const LAYER_FILES = {
  A: "A_identity.md",
  B: "B_engine.md",
  C: "C_athlete.md",
};

/** Assembly order: flat keys or { merge, keys, sources } for merged sections. */
const ASSEMBLY = [
  { source: "B", keys: ["s1", "s2"] },
  { source: "A", keys: ["s3", "s4"] },
  {
    merge: "s5",
    keys: ["s5a1", "s5b1", "s5a2", "s5a3", "s5b2", "s5b3", "s5b4", "s5a4"],
    sources: {
      s5a1: "A",
      s5b1: "B",
      s5a2: "A",
      s5a3: "A",
      s5b2: "B",
      s5b3: "B",
      s5b4: "B",
      s5a4: "A",
    },
  },
  {
    merge: "s6",
    keys: ["s6a", "s6b"],
    sources: { s6a: "A", s6b: "B" },
  },
  {
    merge: "s7",
    keys: ["s7", "c_schema", "c_data_locations"],
    sources: { s7: "C", c_schema: "C", c_data_locations: "C" },
  },
  { source: "B", keys: ["s8", "s9", "s10", "s11", "s12"] },
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

function composeSoul() {
  const { byLayer } = loadAllSections();
  const parts = [FIXED_HEADER.trimEnd()];

  for (const step of ASSEMBLY) {
    if (step.keys && !step.merge) {
      for (const key of step.keys) {
        parts.push(getSection(byLayer, step.source, key));
      }
      continue;
    }

    const blocks = step.keys.map((key) => getSection(byLayer, step.sources[key], key));
    parts.push(joinBlocks(blocks));
  }

  return `${parts.join("\n\n")}\n`;
}

function summarizeDiff(expected, actual) {
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

  console.error("SOUL.md drift detected — composed output differs from committed file.");
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

  console.error("  fix: node engine/scripts/compose-soul.mjs");
}

function main() {
  const checkOnly = process.argv.includes("--check");

  let composed;
  try {
    composed = composeSoul();
  } catch (err) {
    console.error(`::error::${err.message}`);
    process.exit(1);
  }

  if (checkOnly) {
    if (!fs.existsSync(SOUL_OUT)) {
      console.error(`::error::${path.relative(REPO_ROOT, SOUL_OUT)} not found`);
      process.exit(1);
    }

    const committed = fs.readFileSync(SOUL_OUT, "utf-8");
    if (committed === composed) {
      console.log("SOUL.md is in sync with soul/ layer files.");
      process.exit(0);
    }

    summarizeDiff(composed, committed);
    process.exit(1);
  }

  fs.writeFileSync(SOUL_OUT, composed, "utf-8");
  console.log(`Wrote ${path.relative(REPO_ROOT, SOUL_OUT)}`);
}

main();
