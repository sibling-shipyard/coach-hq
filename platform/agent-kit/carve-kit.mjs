#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const KIT_ROOT = process.env.AGENT_KIT_ROOT
  ? path.resolve(process.env.AGENT_KIT_ROOT)
  : path.resolve(REPO_ROOT, "../agent-kit");
const INIT_TEMPLATES_SRC = path.join(__dirname, "templates/init");

const EXEC_SUFFIXES = new Set([".py", ".sh", ".mjs"]);

/** Files stamped from templates/init/ during --init (relative to kit root). */
const INIT_TEXT_MANIFEST = [
  "AGENTS.md",
  "kdb/decisions/README.md",
  "kdb/doc-style.md",
  ".github/CONVENTIONS.md",
  ".github/agents/issue-template.md",
  ".github/agents/tech-lead.md",
  ".github/ISSUE_TEMPLATE/issue.yml",
  "platform/scripts/checks.conf",
  "platform/scripts/check.sh",
];

function sanitize(content) {
  return content
    .replace(/claude/gi, "agent")
    .replace(/cursor/gi, "ide")
    .replace(/codex/gi, "assistant")
    .replace(/antigravity/gi, "workspace")
    .replace(
      /Coach's voice rules \(`platform\/soul\/A_identity\.md` §3\) apply to you\./g,
      "Coach's voice rules (your repo's identity doc) apply to you.",
    )
    .replace(
      /Otherwise git, `kdb\/decisions\/` and `SOUL_HISTORY\.md` are the archive\./g,
      "Otherwise git and `kdb/decisions/` are the archive.",
    )
    .replace(
      /2\. Changed a soul layer or a composed build\? Add a version entry to `docs\/eng-docs\/SOUL_HISTORY\.md`[^\n]*/g,
      "2. Changed a composed identity doc? Add a version entry to your project's change-history doc (see `kdb/doc-style.md`).",
    );
}

function extractBlocks(fileRelPaths) {
  for (const relPath of fileRelPaths) {
    const filePath = path.join(REPO_ROOT, relPath);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, "utf-8");
    const regex =
      /<!--\s*AGENT-KIT:START\s+id="([^"]+)"\s*-->([\s\S]*?)<!--\s*AGENT-KIT:END\s*-->/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const id = match[1];
      const block = match[2];
      const outPath = path.join(KIT_ROOT, "blocks", `${id}.md`);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, sanitize(block.trim()) + "\n");
    }
  }
}

function copyTree(srcDir, destDir, { force = false, executable = false, created = null } = {}) {
  if (!fs.existsSync(srcDir)) return { copied: 0, skipped: 0 };
  let copied = 0;
  let skipped = 0;
  const destExisted = fs.existsSync(destDir);
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      const sub = copyTree(srcPath, destPath, { force, executable, created });
      copied += sub.copied;
      skipped += sub.skipped;
    } else if (entry.isFile()) {
      if (fs.existsSync(destPath) && !force) {
        skipped += 1;
        continue;
      }
      const fileExisted = fs.existsSync(destPath);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
      if (executable || EXEC_SUFFIXES.has(path.extname(entry.name))) {
        fs.chmodSync(destPath, 0o755);
      }
      if (created && !fileExisted) created.push(destPath);
      copied += 1;
    }
  }
  if (created && !destExisted && copied > 0) created.push(destDir);
  return { copied, skipped };
}

function copyInitTemplatesToKit() {
  if (!fs.existsSync(INIT_TEMPLATES_SRC)) {
    console.error(`❌ init templates missing at ${INIT_TEMPLATES_SRC}`);
    process.exit(1);
  }
  const dest = path.join(KIT_ROOT, "templates/init");
  copyTree(INIT_TEMPLATES_SRC, dest, { force: true, executable: true });
}

function overlayInitCheckSh() {
  const initCheckSh = path.join(KIT_ROOT, "templates/init/platform/scripts/check.sh");
  fs.mkdirSync(path.dirname(initCheckSh), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, "platform/scripts/check.sh"), initCheckSh);
  fs.chmodSync(initCheckSh, 0o755);
}

