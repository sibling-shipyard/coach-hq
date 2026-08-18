#!/usr/bin/env python3
"""Lint the knowledge base. Exit non-zero on any hard failure.
Checks ADR format/filenames/numbering, supersede refs, and that the index is in sync."""
import datetime, os, pathlib, re, subprocess, sys

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
    # Directory-only patterns (trailing slash, e.g. `ui/client/src/data/`) only match when git
    # can tell the path is a directory — on a clean checkout it is absent, so the bare form
    # misses. Test both forms: with several pathspecs check-ignore exits 0 if ANY match
    # (and rejects -q, so drop it — output is captured and discarded anyway).
    try:
        return subprocess.run(["git", "-C", str(ROOT), "check-ignore", rel, rel + "/"],
                              capture_output=True).returncode == 0
    except OSError:
        return False  # git unavailable — don't skip, but don't crash either

LINE_CITE_RE = re.compile(r":\d+(?:-\d+)?$")  # `foo.ts:823`, `foo.ts:819-855` — a citation, not a path

def check_repo_path(fp, tok, sink=None):
    """Report tok if it looks like an HQ repo-relative path that no longer exists."""
    if "/" not in tok or tok.startswith(("/", "@")):
        return
    # `{a,b}.ts` is brace expansion over several files, not one path — same class as <N> and *.
    if any(c in tok for c in "<>*{}") or any(c.isspace() for c in tok):
        return
    rel = LINE_CITE_RE.sub("", tok).rstrip("/")
    if rel.split("/", 1)[0] not in TOP_DIRS:
        return
    if (ROOT / rel).exists() or gitignored(rel):
        return
    msg = f"{fp.relative_to(ROOT)}: `{tok}` does not exist"
    sink = errors if sink is None else sink
    if msg not in sink:
        sink.append(msg)

doc_files = ([AGENTS] if AGENTS.exists() else []) + sorted((ROOT / ".github" / "agents").glob("*.md"))
for fp in doc_files:
    for tok in dict.fromkeys(PATH_RE.findall(fp.read_text())):
        check_repo_path(fp, tok)

# Wider scan: workflows + HQ docs. Same path rules, plus two extra matchers, because paths
# there are usually not backticked — the dead `docs/eng-docs/TODO.md` that survived in
# ios-build.yml was a plain YAML comment.
#   1. bare tokens, but only when they carry a known extension or a trailing slash. Prose and
#      YAML are full of slashed non-paths (`actions/checkout@v4`, `A/B`, URLs); requiring an
#      extension keeps this precise — a checker that cries wolf gets switched off.
#   2. markdown link targets, resolved against the containing file's directory (they are
#      relative to the file, not the repo root) — that is what catches broken cross-refs.
WIDE_EXTS = (".md", ".py", ".mjs", ".ts", ".sh", ".json", ".yml")
BARE_RE = re.compile(r"[\w.\-/]*/[\w.\-/]*")
LINK_RE = re.compile(r"\]\(([^)\s]+)\)")
HISTORICAL_RE = re.compile(r"^>\s*Status:\s*(Historical|Superseded)", re.M)

# `docs/plans/` is in-flight work that names files it proposes to create, so a missing path
# there is a forward reference, not a dead one — warn, never fail. Workflows and `docs/eng-docs/`
# describe the system as it is today: missing means broken.
wide_files = ([(fp, errors) for fp in sorted((ROOT / ".github" / "workflows").glob("*.yml"))]
              + [(fp, errors) for fp in sorted((ROOT / "docs" / "eng-docs").glob("*.md"))]
              + [(fp, warnings) for fp in sorted((ROOT / "docs" / "plans").glob("*.md"))])
for fp, sink in wide_files:
    text = fp.read_text()
    if HISTORICAL_RE.search(text):
        continue  # dated records — they describe a tree that is gone on purpose
    for tok in dict.fromkeys(PATH_RE.findall(text)):
        check_repo_path(fp, tok, sink)
    for tok in dict.fromkeys(BARE_RE.findall(text)):
        tok = tok.strip("`\"'.,;:()[]")
        if not (tok.endswith("/") or tok.endswith(WIDE_EXTS)):
            continue
        check_repo_path(fp, tok, sink)
    for target in dict.fromkeys(LINK_RE.findall(text)):
        target = target.split("#", 1)[0].strip("`\"'<>")
        if not target or ":" in target or target.startswith(("/", "@")):
            continue  # anchors, URLs, mailto:, absolute paths
        if any(c in target for c in "<>*{}"):
            continue
        dest = (fp.parent / target).resolve()
        try:
            rel = dest.relative_to(ROOT)
        except ValueError:
            continue  # points outside the repo — not ours to validate
        if dest.exists() or gitignored(str(rel)):
            continue
        msg = f"{fp.relative_to(ROOT)}: link target '{target}' does not exist"
        if msg not in sink:
            sink.append(msg)

# AGENTS.md size (soft cap)
if AGENTS.exists():
    n = len(AGENTS.read_text().splitlines())
    if n > 200:
        warnings.append(f"AGENTS.md is {n} lines (>200) — keep it lean")

