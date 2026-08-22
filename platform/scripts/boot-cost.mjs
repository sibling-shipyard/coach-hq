#!/usr/bin/env node
/**
 * boot-cost.mjs — what each agent role pays to boot, in bytes and estimated tokens.
 *
 * Every session starts by reading a fixed set of docs (each role doc's "Boot Sequence"), and
 * that cost is paid on every cold start, by every agent, forever. It is invisible until someone
 * measures it — a doc that doubles in size never announces itself. This prints the bill so a PR
 * that moves the number can show the before/after (`--json` diffs cleanly in a PR body).
 *
 * The lists below are transcribed from the role docs, not derived from them: the docs name their
 * boot files in prose, and a parser for that prose would be more fragile than the transcription.
 * Requirement 3 is the guard — a renamed boot file fails the run rather than silently dropping
 * out of the total.
 *
 * Usage:
 *   node platform/scripts/boot-cost.mjs
 *   node platform/scripts/boot-cost.mjs --json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { repoRoot } from "../../engine/lib/repo-layout.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = repoRoot(__dirname);

/**
 * An entry is a bare path (unconditional) or `{ path, conditional: true }` — conditional means
 * the role doc reads it only in some situations, so it is shown on its own line but kept out of
 * the cold-boot total. Conditional entries today: Tech Lead's SOUL (unused on UI, CI, infra,
 * and PR-triage work) and iOS Builder's spec + DESIGN (architecture/sync vs View work).
 */
const ROLES = [
  {
    name: "Tech Lead",
    files: [
      "AGENTS.md",
      ".github/agents/tech-lead.md",
      "kdb/decisions/README.md",
      { path: "platform/SOUL.claude.md", conditional: true },
    ],
  },
  {
    name: "Bob the Builder",
    files: ["AGENTS.md", ".github/agents/bob-the-builder.md", "kdb/decisions/README.md"],
  },
  {
    name: "UI Expert",
    files: ["AGENTS.md", ".github/agents/ui-expert.md", "kdb/decisions/README.md"],
  },
  {
    name: "iOS Builder",
    files: [
      "AGENTS.md",
      ".github/agents/ios-builder.md",
      "kdb/decisions/README.md",
      { path: "docs/eng-docs/ios-app-spec.md", conditional: true },
      { path: "ios/DESIGN.md", conditional: true },
    ],
  },
];

/** Deliberately crude: no tokenizer is installed, and boot cost is a trend, not an invoice. */
const estimateTokens = (bytes) => Math.round(bytes / 4);

function measure(rawEntry) {
  const entry = typeof rawEntry === "string" ? { path: rawEntry } : rawEntry;
  const abs = path.join(REPO_ROOT, entry.path);
  const conditional = entry.conditional === true;
  if (!fs.existsSync(abs)) {
    return { path: entry.path, conditional, missing: true, bytes: 0, tokens: 0 };
  }
  const bytes = fs.statSync(abs).size;
  return { path: entry.path, conditional, missing: false, bytes, tokens: estimateTokens(bytes) };
}

function measureRole(role) {
  const files = role.files.map(measure);
  const counted = files.filter((f) => !f.conditional);
  return {
    role: role.name,
    files,
    bytes: counted.reduce((sum, f) => sum + f.bytes, 0),
    tokens: counted.reduce((sum, f) => sum + f.tokens, 0),
    missing: files.filter((f) => f.missing).map((f) => f.path),
  };
}

const num = (n, width) => String(n).padStart(width);

function printTable(results) {
  console.log("boot-cost — declared boot set per agent role");
  console.log("Tokens are a bytes/4 ESTIMATE, not a tokenizer count. Do not quote them as exact.");
  console.log("Conditional files are shown but excluded from the role total.");

  for (const result of results) {
    console.log(`\n${result.role}`);
    console.log(`  ${"bytes".padStart(8)}  ${"tokens".padStart(7)}  file`);
    for (const f of result.files) {
      const bytes = f.missing ? "MISSING".padStart(8) : num(f.bytes, 8);
      const tag = f.conditional ? " (conditional)" : "";
      console.log(`  ${bytes}  ${num(f.tokens, 7)}  ${f.path}${tag}`);
    }
    console.log(`  ${"-".repeat(8)}  ${"-".repeat(7)}  ${"-".repeat(40)}`);
    console.log(`  ${num(result.bytes, 8)}  ${num(result.tokens, 7)}  TOTAL`);
  }

  const sorted = [...results].sort((a, b) => b.bytes - a.bytes);
  const width = Math.max(...sorted.map((r) => r.role.length));
  console.log("\nSummary — cold boot cost, heaviest first");
  console.log(`  ${"role".padEnd(width)}  ${"bytes".padStart(8)}  ${"tokens".padStart(7)}`);
  console.log(`  ${"-".repeat(width)}  ${"-".repeat(8)}  ${"-".repeat(7)}`);
  for (const r of sorted) {
    console.log(`  ${r.role.padEnd(width)}  ${num(r.bytes, 8)}  ${num(r.tokens, 7)}`);
  }
}

function main() {
  const asJson = process.argv.includes("--json");
  const results = ROLES.map(measureRole);
  const missing = results.flatMap((r) => r.missing);

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          estimate: "tokens = bytes / 4, rounded — not a tokenizer count",
          generated_at: new Date().toISOString().slice(0, 10),
          roles: results,
        },
        null,
        2,
      ),
    );
  } else {
    printTable(results);
  }

  if (missing.length > 0) {
    // Plain message, not a `::error::` annotation: nothing runs this in GitHub Actions today,
    // and the annotation prefix is literal noise in the terminal where it actually gets read.
    console.error(
      `boot-cost: ${missing.length} declared boot file(s) missing — a role doc's boot ` +
        `set has drifted: ${missing.join(", ")}`,
    );
    process.exit(1);
  }
  process.exit(0);
}

main();
