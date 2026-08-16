#!/usr/bin/env node
/**
 * validate-soul.mjs — lint the composed SOUL builds against reality (issue #366).
 *
 * `compose-soul.mjs --check` catches drift between the soul/ layers and the composed artifacts.
 * This is the same idea one level up: drift between what SOUL *says* and what the repo, the
 * carve, and the runtimes actually provide. Every rot the v5.7 audit found by hand was
 * mechanically detectable; these are those detections.
 *
 * Runs per target (ADR 0022) against platform/SOUL.<target>.md:
 *   1. paths-exist   — every file path SOUL mentions is carved or a known generated path
 *   2. writable      — every path SOUL tells Coach to *write* is in that build's writable set
 *   3. propagated    — every propagated/docs/ reference is actually carved
 *   4. templates     — template names match platform/skeleton-templates/ + the carve's set
 *   5. xrefs         — section cross-references resolve (§10, "situation 10 in §6", "§1 step 7")
 *
 * Ground truth, not a hand-maintained list: checks 1/3/4 carve a real skeleton into a temp dir
 * (`carve-skeleton.mjs --dry-run --out-dir`) and inventory it. A hardcoded path list would rot
 * exactly the way the things this linter exists to catch rotted.
 *
 * Findings are compared against platform/validate-soul-baseline.json — today's known failures.
 * Exit is non-zero only on *new* findings, so PRs 2–4 of the v5.8 trim burn the baseline down
 * and CI flips this step to blocking when it reaches zero. Never weaken a check to shrink the
 * baseline: a linter tuned until it passes looks like coverage and isn't.
 *
 * Usage:
 *   node platform/scripts/validate-soul.mjs                  # lint both targets
 *   node platform/scripts/validate-soul.mjs --target chat    # one target
 *   node platform/scripts/validate-soul.mjs --update-baseline
 *   node platform/scripts/validate-soul.mjs --keep-skeleton  # leave the carved temp dir in place
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { repoRoot, soulFilePath } from "../../engine/lib/repo-layout.mjs";

/**
 * Build targets (ADR 0022). Mirrors compose-soul.mjs's `TARGETS`, not imported from it —
 * that module runs `main()` on import, which would compose and exit.
 */
const TARGETS = ["chat", "claude"];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = repoRoot(__dirname);
const BASELINE_PATH = path.join(REPO_ROOT, "platform", "validate-soul-baseline.json");
const CARVE_SCRIPT = path.join(REPO_ROOT, "platform", "scripts", "carve-skeleton.mjs");
const TEMPLATE_SRC_DIR = path.join(REPO_ROOT, "platform", "skeleton-templates");
const COACH_WRITES_TS = path.join(
  REPO_ROOT,
  "ui/api/coach-chat/_lib/coachWrites.ts",
);

const CHECKS = {
  PATHS: "paths-exist",
  WRITABLE: "writable",
  PROPAGATED: "propagated-docs",
  TEMPLATES: "templates",
  XREFS: "xrefs",
};

/**
 * Paths that legitimately don't exist in a fresh carve because something creates them later.
 * Each entry names its producer — an allowlist without a producer is how a real finding gets
 * quietly excused, so don't add one you can't cite.
 */
const KNOWN_GENERATED = [
  // Sync pipeline (engine/scripts/regenerate_derived.py, iOS commit) fills the carved hist/ dir.
  "user_data/activities/hist/*.json",
  // Coach writes session snapshots into the carved sessions/ dir (SOUL §10).
  "user_data/activities/workout_plans/sessions/*",
  // Coach writes at season close; engine/scripts/generate_quest_history.py globs
  // seasons_dir()/*/challenge_v2.json (engine/lib/repo_layout.py:146).
  "user_data/coach/archive/seasons/**",
  // Athlete-supplied reference material; the carve ships the dir with a .gitkeep for it.
  "user_data/coach/reference/*",
];

/** Top-level dirs a path token must start with to be treated as a repo path at all. */
const PATH_ROOTS = [
  "user_data",
  "gen",
  "engine",
  "propagated",
  "platform",
  "soul",
  "ui",
  "ios",
  "docs",
  "kdb",
  ".github",
];

const PATH_RE = new RegExp(
  `(?:\\./)?(?:${PATH_ROOTS.map((r) => r.replace(".", "\\.")).join("|")})/[A-Za-z0-9_@./*<>-]+`,
  "g",
);