function carve() {
  if (fs.existsSync(KIT_ROOT)) {
    fs.rmSync(KIT_ROOT, { recursive: true, force: true });
  }
  fs.mkdirSync(KIT_ROOT, { recursive: true });

  // 1. Tier 2 (Managed Blocks)
  extractBlocks(["AGENTS.md", "kdb/doc-style.md", ".github/CONVENTIONS.md"]);

  // 2. Tier 1 (Validators)
  const scriptsSrcDir = path.join(REPO_ROOT, "kdb/scripts");
  const scriptsDestDir = path.join(KIT_ROOT, "tools/kdb");
  fs.mkdirSync(scriptsDestDir, { recursive: true });

  if (fs.existsSync(scriptsSrcDir)) {
    const files = fs.readdirSync(scriptsSrcDir);
    for (const f of files) {
      const srcPath = path.join(scriptsSrcDir, f);
      const destPath = path.join(scriptsDestDir, f);

      if (!fs.statSync(srcPath).isFile()) continue;

      let content = fs.readFileSync(srcPath, "utf8");
      if (f === "validate_kdb.py") {
        content = content.replace(
          /# AGENT-KIT:STRIP-START[^\n]*\n[\s\S]*?# AGENT-KIT:STRIP-END\n?/g,
          "",
        );
        if (content.includes("soul_history")) {
          console.error(
            "❌ soul_history guard not fully stripped from validate_kdb.py — check the AGENT-KIT:STRIP sentinels",
          );
          process.exit(1);
        }
      }
      fs.writeFileSync(destPath, sanitize(content));
      if (EXEC_SUFFIXES.has(path.extname(f))) {
        fs.chmodSync(destPath, 0o755);
      }
    }
  }

  // 3. Tier 1 (CI) — workflows/ empty for now

  // 4. Tier 3 (Templates)
  const hqDecisionTpl = path.join(REPO_ROOT, "kdb/decisions/0000-template.md");
  const hqAgentTpl = path.join(REPO_ROOT, ".github/agents/_template.md");

  const templatesDir = path.join(KIT_ROOT, "templates");
  fs.mkdirSync(path.join(templatesDir, "kdb/decisions"), { recursive: true });
  fs.mkdirSync(path.join(templatesDir, "agents"), { recursive: true });

  fs.writeFileSync(
    path.join(templatesDir, "kdb/decisions/0000-template.md"),
    sanitize(fs.readFileSync(hqDecisionTpl, "utf8")),
  );
  fs.writeFileSync(
    path.join(templatesDir, "agents/_template.md"),
    sanitize(fs.readFileSync(hqAgentTpl, "utf8")),
  );
  fs.writeFileSync(
    path.join(templatesDir, "checks.conf"),
    sanitize(fs.readFileSync(path.join(REPO_ROOT, "platform/scripts/checks.conf"), "utf8")),
  );
  fs.writeFileSync(
    path.join(templatesDir, "boot-manifest.json"),
    sanitize(fs.readFileSync(path.join(REPO_ROOT, "platform/scripts/boot-manifest.json"), "utf8")),
  );

  // 5. Init scaffold templates (source in HQ, copied to carved kit)
  copyInitTemplatesToKit();
  // check.sh is HQ live prose — overlay from source, never hand-maintain under templates/init/
  overlayInitCheckSh();

  // 6. Git hooks
  const githooksSrc = path.join(REPO_ROOT, ".githooks");
  const githooksDest = path.join(KIT_ROOT, "tools/githooks");
  if (fs.existsSync(githooksSrc)) {
    fs.mkdirSync(githooksDest, { recursive: true });
    const hookFiles = fs.readdirSync(githooksSrc);
    for (const hook of hookFiles) {
      const srcPath = path.join(githooksSrc, hook);
      if (fs.statSync(srcPath).isFile()) {
        const destPath = path.join(githooksDest, hook);
        fs.writeFileSync(destPath, sanitize(fs.readFileSync(srcPath, "utf8")));
        fs.chmodSync(destPath, fs.statSync(srcPath).mode);
      }
    }
  }

  console.log("✓ Agent kit carved to", KIT_ROOT);
}

