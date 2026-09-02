#!/usr/bin/env python3
"""Lint the knowledge base. Exit non-zero on any hard failure.
Checks ADR format/filenames/numbering, supersede refs, and that the index is in sync."""
import datetime, os, pathlib, re, subprocess, sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import adr_readability

ROOT = pathlib.Path(__file__).resolve().parents[2]
DEC = ROOT / "kdb" / "decisions"
AGENTS = ROOT / "AGENTS.md"
FIELDS = ["Status", "Area", "Context", "Decision", "Why", "Rejected"]
ENFORCES_REQUIRED_FROM = 33
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
    # `Enforces:` is required from 0033 on — the first ADR written under the template
    # that has the field — and backfilled onto older ones as they are touched. Not
    # applied retroactively: naming what an ADR stops is a judgment call, and a check
    # that forces a dozen of them to be guessed in one sitting produces filler, which is
    # worse than the gap it closes. 0032 landed on main while this branch was open and
    # is exempt for exactly that reason, not by oversight.
    num = int(name[:4]) if name[:4].isdigit() else 0  # bad name already reported above
    if num >= ENFORCES_REQUIRED_FROM and "**Enforces:**" not in text:
        errors.append(f"{name}: missing field 'Enforces' — one line naming what this ADR "
                      "stops someone doing (required for 0033 and later)")
    nums.setdefault(name[:4], []).append(name)

for num, files in nums.items():
    if len(files) > 1:
        errors.append(f"duplicate ADR number {num}: {', '.join(files)}")

# ADR prose. Two rules gate (over-long sentences, jargon with a shorter replacement);
# everything else reports. The split is not arbitrary — see adr_readability.py, which
# records the run where a field-budget gate failed the most readable ADR in the set and
# passed the least readable one.
#
# ENFORCED. The checks were deliberately written against a set that failed them, so the
# thresholds describe the prose we want rather than the prose we had; gating on day one
# would have meant tuning numbers until the existing files passed, which measures nothing.
# The cleanup landed first, then this flipped.
#
# Closed ADRs are skipped below. Superseded and historical records are archives — nobody
# reads them on boot, which is the point of filing them below the fold, and editing an
# archive to satisfy a linter is how records stop being records.
PROSE_ENFORCED = True

for fp in adr_files():
    text = fp.read_text()
    if adr_readability.is_closed(text):
        continue
    for severity, msg in adr_readability.findings(fp.name, text):
        if severity != "error":
            warnings.append(msg)
        elif PROSE_ENFORCED:
            errors.append(msg)
        else:
            warnings.append(f"[will fail] {msg}")
    s = adr_readability.score(text)
    if s and s["fk"] > 12:
        warnings.append(f"{fp.name}: reading grade {s['fk']} (watch, never gated) — "
                        f"avg sentence {s['avg_sentence']} words")

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
# Fenced blocks are dropped before scanning so their ticks cannot hide later
# paths. A span is only a candidate when it contains `/` — otherwise a stray
# tick (`a`, or a lone `) consumes the pair and the real path after it is
# never seen. Repro: "Run `a` then ` and see `ui/api/_lib/gone.ts` here"
# used to match ['a', ' and see '] and miss gone.ts.
FENCE_RE = re.compile(r"```.*?```", re.DOTALL)
PATH_RE = re.compile(r"`([^`\n]*/[^`\n]*)`")

def extract_path_tokens(text):
    """Backticked path candidates after dropping fenced ``` blocks."""
    return PATH_RE.findall(FENCE_RE.sub("", text))

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
    for tok in dict.fromkeys(extract_path_tokens(fp.read_text())):
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
# there is a forward reference, not a dead one — warn, never fail. Workflows, hooks, and
# `docs/eng-docs/` describe the system as it is today: missing means broken.
hook_dir = ROOT / ".claude" / "hooks"
hook_files = sorted(fp for fp in hook_dir.glob("*") if fp.is_file()) if hook_dir.is_dir() else []
# `.cursor/` is Cursor's entry point, the same class of file as `.claude/hooks/`. Scanned so a
# pointer into AGENTS.md cannot rot in the one tool whose config nothing else checks.
cursor_dir = ROOT / ".cursor"
cursor_files = sorted(fp for fp in cursor_dir.rglob("*")
                      if fp.is_file() and fp.suffix in (".md", ".mdc")) if cursor_dir.is_dir() else []