/**
 * Check 2's heuristic: a path is "written" when a write verb appears on the same line.
 * Deliberately simple and biased toward reporting — a false positive costs one baseline entry,
 * a false negative is the class of bug this linter exists to catch. Negations are the one
 * exception ("Never edit `gen/quest_log.md`"): a verb preceded by not/never/don't within ~40
 * chars doesn't count as an instruction to write.
 */
const WRITE_VERB_RE =
  /\b(write|writes|writing|written|append|appends|appended|appending|update|updates|updated|updating|save|saves|saved|saving|commit|commits|committed|committing|edit|edits|edited|editing|populate|populates|populated|log to|logs to|add to)\b/gi;
const NEGATION_RE = /\b(not|never|no|n't|nor|without|avoid)\b/i;

// ---------------------------------------------------------------------------
// ground truth
// ---------------------------------------------------------------------------

function carveSkeleton(keep) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "validate-soul-skeleton-"));
  execFileSync("node", [CARVE_SCRIPT, "--dry-run", "--out-dir", outDir], {
    cwd: REPO_ROOT,
    stdio: "pipe",
  });
  if (keep) console.log(`carved skeleton kept at ${outDir}`);
  return outDir;
}

function inventory(root) {
  const files = new Set();
  const dirs = new Set();

  const walk = (abs, rel) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        dirs.add(childRel);
        walk(path.join(abs, entry.name), childRel);
      } else {
        files.add(childRel);
      }
    }
  };

  walk(root, "");
  return { files, dirs };
}

function loadChatWritableSet() {
  const src = fs.readFileSync(COACH_WRITES_TS, "utf-8");
  const paths = [...src.matchAll(/export const [A-Z0-9_]+_PATH\s*=\s*"([^"]+)"/g)].map(
    (m) => m[1],
  );
  if (paths.length === 0) {
    throw new Error(
      `No *_PATH exports found in ${path.relative(REPO_ROOT, COACH_WRITES_TS)} — ` +
        "coach-chat's writable set moved; fix this reader rather than linting against nothing.",
    );
  }
  return paths;
}

