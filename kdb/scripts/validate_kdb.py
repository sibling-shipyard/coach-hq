#!/usr/bin/env python3
"""Lint the knowledge base. Exit non-zero on any hard failure.
Checks ADR format/filenames/numbering, supersede refs, and that the index is in sync."""
import pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
DEC = ROOT / "kdb" / "decisions"
AGENTS = ROOT / "AGENTS.md"
FIELDS = ["Status", "Area", "Context", "Decision", "Why", "Rejected"]
NAME_RE = re.compile(r"^\d{4}-[a-z0-9-]+\.md$")
SKIP = {"0000-template.md", "README.md"}

errors, warnings = [], []

def adr_files():
    return sorted(f for f in DEC.glob("*.md") if f.name not in SKIP and f.name[:1].isdigit())

nums = {}
for fp in adr_files():
    name = fp.name
    if not NAME_RE.match(name):
        errors.append(f"{name}: bad filename (want NNNN-kebab-title.md)")
    text = fp.read_text()
    if not re.match(r"#\s+\d{4}\s*[—-]\s+", text.splitlines()[0] if text.splitlines() else ""):
        errors.append(f"{name}: first line must be '# NNNN — Title'")
    for field in FIELDS:
        if f"**{field}:**" not in text:
            errors.append(f"{name}: missing field '{field}'")
    nums.setdefault(name[:4], []).append(name)

for num, files in nums.items():
    if len(files) > 1:
        errors.append(f"duplicate ADR number {num}: {', '.join(files)}")

# Superseded refs must resolve
existing_nums = set(nums)
for fp in adr_files():
    for m in re.finditer(r"Superseded by (\d{4})", fp.read_text()):
        if m.group(1) not in existing_nums:
            errors.append(f"{fp.name}: 'Superseded by {m.group(1)}' points at a missing ADR")

# Index in sync: run the generator and compare. A failure to run the generator is a
# hard error — never let a broken/missing generator make this check silently pass.
gen = ROOT / "kdb" / "scripts" / "gen_adr_index.py"
if not gen.exists():
    errors.append(f"generator not found at {gen.relative_to(ROOT)}")
else:
    before = (DEC / "README.md").read_text()
    r = subprocess.run([sys.executable, str(gen)], capture_output=True, text=True)
    if r.returncode != 0:
        errors.append(f"gen_adr_index.py failed to run: {(r.stderr or r.stdout).strip()}")
    elif (DEC / "README.md").read_text() != before:
        errors.append("ADR index in kdb/decisions/README.md is stale — run kdb/scripts/gen_adr_index.py")

# Backticked repo-relative paths in AGENTS.md + role docs must exist.
# Narrow hard: only tokens with a "/" whose top-level segment is a real HQ directory are
# checked — that skips athlete-repo paths (user_data/**, sessions/**), external repo slugs
# (owner/repo), API routes (/api/*), import aliases (@/*) and placeholders (<N>, *).
TOP_DIRS = {p.name for p in ROOT.iterdir() if p.is_dir()}
PATH_RE = re.compile(r"`([^`\n]+)`")

def gitignored(rel):
    try:
        return subprocess.run(["git", "-C", str(ROOT), "check-ignore", "-q", rel],
                              capture_output=True).returncode == 0
    except OSError:
        return False  # git unavailable — don't skip, but don't crash either

doc_files = ([AGENTS] if AGENTS.exists() else []) + sorted((ROOT / ".github" / "agents").glob("*.md"))
for fp in doc_files:
    for tok in dict.fromkeys(PATH_RE.findall(fp.read_text())):
        if "/" not in tok or tok.startswith(("/", "@")):
            continue
        if any(c in tok for c in "<>*") or any(c.isspace() for c in tok):
            continue
        rel = tok.rstrip("/")
        if rel.split("/", 1)[0] not in TOP_DIRS:
            continue
        if (ROOT / rel).exists() or gitignored(rel):
            continue
        errors.append(f"{fp.relative_to(ROOT)}: `{tok}` does not exist")

# AGENTS.md size (soft cap)
if AGENTS.exists():
    n = len(AGENTS.read_text().splitlines())
    if n > 200:
        warnings.append(f"AGENTS.md is {n} lines (>200) — keep it lean")

for w in warnings:
    print(f"warn: {w}")
if errors:
    print("\nvalidate-kdb FAILED:")
    for e in errors:
        print(f"  - {e}")
    sys.exit(1)
print(f"validate-kdb OK ({len(adr_files())} ADRs)")