git_hook_dir = ROOT / ".githooks"
git_hook_files = sorted(fp for fp in git_hook_dir.glob("*") if fp.is_file()) if git_hook_dir.is_dir() else []
wide_files = ([(fp, errors) for fp in sorted((ROOT / ".github" / "workflows").glob("*.yml"))]
              + [(fp, errors) for fp in sorted((ROOT / "docs" / "eng-docs").glob("*.md"))]
              + [(fp, errors) for fp in hook_files]
              + [(fp, errors) for fp in cursor_files]
              + [(fp, errors) for fp in git_hook_files]
              + [(fp, warnings) for fp in sorted((ROOT / "docs" / "plans").glob("*.md"))])
for fp, sink in wide_files:
    raw = fp.read_text()
    if HISTORICAL_RE.search(raw):
        continue  # dated records — they describe a tree that is gone on purpose
    text = FENCE_RE.sub("", raw)
    for tok in dict.fromkeys(extract_path_tokens(raw)):
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

# Doc and plan prose. Same two gates as the ADRs above — over-long sentences and jargon with a
# shorter replacement — but scoped to the files a branch actually changes. `docs/` carries 159
# sentences over the limit today; failing the build over prose nobody touched teaches people to
# ignore the run. Everything outside the diff still reports as a warning, so the backlog stays
# visible. When git cannot name the diff (clean checkout, no `origin/main`) nothing gates.
def changed_paths():
    """Repo-relative paths this branch changes. Empty set when git cannot say."""
    def run(*args):
        try:
            r = subprocess.run(["git", "-C", str(ROOT), "diff", "--name-only", *args],
                               capture_output=True, text=True)
        except OSError:
            return None
        return set(r.stdout.split()) if r.returncode == 0 else None
    # A pull_request build checks out a merge commit, where `HEAD^1 HEAD` is exactly what the PR
    # adds. A local branch has no merge commit, so fall back to the three-dot range.
    # Merging `main` into a long-lived branch also makes a merge commit, and there `HEAD^1 HEAD`
    # is everything `main` changed since the branch point — so a local run gates docs the branch
    # never opened. That is the run being wrong, not the branch: trust CI's.
    parents = subprocess.run(["git", "-C", str(ROOT), "rev-list", "--parents", "-n", "1", "HEAD"],
                             capture_output=True, text=True)
    if parents.returncode == 0 and len(parents.stdout.split()) == 3:
        found = run("HEAD^1", "HEAD")
        if found:
            return found
    return run("origin/main...HEAD") or set()

CHANGED = changed_paths()

for fp in (sorted((ROOT / "docs" / "eng-docs").glob("*.md"))
           + sorted((ROOT / "docs" / "plans").glob("*.md"))):
    raw = fp.read_text()
    if HISTORICAL_RE.search(raw):
        continue  # dated records, same rule as the path checks above
    rel = str(fp.relative_to(ROOT))
    sink = errors if rel in CHANGED else warnings
    for severity, msg in adr_readability.findings(rel, raw):
        (sink if severity == "error" else warnings).append(msg)

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

# Base resolution, in order: GITHUB_BASE_REF (set by Actions on a pull_request) -> origin/main
# -> main. Compare against `git merge-base <base> HEAD`, not the base tip: a two-dot diff
# against the tip would also report files that moved on the base since we branched, which has
# nothing to do with this PR.
#
# FAIL SAFE — if no base resolves, git is unavailable, or the clone is shallow, this rule is
# SKIPPED with a warning and never errors. It has to be that way: every local run on main and
# every shallow CI checkout would otherwise hard-fail on a diff the script simply cannot see,
# and a guard that red-lights when blind gets switched off within a day.

def git(*args):
    """Run a git command in ROOT. Returns stripped stdout, or None if it failed/git is missing."""
    try:
        r = subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, text=True)
    except OSError:
        return None
    return r.stdout.strip() if r.returncode == 0 else None

_DIFF_CACHE = {}

def diff_vs_base():
    """(base_ref, [changed paths]) for this branch vs its merge-base, or (None, reason).

    Shared by the soul-history guard and the staleness check — both need "what does this
    diff actually touch", and resolving it twice would let the two disagree.
    """
    if "v" not in _DIFF_CACHE:
        _DIFF_CACHE["v"] = _resolve_diff()
    return _DIFF_CACHE["v"]

def _resolve_diff():
    if git("rev-parse", "--git-dir") is None:
        return None, "git unavailable"
    if git("rev-parse", "--is-shallow-repository") == "true":
        return None, "shallow clone has no merge-base — set fetch-depth: 0"
    candidates = []
    base_ref = os.environ.get("GITHUB_BASE_REF", "").strip()
    if base_ref:
        candidates.append(f"origin/{base_ref}")
    candidates += ["origin/main", "main"]
    base = next((c for c in candidates if git("rev-parse", "--verify", "--quiet", c + "^{commit}")), None)
    if base is None:
        return None, f"no base branch resolved (tried {', '.join(candidates)})"
    mb = git("merge-base", base, "HEAD")
    if not mb:
        return None, f"no merge-base between {base} and HEAD"
    out = git("diff", "--name-only", f"{mb}..HEAD")
    if out is None:
        return None, f"could not diff {mb[:8]}..HEAD"
    return base, [line for line in out.splitlines() if line]