/** BYOB's writable set is SOUL's own §2 guardrail bullet — parsed, not duplicated here. */
function parseClaudeWritableSet(soul) {
  const bullet = soul
    .split("\n")
    .find((line) => line.includes("**Your files, your push.**"));
  if (!bullet) {
    throw new Error(
      "SOUL §2: could not find the 'Your files, your push.' guardrail bullet — " +
        "the BYOB writable set is parsed from it; update this parser if §2 was restructured.",
    );
  }
  const paths = [...bullet.matchAll(/`([^`]+)`/g)]
    .map((m) => m[1])
    .filter((token) => token.includes("/"));
  if (paths.length === 0) {
    throw new Error("SOUL §2 guardrail bullet lists no paths — writable set would be empty.");
  }
  return paths;
}

// ---------------------------------------------------------------------------
// path helpers
// ---------------------------------------------------------------------------

function normalizePath(token) {
  return token
    .replace(/^\.\//, "")
    .replace(/[.,;:)\]}'"]+$/, "")
    .replace(/\/+$/, "");
}

function hasPlaceholder(p) {
  return /[*<>]/.test(p) || /\b(YYYY-MM-DD|ACTIVITY_ID)\b/.test(p);
}

/** Glob/placeholder path → regex. `**` spans separators, `*` and `<slug>` don't. */
function patternToRegex(pattern) {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        out += ".*";
        i++;
      } else {
        out += "[^/]*";
      }
    } else if (ch === "<") {
      const close = pattern.indexOf(">", i);
      if (close === -1) {
        out += "<";
      } else {
        out += "[^/]+";
        i = close;
      }
    } else {
      out += ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

function matchesAny(p, patterns) {
  return patterns.some((pattern) => {
    if (pattern === p) return true;
    // `dir/**` covers the bare directory too — "commit sessions/" is the same authority as
    // "commit sessions/<file>".
    if (pattern.endsWith("/**") && pattern.slice(0, -3) === p) return true;
    if (!hasPlaceholder(pattern)) return false;
    return patternToRegex(pattern).test(p);
  });
}

function existsInSkeleton(p, skeleton) {
  if (skeleton.files.has(p) || skeleton.dirs.has(p)) return true;
  if (!hasPlaceholder(p)) return false;
  const re = patternToRegex(p.replace(/YYYY-MM-DD/g, "*").replace(/ACTIVITY_ID/g, "*"));
  for (const file of skeleton.files) {
    if (re.test(file)) return true;
  }
  for (const dir of skeleton.dirs) {
    if (re.test(dir)) return true;
  }
  return false;
}

/** Every repo-path token in SOUL, with the 1-based line it appeared on. */
function extractPaths(soul) {
  const out = [];
  soul.split("\n").forEach((line, idx) => {
    for (const match of line.matchAll(PATH_RE)) {
      const p = normalizePath(match[0]);
      if (p.includes("/")) out.push({ path: p, line: idx + 1, text: line });
    }
  });
  return out;
}

function lineWritesPath(line) {
  WRITE_VERB_RE.lastIndex = 0;
  let match;
  while ((match = WRITE_VERB_RE.exec(line)) !== null) {
    const before = line.slice(Math.max(0, match.index - 40), match.index);
    if (!NEGATION_RE.test(before)) return match[0];
  }
  return null;
}

// ---------------------------------------------------------------------------
// checks
// ---------------------------------------------------------------------------

function checkPaths(soul, skeleton, report) {
  for (const { path: p, line } of extractPaths(soul)) {
    if (p.startsWith("propagated/docs/")) continue; // check 3's territory
    if (existsInSkeleton(p, skeleton)) continue;
    if (matchesAny(p, KNOWN_GENERATED)) continue;
    report(CHECKS.PATHS, p, `\`${p}\` is not in the carved skeleton and is not a known generated path`, line);
  }
}

function checkWritable(soul, writableSet, report) {
  for (const { path: p, line, text } of extractPaths(soul)) {
    const verb = lineWritesPath(text);
    if (!verb) continue;
    if (matchesAny(p, writableSet)) continue;
    report(
      CHECKS.WRITABLE,
      p,
      `\`${p}\` is written ("${verb}") but is not in this build's writable set`,
      line,
    );
  }
}

function checkPropagatedDocs(soul, skeleton, report) {
  for (const { path: p, line } of extractPaths(soul)) {
    // Scoped to propagated/docs/ so it doesn't double-report what check 1 already owns
    // (e.g. propagated/SOUL.md).
    if (!p.startsWith("propagated/docs/")) continue;
    if (skeleton.files.has(p) || skeleton.dirs.has(p)) continue;
    report(CHECKS.PROPAGATED, p, `\`${p}\` is referenced but the carve does not write it (ADR 0021)`, line);
  }
}

function checkTemplates(soul, skeleton, report) {
  const carved = new Set(
    [...skeleton.files]
      .filter((f) => f.startsWith("user_data/activities/workout_plans/templates/"))
      .map((f) => path.basename(f)),
  );
  const available = new Set(
    fs.readdirSync(TEMPLATE_SRC_DIR).filter((f) => f.endsWith(".json")),
  );

  const mentioned = new Map(); // name → first line
  const note = (name, line) => {
    if (!mentioned.has(name)) mentioned.set(name, line);
  };

  // Fully-qualified template paths, plus bare `x.json` names on a line that talks templates.
  soul.split("\n").forEach((line, idx) => {
    for (const match of line.matchAll(PATH_RE)) {
      const p = normalizePath(match[0]);
      if (!p.startsWith("user_data/activities/workout_plans/templates/")) continue;
      const base = path.basename(p);
      if (!hasPlaceholder(base)) note(base, idx + 1);
    }
    if (!/template/i.test(line)) return;
    for (const match of line.matchAll(/`([a-z0-9_]+\.json)`/gi)) {
      note(match[1], idx + 1);
    }
  });

  for (const [name, line] of mentioned) {
    if (carved.has(name)) continue;
    const msg = available.has(name)
      ? `template \`${name}\` exists in platform/skeleton-templates/ but is not in the carve's WORKOUT_TEMPLATES`
      : `template \`${name}\` exists in neither platform/skeleton-templates/ nor the carve`;
    report(CHECKS.TEMPLATES, name, msg, line);
  }
}

function checkXrefs(soul, report) {
  const lines = soul.split("\n");
  const sections = new Map(); // number → { start, end }
  lines.forEach((line, idx) => {
    const m = /^## (\d+)\. /.exec(line);
    if (m) sections.set(Number(m[1]), { start: idx, end: lines.length });
  });
  const ordered = [...sections.entries()].sort((a, b) => a[0] - b[0]);
  ordered.forEach(([num, span], i) => {
    if (i + 1 < ordered.length) span.end = ordered[i + 1][1].start;
    sections.set(num, span);
  });

  const bodyOf = (num) => {
    const span = sections.get(num);
    return span ? lines.slice(span.start, span.end) : [];
  };
  /** Count of top-level numbered items in a section — "situation 10 in §6", "§1 step 7". */
  const itemCount = (num) =>
    bodyOf(num).filter((l) => /^\d+\. /.test(l)).length;

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;

    // §N / "Section N". A §N that trails an external doc path (e.g. timer-state-machine.md §7)
    // is checked against SOUL's own sections too — a known, harmless false-negative.
    for (const m of line.matchAll(/§(\d+)|\bSection (\d+)\b/g)) {
      const num = Number(m[1] ?? m[2]);
      if (!sections.has(num)) {
        report(CHECKS.XREFS, `§${num}`, `cross-reference to §${num}, which has no such section heading`, lineNo);
      }
    }

    // "situation 10 in §6" / "§6 situation 10"
    for (const m of line.matchAll(/situation (\d+) in §(\d+)|§(\d+) situation (\d+)/gi)) {
      const item = Number(m[1] ?? m[4]);
      const section = Number(m[2] ?? m[3]);
      const count = itemCount(section);
      if (sections.has(section) && item > count) {
        report(
          CHECKS.XREFS,
          `§${section} situation ${item}`,
          `references situation ${item} of §${section}, which lists ${count}`,
          lineNo,
        );
      }
    }

    // "§1 step 7"
    for (const m of line.matchAll(/§(\d+) step (\d+)/gi)) {
      const section = Number(m[1]);
      const step = Number(m[2]);
      const count = itemCount(section);
      if (sections.has(section) && step > count) {
        report(
          CHECKS.XREFS,
          `§${section} step ${step}`,
          `references step ${step} of §${section}, which lists ${count}`,
          lineNo,
        );
      }
    }
  });
}

