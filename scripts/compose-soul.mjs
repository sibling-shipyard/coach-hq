#!/usr/bin/env node
/**
 * compose-soul.mjs — regenerate the read-path SOUL.md from the three layer
 * sources (soul/A_identity.md, soul/B_engine.md, soul/C_athlete.md).
 *
 * SOUL.md is a GENERATED artifact. The layer files are the sources of truth.
 * Every reader (a BYO Claude Code boot, ui/api/coach-chat.ts) keeps reading
 * SOUL.md wholesale, so the split does not change the read path — this is the
 * M0 backward-compat guarantee.
 *
 * Output is DETERMINISTIC (no timestamps) so the drift-check is stable.
 *
 * Usage:
 *   node scripts/compose-soul.mjs           # write SOUL.md
 *   node scripts/compose-soul.mjs --check    # exit 1 if SOUL.md is out of date
 *
 * This is an engineering build tool, NOT a coach-runtime primitive — it is not
 * part of Layer B's capability contract.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOUL_DIR = path.join(REPO_ROOT, "soul");
const OUT = path.join(REPO_ROOT, "SOUL.md");
const VERSION = "v6.0"; // major bump: 3-layer split, following the v5.x line (changelog in coach-phelps)

// Compose order: Engine first (boot sequence at the top, matching pre-split
// SOUL.md §1), then Soul (identity/voice), then Athlete (schema/intake).
const LAYERS = [
  { file: "B_engine.md", title: "PART B — ENGINE" },
  { file: "A_identity.md", title: "PART A — SOUL" },
  { file: "C_athlete.md", title: "PART C — ATHLETE" },
];

/** Strip the leading HTML comment block (the source's internal banner). */
function stripLeadingComment(text) {
  return text.replace(/^﻿?\s*<!--[\s\S]*?-->\s*/, "").trimStart();
}

function compose() {
  const header =
    `# Coach Phelps: SOUL.md\n` +
    `<!-- GENERATED FILE — DO NOT EDIT.\n` +
    `     Composed from soul/A_identity.md + soul/B_engine.md + soul/C_athlete.md\n` +
    `     by scripts/compose-soul.mjs. Edit the layer sources, then run:\n` +
    `       node scripts/compose-soul.mjs\n` +
    `     CI (validate-data.yml) enforces SOUL.md == compose(A,B,C). -->\n` +
    `**Version:** ${VERSION}\n` +
    `**Structure:** three separated layers — Engine (B, runtime-agnostic), ` +
    `Soul (A, identity/voice), Athlete (C, per-user data schema).\n`;

  const parts = LAYERS.map(({ file, title }) => {
    const raw = fs.readFileSync(path.join(SOUL_DIR, file), "utf-8");
    return `\n\n---\n\n<!-- ${title} — source: soul/${file} -->\n\n` + stripLeadingComment(raw).trimEnd() + "\n";
  });

  return header + parts.join("");
}

const composed = compose();
const check = process.argv.includes("--check");

if (check) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf-8") : "";
  if (current !== composed) {
    console.error(
      "::error::SOUL.md is out of date with soul/*.md. Run `node scripts/compose-soul.mjs` and commit."
    );
    process.exit(1);
  }
  console.log("SOUL.md is in sync with the layer sources.");
} else {
  fs.writeFileSync(OUT, composed);
  console.log(`Wrote ${path.relative(REPO_ROOT, OUT)} (${composed.length} bytes) from ${LAYERS.length} layers.`);
}
