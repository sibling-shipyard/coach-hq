#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const KIT_ROOT = path.resolve(REPO_ROOT, "../agent-kit");

function sanitize(content) {
  return content
    .replace(/claude/gi, 'agent')
    .replace(/cursor/gi, 'ide')
    .replace(/codex/gi, 'copilot')
    .replace(/antigravity/gi, 'workspace');
}

function extractBlocks(fileRelPaths) {
  for (const relPath of fileRelPaths) {
    const filePath = path.join(REPO_ROOT, relPath);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf-8');
    const regex = /<!--\s*AGENT-KIT:START\s+id="([^"]+)"\s*-->([\s\S]*?)<!--\s*AGENT-KIT:END\s*-->/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const id = match[1];
      let block = match[2];
      
      const outPath = path.join(KIT_ROOT, 'blocks', `${id}.md`);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, sanitize(block.trim()) + '\n');
    }
  }
}

function carve() {
  if (fs.existsSync(KIT_ROOT)) {
    fs.rmSync(KIT_ROOT, { recursive: true, force: true });
  }
  fs.mkdirSync(KIT_ROOT, { recursive: true });

  // 1. Tier 2 (Managed Blocks)
  extractBlocks(['AGENTS.md', 'kdb/doc-style.md', '.github/CONVENTIONS.md']);

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

      let content = fs.readFileSync(srcPath, 'utf8');
      if (f === 'validate_kdb.py') {
         content = content.replace(/skip_reason = soul_history_guard\(\)\nif skip_reason:\n    warnings\.append\(skip_reason\)\n/g, '');
         content = content.replace(/lint_soul_history_entries\(\)\n/g, '');
      }
      fs.writeFileSync(destPath, sanitize(content));
      if (f.endsWith('.py') || f.endsWith('.sh') || f.endsWith('.mjs')) {
        fs.chmodSync(destPath, 0o755);
      }
    }
  }

  // 3. Tier 1 (CI)
  // leave workflows/ empty for now

  // 4. Tier 3 (Templates)
  const hqDecisionTpl = path.join(REPO_ROOT, "kdb/decisions/0000-template.md");
  if (!fs.existsSync(hqDecisionTpl)) {
    fs.mkdirSync(path.dirname(hqDecisionTpl), { recursive: true });
    fs.writeFileSync(hqDecisionTpl, "");
  }
  const hqAgentTpl = path.join(REPO_ROOT, ".github/agents/_template.md");
  if (!fs.existsSync(hqAgentTpl)) {
    fs.mkdirSync(path.dirname(hqAgentTpl), { recursive: true });
    fs.writeFileSync(hqAgentTpl, "# Agent Role\n## Scope\n## Boot\n## Learnings\n");
  }

  const templatesDir = path.join(KIT_ROOT, "templates");
  fs.mkdirSync(path.join(templatesDir, "kdb/decisions"), { recursive: true });
  fs.mkdirSync(path.join(templatesDir, "agents"), { recursive: true });
  
  fs.writeFileSync(path.join(templatesDir, "kdb/decisions/0000-template.md"), sanitize(fs.readFileSync(hqDecisionTpl, 'utf8')));
  fs.writeFileSync(path.join(templatesDir, "agents/_template.md"), sanitize(fs.readFileSync(hqAgentTpl, 'utf8')));
  fs.writeFileSync(path.join(templatesDir, "checks.conf"), sanitize(fs.readFileSync(path.join(REPO_ROOT, "platform/scripts/checks.conf"), 'utf8')));
  fs.writeFileSync(path.join(templatesDir, "boot-manifest.json"), sanitize(fs.readFileSync(path.join(REPO_ROOT, "platform/scripts/boot-manifest.json"), 'utf8')));

  // 5. Git hooks
  const githooksSrc = path.join(REPO_ROOT, ".githooks");
  const githooksDest = path.join(KIT_ROOT, "tools/githooks");
  if (fs.existsSync(githooksSrc)) {
    fs.mkdirSync(githooksDest, { recursive: true });
    const hookFiles = fs.readdirSync(githooksSrc);
    for (const hook of hookFiles) {
      const srcPath = path.join(githooksSrc, hook);
      if (fs.statSync(srcPath).isFile()) {
        const destPath = path.join(githooksDest, hook);
        fs.writeFileSync(destPath, sanitize(fs.readFileSync(srcPath, 'utf8')));
        fs.chmodSync(destPath, fs.statSync(srcPath).mode);
      }
    }
  }

  console.log("✓ Agent kit carved to", KIT_ROOT);
}

carve();