// ---------------------------------------------------------------------------
// cause classification
// ---------------------------------------------------------------------------

/**
 * Two very different things produce a check-2 `chat` finding, and conflating them hides the one
 * that matters:
 *
 *   rot              — the path doesn't exist, was never writable, or the instruction is dead
 *                      (roadmap.md, the archive writes of #359). This is what the trim must fix.
 *   not-yet-rebuilt  — SOUL names a write the *intended* design supports, but coach-chat's write
 *                      path is in a temporary trough: PR #350 stripped the closing turn to
 *                      coach_note + the coach_since stamp to isolate a reliability problem, and
 *                      Part B is rebuilding it one file at a time (coach-chat-flow.md's
 *                      reliability-debug caveat, BACKLOG.md). Clears on its own.
 *   unclassified     — not determinable mechanically. Reported, never guessed.
 *
 * The "intended design" is read out of docs/eng-docs/coach-chat-flow.md rather than hardcoded:
 * a path counts as intended when the doc mentions it on a line that also talks about writing
 * (edit / patch / append / full-content), so a read-only mention — quest_log.md is warmed and
 * read, never written — is not mistaken for write authority.
 */
const CAUSES = { ROT: "rot", NOT_YET_REBUILT: "not-yet-rebuilt", UNCLASSIFIED: "unclassified" };

const DESIGN_DOC = path.join(REPO_ROOT, "docs/eng-docs/coach-chat-flow.md");
const DESIGN_WRITE_RE =
  /\b(edit|edits|edited|write|writes|written|append|appends|patch|patched|merge_patch|full-content|file_updates|applyStringEdits|applyJsonMergePatch)\b/i;

function loadDesignWriteLines() {
  if (!fs.existsSync(DESIGN_DOC)) return [];
  return fs
    .readFileSync(DESIGN_DOC, "utf-8")
    .split("\n")
    .filter((line) => DESIGN_WRITE_RE.test(line));
}

/** The token to look for in the design doc: basename, or `<parent>/` when the leaf is a glob. */
function designToken(p) {
  const base = path.basename(p);
  if (!hasPlaceholder(base)) return base;
  const parent = path.basename(path.dirname(p));
  return parent && !hasPlaceholder(parent) ? `${parent}/` : null;
}