def changed_paths_vs_base():
    """Repo-relative paths this diff touches, or None when the diff cannot be seen."""
    base, changed = diff_vs_base()
    return set(changed) if base is not None else None

# AGENT-KIT:STRIP-START soul-history-guard-def
# A soul-layer diff must carry a SOUL_HISTORY.md entry. AGENTS.md spells out why this one
# cannot be a grep: a SOUL version change need not touch any path a text scan would look at,
# so the only honest signal is the diff itself.
SOUL_LAYERS = "platform/soul/"
SOUL_HISTORY = "docs/eng-docs/SOUL_HISTORY.md"

def soul_history_guard():
    base, changed = diff_vs_base()
    if base is None:
        return f"soul-history guard skipped: {changed}"
    layers = [f for f in changed if f.startswith(SOUL_LAYERS)]
    if layers and SOUL_HISTORY not in changed:
        errors.append(
            f"soul layer changed ({', '.join(layers)}) but {SOUL_HISTORY} is not in the diff "
            f"vs {base} — add the version entry (AGENTS.md 'Doc upkeep')")
    return None
# AGENT-KIT:STRIP-END

# AGENT-KIT:STRIP-START soul-history-guard-call
skip_reason = soul_history_guard()
if skip_reason:
    warnings.append(skip_reason)
# AGENT-KIT:STRIP-END

# AGENT-KIT:STRIP-START soul-history-lint
# SOUL_HISTORY: lint only post-cutover entries (above `<!-- soul-history-cutover`).
# Soft cap ~12 non-empty lines: Superpower + optional scene + ≤3 bullets + Why/What it cost.
# Archive below the cutover is grandfathered — do not homogenize.
ENTRY_MAX_LINES = 12
CUTOVER_MARK = "<!-- soul-history-cutover"
ENTRY_HEADER_RE = re.compile(r"^##\s+v\d", re.I)  # version entries only — skip "Archive" etc.
SUPERPOWER_RE = re.compile(r"^\*\*Superpower gained:\*\*", re.I)
WHY_RE = re.compile(r"^\*\*(?:Why it mattered|What it cost):\*\*", re.I)
BULLET_RE = re.compile(r"^- ")
BAN_RE = re.compile(
    r"(?:"
    r"§|"                          # section refs
    r"#\d+|"                       # issue / PR numbers
    r"\bPR\s*#?\d+|"
    r"`[^`]+/[^`]+`|"              # backticked paths
    r"\b(?:platform|docs|engine|ui|ios|kdb|user_data|sessions)/[\w./-]+|"
    r"\b[\w-]+\.(?:py|mjs|ts|tsx|js|sh|json)\b"  # scripts / JSON filenames
    r")"
)

def lint_soul_history_entries():
    hist = ROOT / SOUL_HISTORY
    if not hist.exists():
        errors.append(f"{SOUL_HISTORY} missing")
        return
    lines = hist.read_text().splitlines()
    cutover_at = next((i for i, l in enumerate(lines) if CUTOVER_MARK in l), None)
    if cutover_at is None:
        errors.append(
            f"{SOUL_HISTORY}: missing cutover marker `{CUTOVER_MARK}` — refuse to lint the archive")
        return

    entries, cur = [], None
    for i, line in enumerate(lines[:cutover_at], 1):
        if ENTRY_HEADER_RE.match(line):
            if cur is not None:
                entries.append(cur)
            cur = {"start": i, "title": line, "body": []}
        elif cur is not None:
            if line.strip() == "" or line.strip() == "---":
                continue
            cur["body"].append((i, line))
    if cur is not None:
        entries.append(cur)

    if not entries:
        errors.append(f"{SOUL_HISTORY}: no post-cutover version entries found above cutover")
        return

    for ent in entries:
        n = 1 + len(ent["body"])
        if n > ENTRY_MAX_LINES:
            errors.append(
                f"{SOUL_HISTORY}:{ent['start']}: entry has {n} lines (max {ENTRY_MAX_LINES}) — "
                f"{ent['title'][:60]}")
        body_texts = [t for _, t in ent["body"]]
        if not any(SUPERPOWER_RE.match(t) for t in body_texts):
            errors.append(
                f"{SOUL_HISTORY}:{ent['start']}: missing **Superpower gained:** — {ent['title'][:60]}")
        if not any(WHY_RE.match(t) for t in body_texts):
            errors.append(
                f"{SOUL_HISTORY}:{ent['start']}: missing **Why it mattered:** / **What it cost:** — "
                f"{ent['title'][:60]}")
        bullets = sum(1 for t in body_texts if BULLET_RE.match(t))
        if bullets > 3:
            errors.append(
                f"{SOUL_HISTORY}:{ent['start']}: {bullets} bullets (max 3) — {ent['title'][:60]}")
        for ln, text in ent["body"]:
            if BAN_RE.search(text):
                errors.append(
                    f"{SOUL_HISTORY}:{ln}: banned token in entry "
                    f"(path / § / issue# / script / JSON name) — {text[:80]}")