# Role-doc `## Learnings` blocks (hard cap). Every agent re-reads its role doc on every cold
# boot, so an unbounded Learnings list is a cost paid forever. Measured in BYTES, not characters:
# the entries are long single lines full of em-dashes, and a char count under-reports them.
LEARNINGS_CAP = 1536
LEARNINGS_RE = re.compile(r"^## Learnings *$", re.M)
for fp in sorted((ROOT / ".github" / "agents").glob("*.md")):
    if fp.name == "issue-template.md":
        continue  # not a role doc — no Learnings block, nobody boots it
    text = fp.read_text()
    m = LEARNINGS_RE.search(text)
    if not m:
        continue  # a role doc with no Learnings section is fine
    nxt = re.search(r"^## ", text[m.end():], re.M)
    end = m.end() + nxt.start() if nxt else len(text)
    size = len(text[m.start():end].encode("utf-8"))
    if size > LEARNINGS_CAP:
        errors.append(
            f"{fp.relative_to(ROOT)}: '## Learnings' block is {size}B, cap is {LEARNINGS_CAP}B — "
            "promote the durable entries into the relevant docs/eng-docs/ doc and delete the rest")

# A soul-layer diff must carry a SOUL_HISTORY.md entry. AGENTS.md spells out why this one
# cannot be a grep: a SOUL version change need not touch any path a text scan would look at,
# so the only honest signal is the diff itself.
#
# Base resolution, in order: GITHUB_BASE_REF (set by Actions on a pull_request) -> origin/main
# -> main. Compare against `git merge-base <base> HEAD`, not the base tip: a two-dot diff
# against the tip would also report files that moved on the base since we branched, which has
# nothing to do with this PR.
#
# FAIL SAFE — if no base resolves, git is unavailable, or the clone is shallow, this rule is
# SKIPPED with a warning and never errors. It has to be that way: every local run on main and
# every shallow CI checkout would otherwise hard-fail on a diff the script simply cannot see,
# and a guard that red-lights when blind gets switched off within a day.
SOUL_LAYERS = "platform/soul/"
SOUL_HISTORY = "docs/eng-docs/SOUL_HISTORY.md"

def git(*args):
    """Run a git command in ROOT. Returns stripped stdout, or None if it failed/git is missing."""
    try:
        r = subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, text=True)
    except OSError:
        return None
    return r.stdout.strip() if r.returncode == 0 else None

def soul_history_guard():
    if git("rev-parse", "--git-dir") is None:
        return "soul-history guard skipped: git unavailable"
    if git("rev-parse", "--is-shallow-repository") == "true":
        return "soul-history guard skipped: shallow clone has no merge-base — set fetch-depth: 0"
    candidates = []
    base_ref = os.environ.get("GITHUB_BASE_REF", "").strip()
    if base_ref:
        candidates.append(f"origin/{base_ref}")
    candidates += ["origin/main", "main"]
    base = next((c for c in candidates if git("rev-parse", "--verify", "--quiet", c + "^{commit}")), None)
    if base is None:
        return f"soul-history guard skipped: no base branch resolved (tried {', '.join(candidates)})"
    mb = git("merge-base", base, "HEAD")
    if not mb:
        return f"soul-history guard skipped: no merge-base between {base} and HEAD"
    out = git("diff", "--name-only", f"{mb}..HEAD")
    if out is None:
        return f"soul-history guard skipped: could not diff {mb[:8]}..HEAD"
    changed = [line for line in out.splitlines() if line]
    layers = [f for f in changed if f.startswith(SOUL_LAYERS)]
    if layers and SOUL_HISTORY not in changed:
        errors.append(
            f"soul layer changed ({', '.join(layers)}) but {SOUL_HISTORY} is not in the diff "
            f"vs {base} — add the version entry (AGENTS.md 'Doc upkeep')")
    return None

skip_reason = soul_history_guard()
if skip_reason:
    warnings.append(skip_reason)

# `Verified:` staleness. Docs carry `> Status: Current - Owner: <role> - Verified: YYYY-MM-DD`.
# Only Current docs are re-verified; Historical/Superseded are dated records of a tree that is
# gone on purpose, so they reuse HISTORICAL_RE above and are skipped. Warn past 60 days, fail
# past 90 — a doc nobody has looked at in a quarter is a liability, not a reference. A Current
# doc with no parseable date warns rather than fails: missing front matter is a doc-hygiene
# nit, not a reason to red-light someone else's build.
STALE_WARN_DAYS, STALE_FAIL_DAYS = 60, 90
CURRENT_RE = re.compile(r"^>\s*Status:\s*Current\b", re.M)
VERIFIED_RE = re.compile(r"^>\s*Status:.*?\bVerified:\s*(\d{4})-(\d{2})-(\d{2})", re.M)
TODAY = datetime.date.today()

for fp in sorted((ROOT / "docs" / "eng-docs").glob("*.md")) + sorted((ROOT / "docs" / "plans").glob("*.md")):
    text = fp.read_text()
    if HISTORICAL_RE.search(text) or not CURRENT_RE.search(text):
        continue  # dated record, or no front matter at all — nothing to re-verify
    rel = fp.relative_to(ROOT)
    m = VERIFIED_RE.search(text)
    try:
        verified = datetime.date(*(int(g) for g in m.groups())) if m else None
    except ValueError:
        verified = None  # e.g. 2026-13-45
    if verified is None:
        warnings.append(f"{rel}: Status: Current but no parseable `Verified: YYYY-MM-DD` date")
        continue
    age = (TODAY - verified).days
    if age > STALE_FAIL_DAYS:
        errors.append(f"{rel}: Verified: {verified} is {age} days old (>{STALE_FAIL_DAYS}) — "
                      "re-read it and bump the date, or mark it Historical")
    elif age > STALE_WARN_DAYS:
        warnings.append(f"{rel}: Verified: {verified} is {age} days old (>{STALE_WARN_DAYS}) — due for a re-read")

for w in warnings:
    print(f"warn: {w}")
if errors:
    print("\nvalidate-kdb FAILED:")
    for e in errors:
        print(f"  - {e}")
    sys.exit(1)
print(f"validate-kdb OK ({len(adr_files())} ADRs)")