function classifyCause(finding, designWriteLines) {
  // Checks 1/3/4/5 are existence failures: the path, template, or section simply isn't there.
  if (finding.check !== CHECKS.WRITABLE) return CAUSES.ROT;

  // Check 2 outside the athlete data bands is almost always the write-verb heuristic catching a
  // script *invocation* ("run `engine/core/query_history.py --add-notes`"), not a write
  // instruction. Not mechanically separable from a real finding — hand it to review.
  if (!/^(user_data|gen)\//.test(finding.id)) return CAUSES.UNCLASSIFIED;

  // BYOB has no rebuild-in-progress story; its writable set is SOUL's own §2 list.
  if (finding.target !== "chat") return CAUSES.ROT;

  const token = designToken(finding.id);
  if (!token) return CAUSES.UNCLASSIFIED;
  // Whole-token match — a substring match would read "hist" out of "chat_history.json".
  const re = new RegExp(
    `(?<![A-Za-z0-9_.-])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_-])`,
  );
  return designWriteLines.some((line) => re.test(line))
    ? CAUSES.NOT_YET_REBUILT
    : CAUSES.ROT;
}

// ---------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------

function lintTarget(target, skeleton, chatWritable) {
  const soulPath = soulFilePath(REPO_ROOT, target);
  if (!fs.existsSync(soulPath)) {
    throw new Error(
      `${path.relative(REPO_ROOT, soulPath)} not found — run compose-soul.mjs first.`,
    );
  }
  const soul = fs.readFileSync(soulPath, "utf-8");

  const findings = new Map(); // "check::id" → finding
  const report = (check, id, message, line) => {
    const key = `${check}::${id}`;
    const existing = findings.get(key);
    if (existing) {
      existing.lines.push(line);
      return;
    }
    findings.set(key, { target, check, id, message, lines: [line] });
  };

  const writable = target === "chat" ? chatWritable : parseClaudeWritableSet(soul);

  checkPaths(soul, skeleton, report);
  checkWritable(soul, writable, report);
  checkPropagatedDocs(soul, skeleton, report);
  checkTemplates(soul, skeleton, report);
  checkXrefs(soul, report);

  return { target, soulPath, writable, findings: [...findings.values()] };
}

function findingKey(f) {
  return `${f.target}::${f.check}::${f.id}`;
}

/** Baseline entries are `{ id, cause }`; bare strings from an older file read as unclassified. */
function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return new Map();
  const raw = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf-8"));
  const entries = (raw.findings ?? []).map((entry) =>
    typeof entry === "string"
      ? [entry, CAUSES.UNCLASSIFIED]
      : [entry.id, entry.cause ?? CAUSES.UNCLASSIFIED],
  );
  return new Map(entries);
}