lint_soul_history_entries()
# AGENT-KIT:STRIP-END


# `Verified:` staleness. Docs carry `> Status: Current - Owner: <role> - Verified: YYYY-MM-DD`.
# Only Current docs are re-verified; Historical/Superseded are dated records of a tree that is
# gone on purpose, so they reuse HISTORICAL_RE above and are skipped. A Current doc with no
# parseable date warns rather than fails: missing front matter is a doc-hygiene nit, not a
# reason to red-light someone else's build. An eng-doc with no `> Status:` line at all
# used to opt out of this loop by omission — that is now a warning (never an error).
# `docs/plans/` stay exempt: they are in-flight and often have no header yet.
#
# WHY THE HARD FAIL IS SCOPED TO DOCS THE DIFF TOUCHES
# Every doc in this repo was verified inside one three-week window, so an unscoped 90-day fail
# does not ratchet — it CLIFFS. Measured at the time this was written: on 2026-11-26, 27 docs
# cross 90 days on the same day, and from then on every `docs/**` PR is red until someone
# re-reads all 27, including PRs that touch none of them. A check that red-lights work it has
# no quarrel with gets switched off within a day, which is the same reasoning the soul-history
# guard above uses to skip rather than fail when it cannot see the diff.
#
# So: stale past 90 days AND in this diff -> error, because you are editing a doc you did not
# re-verify, and that is squarely your PR's business. Stale past 90 but untouched -> a loud
# warning, visible on every run, actionable by whoever owns the doc. Past 60 -> warning. If the
# diff cannot be resolved (shallow clone, no base), nothing hard-fails: the same fail-safe.
STALE_WARN_DAYS, STALE_FAIL_DAYS = 60, 90
STATUS_RE = re.compile(r"^>\s*Status:", re.M)
CURRENT_RE = re.compile(r"^>\s*Status:\s*Current\b", re.M)
VERIFIED_RE = re.compile(r"^>\s*Status:.*?\bVerified:\s*(\d{4})-(\d{2})-(\d{2})", re.M)
TODAY = datetime.date.today()

# Reuses the soul guard's base resolution. None -> the diff is unknown, so nothing hard-fails.
changed_docs = changed_paths_vs_base()

for fp in sorted((ROOT / "docs" / "eng-docs").glob("*.md")):
    if not STATUS_RE.search(fp.read_text()):
        warnings.append(f"{fp.relative_to(ROOT)}: no `> Status:` front matter")

for fp in sorted((ROOT / "docs" / "eng-docs").glob("*.md")) + sorted((ROOT / "docs" / "plans").glob("*.md")):
    text = fp.read_text()
    if HISTORICAL_RE.search(text) or not CURRENT_RE.search(text):
        continue  # dated record, or not Current — nothing to re-verify
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
    if age <= STALE_WARN_DAYS:
        continue
    touched = changed_docs is not None and str(rel) in changed_docs
    if age > STALE_FAIL_DAYS and touched:
        errors.append(f"{rel}: Verified: {verified} is {age} days old (>{STALE_FAIL_DAYS}) and this "
                      "diff edits it — re-read it and bump the date, or mark it Historical")
    elif age > STALE_FAIL_DAYS:
        warnings.append(f"{rel}: Verified: {verified} is {age} days old (>{STALE_FAIL_DAYS}) — overdue; "
                        "fails the build on the next PR that edits it")
    else:
        warnings.append(f"{rel}: Verified: {verified} is {age} days old (>{STALE_WARN_DAYS}) — due for a re-read")

for w in warnings:
    print(f"warn: {w}")
if errors:
    print("\nvalidate-kdb FAILED:")
    for e in errors:
        print(f"  - {e}")
    sys.exit(1)
print(f"validate-kdb OK ({len(adr_files())} ADRs)")