function stampFile(src, dest, force) {
  if (fs.existsSync(dest) && !force) {
    return "skipped";
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  if (EXEC_SUFFIXES.has(path.extname(dest))) {
    fs.chmodSync(dest, 0o755);
  }
  return "copied";
}

function rollbackInit(created) {
  for (const p of created.reverse()) {
    fs.rmSync(p, { recursive: true, force: true });
  }
}

function init(targetPath, force) {
  if (!fs.existsSync(KIT_ROOT) || !fs.existsSync(path.join(KIT_ROOT, "tools/kdb"))) {
    console.log("Agent kit not found — carving first…");
    carve();
  }

  const target = path.resolve(targetPath);
  if (!fs.existsSync(target)) {
    console.error(`❌ target directory does not exist: ${target}`);
    process.exit(1);
  }

  const created = [];
  let copied = 0;
  let skipped = 0;

  try {
    for (const rel of INIT_TEXT_MANIFEST) {
      const src = path.join(KIT_ROOT, "templates/init", rel);
      const dest = path.join(target, rel);
      if (!fs.existsSync(src)) {
        throw new Error(`missing init template in kit: templates/init/${rel}`);
      }
      const existed = fs.existsSync(dest);
      const result = stampFile(src, dest, force);
      if (result === "copied") {
        copied += 1;
        if (!existed) created.push(dest);
      } else {
        skipped += 1;
      }
    }

    const adrTplSrc = path.join(KIT_ROOT, "templates/kdb/decisions/0000-template.md");
    const adrTplDest = path.join(target, "kdb/decisions/0000-template.md");
    const adrExisted = fs.existsSync(adrTplDest);
    const adrResult = stampFile(adrTplSrc, adrTplDest, force);
    if (adrResult === "copied") {
      copied += 1;
      if (!adrExisted) created.push(adrTplDest);
    } else {
      skipped += 1;
    }

    const kdbResult = copyTree(
      path.join(KIT_ROOT, "tools/kdb"),
      path.join(target, "kdb/scripts"),
      { force, executable: true, created },
    );
    copied += kdbResult.copied;
    skipped += kdbResult.skipped;

    const hooksResult = copyTree(
      path.join(KIT_ROOT, "tools/githooks"),
      path.join(target, ".githooks"),
      { force, executable: true, created },
    );
    copied += hooksResult.copied;
    skipped += hooksResult.skipped;
  } catch (err) {
    rollbackInit(created);
    console.error(`❌ init failed: ${err.message}`);
    process.exit(1);
  }

  console.log(`✓ Agent kit initialized at ${target} (${copied} copied, ${skipped} skipped)`);
}

function usage() {
  console.log(`Usage:
  node platform/agent-kit/carve-kit.mjs              Carve kit to ../agent-kit
  node platform/agent-kit/carve-kit.mjs --init <dir> Stamp KB scaffold into <dir>
  node platform/agent-kit/carve-kit.mjs --init <dir> --force  Overwrite existing files

Env:
  AGENT_KIT_ROOT  Carve/init output directory (default: <repo>/../agent-kit)`);
}

function parseArgs(argv) {
  let initTarget = null;
  let force = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--init") {
      initTarget = argv[i + 1];
      if (!initTarget) {
        console.error("❌ --init requires a target directory path");
        usage();
        process.exit(1);
      }
      i += 1;
    } else if (arg === "--force") {
      force = true;
    } else if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    } else {
      console.error(`❌ unknown argument: ${arg}`);
      usage();
      process.exit(1);
    }
  }
  return { initTarget, force };
}

const { initTarget, force } = parseArgs(process.argv.slice(2));
if (initTarget) {
  init(initTarget, force);
} else {
  carve();
}