function writeBaseline(all, previous) {
  const findings = all
    .map((f) => ({
      id: findingKey(f),
      // A cause already in the baseline wins: Tech Lead review classifies the `unclassified`
      // ones by hand, and re-baselining must not silently overwrite that judgement.
      cause: previous.get(findingKey(f)) ?? f.cause,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const current = new Set(findings.map((f) => f.id));
  const added = findings.filter((f) => !previous.has(f.id));
  const dropped = [...previous.keys()].filter((id) => !current.has(id)).sort();

  const baseline = {
    generated_at: new Date().toISOString().slice(0, 10),
    why:
      "Known validate-soul findings as of the SOUL v5.8 trim PR 1, which changes no SOUL words. " +
      "PRs 2-4 burn this down; the CI step flips to blocking when it reaches zero. " +
      "Regenerate with: node platform/scripts/validate-soul.mjs --update-baseline",
    causes: {
      rot: "Dead instruction — path doesn't exist, was never writable, or the rule is obsolete. The trim fixes these.",
      "not-yet-rebuilt":
        "SOUL names a write the intended coach-chat design supports; the write path is mid-rebuild after PR #350 (see docs/eng-docs/coach-chat-flow.md). Clears as Part B lands.",
      unclassified:
        "Not determinable mechanically — classify by hand in review. A cause set here is preserved across --update-baseline.",
    },
    findings,
  };
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, "utf-8");

  console.log(
    `Wrote ${path.relative(REPO_ROOT, BASELINE_PATH)} (${findings.length} findings)`,
  );
  // Printed in full on purpose: the failure mode is re-baselining after a Part B step and
  // silently absorbing real rot along with the legitimately-fixed entries.
  console.log(`  added (${added.length}):`);
  for (const f of added) console.log(`    + [${f.cause}] ${f.id}`);
  console.log(`  dropped (${dropped.length}):`);
  for (const id of dropped) console.log(`    - [${previous.get(id)}] ${id}`);
}

function parseArgs(argv) {
  const opts = { targets: TARGETS, updateBaseline: false, keepSkeleton: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--update-baseline") opts.updateBaseline = true;
    else if (arg === "--keep-skeleton") opts.keepSkeleton = true;
    else if (arg === "--target") opts.targets = [argv[++i]];
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node platform/scripts/validate-soul.mjs [--target chat|claude] [--update-baseline] [--keep-skeleton]",
      );
      process.exit(0);
    } else {
      console.error(`Unknown flag: ${arg}`);
      process.exit(2);
    }
  }
  for (const target of opts.targets) {
    if (!TARGETS.includes(target)) {
      console.error(`Unknown target "${target}" (known: ${TARGETS.join(", ")})`);
      process.exit(2);
    }
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const baseline = loadBaseline();

  let skeletonDir;
  let results;
  try {
    skeletonDir = carveSkeleton(opts.keepSkeleton);
    const skeleton = inventory(skeletonDir);
    const chatWritable = loadChatWritableSet();
    const designWriteLines = loadDesignWriteLines();
    results = opts.targets.map((target) => lintTarget(target, skeleton, chatWritable));
    for (const result of results) {
      for (const finding of result.findings) {
        finding.cause = classifyCause(finding, designWriteLines);
      }
    }
  } catch (err) {
    console.error(`::error::validate-soul: ${err.message}`);
    process.exit(2);
  } finally {
    if (skeletonDir && !opts.keepSkeleton) {
      fs.rmSync(skeletonDir, { recursive: true, force: true });
    }
  }

  const all = results.flatMap((r) => r.findings);

  if (opts.updateBaseline) {
    if (opts.targets.length !== TARGETS.length) {
      console.error("--update-baseline must run over every target (drop --target).");
      process.exit(2);
    }
    writeBaseline(all, baseline);
    process.exit(0);
  }

  let knownTotal = 0;
  let newTotal = 0;
  /** A baseline cause set by hand in review overrides the mechanical one. */
  const causeOf = (f) => baseline.get(findingKey(f)) ?? f.cause;

  for (const result of results) {
    console.log(`\nvalidate-soul — ${result.target} (${path.relative(REPO_ROOT, result.soulPath)})`);
    for (const check of Object.values(CHECKS)) {
      const findings = result.findings.filter((f) => f.check === check);
      const known = findings.filter((f) => baseline.has(findingKey(f)));
      const fresh = findings.filter((f) => !baseline.has(findingKey(f)));
      knownTotal += known.length;
      newTotal += fresh.length;
      // Check 2's total is meaningless on its own — rot is the trim's work, not-yet-rebuilt
      // clears itself as coach-chat's write path is rebuilt. Always split them.
      const causeSplit =
        check === CHECKS.WRITABLE
          ? `  [${Object.values(CAUSES)
              .map((c) => `${c}: ${findings.filter((f) => causeOf(f) === c).length}`)
              .join(", ")}]`
          : "";
      console.log(
        `  ${check.padEnd(16)} ${String(known.length).padStart(3)} known  ${String(fresh.length).padStart(3)} new${causeSplit}`,
      );
      for (const f of findings) {
        const tag = baseline.has(findingKey(f)) ? "known" : "NEW  ";
        console.log(`    [${tag}] [${causeOf(f)}] L${f.lines.join(",")}: ${f.message}`);
      }
    }
  }

  const seen = new Set(all.map(findingKey));
  const resolved = [...baseline.keys()].filter((key) => {
    const target = key.split("::")[0];
    return opts.targets.includes(target) && !seen.has(key);
  });

  console.log(`\nTotal: ${knownTotal} known / ${newTotal} new / ${resolved.length} resolved`);
  if (resolved.length > 0) {
    console.log("Resolved (drop from the baseline with --update-baseline):");
    for (const key of resolved) console.log(`  - ${key}`);
  }

  if (newTotal > 0) {
    console.error(
      `::error::validate-soul: ${newTotal} new finding(s) — fix them, or record with --update-baseline if intentional.`,
    );
    process.exit(1);
  }
  process.exit(0);
}

main();
