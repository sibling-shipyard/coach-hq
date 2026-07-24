#!/usr/bin/env python3
"""
validate-repo.py — the shared data-contract validator (the M0 "safety net").

Both runtimes pass through this: a BYO Claude Code session runs it as the
VALIDATE capability before COMMIT, and CI (.github/workflows/validate-data.yml)
runs it on the direct-to-main push as the backstop. Same gate, either author.

GRADUATED severity (see docs/soul-split-m0.md · ADR kdb/decisions/0004):
  ERROR   -> genuinely universal, load-bearing contracts that BOTH real repos
             (Akash, Skanda) already satisfy. Breaking one would break the
             dashboard build or boot. Non-zero exit.
  WARNING -> real drift worth surfacing (e.g. state.md section divergence,
             sleep-log pairing gaps, main_quest missing count_target fields)
             that is PRE-EXISTING in live repos. Surfaced, does not fail —
             so extending the validator never turns a live repo red on a
             false positive.

Usage:
  validate-repo.py [--repo PATH] [--strict] [--format {plain,github}] [--staged]
    --repo PATH   repo root to validate (default: cwd)
    --strict      treat WARNINGs as errors (used by the "broken" fixture test)
    --format      plain (default) or github (::error:: / ::warning:: annotations)
    --staged      alias for a full data-file validation (the Claude Code
                  VALIDATE binding); same checks, kept for contract wording.
"""
import argparse
import glob
import json
import os
import re
import sys

# ---- normalized state.md section keys -------------------------------------
# Match by normalized prefix (strip "## " and any " *(...)" annotation).
CORE_REQUIRED_SECTIONS = [  # ERROR if missing — both real repos have these
    "recent session notes",
    "active injury flags",
    "learned patterns",
]
TEMPLATE_SECTIONS = [  # WARNING if missing — referenced by boot/engine, but drifted
    "athlete profile",
    "sleep log",
]
# NB: the weekly plan is NOT a state.md section — it lives in training/current_week.json
# (see docs/current-week-contract.md), validated by check_current_week below.
SEASON_SECTION_ALIASES = [  # WARNING if none present
    "current season",
    "current season / blocks",
    "current phase",
    "current phase / block context",
]

ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
DATE_IN_LINE = re.compile(r"(\d{4}-\d{2}-\d{2})")


class Report:
    def __init__(self, fmt="plain"):
        self.errors = []
        self.warnings = []
        self.fmt = fmt

    def error(self, msg):
        self.errors.append(msg)

    def warn(self, msg):
        self.warnings.append(msg)

    def emit(self, strict):
        for w in self.warnings:
            if self.fmt == "github":
                print(f"::warning::{w}")
            else:
                print(f"  WARN  {w}")
        for e in self.errors:
            if self.fmt == "github":
                print(f"::error::{e}")
            else:
                print(f"  ERROR {e}")
        failed = bool(self.errors) or (strict and bool(self.warnings))
        n_e, n_w = len(self.errors), len(self.warnings)
        print(f"\n{'FAIL' if failed else 'PASS'} — {n_e} error(s), {n_w} warning(s)"
              + (" [strict: warnings fail]" if strict else ""))
        return 0 if not failed else 1


# ---- helpers ---------------------------------------------------------------
def load_json(path, rep, label=None):
    label = label or path
    try:
        with open(path) as fh:
            return json.load(fh)
    except FileNotFoundError:
        return None
    except json.JSONDecodeError as e:
        rep.error(f"{label}: invalid JSON — would break the dashboard build ({e})")
        return None


def section_keys(state_text):
    keys = []
    for line in state_text.splitlines():
        if line.startswith("## "):
            k = line[3:].strip().lower()
            k = re.split(r"\s*\*?\(", k)[0].strip()  # drop " *(rolling …)" / "(…)"
            keys.append(k)
    return keys


# ---- checks ----------------------------------------------------------------
def check_state_md(repo, rep):
    path = os.path.join(repo, "training", "state.md")
    if not os.path.exists(path):
        rep.error("training/state.md: missing (Layer C living memory required)")
        return
    text = open(path).read()
    keys = section_keys(text)

    def has(prefixes):
        return any(any(k.startswith(p) for k in keys) for p in prefixes)

    for req in CORE_REQUIRED_SECTIONS:
        if not any(k.startswith(req) for k in keys):
            rep.error(f"training/state.md: missing required section '## {req.title()}'")
    for opt in TEMPLATE_SECTIONS:
        if not any(k.startswith(opt) for k in keys):
            rep.warn(f"training/state.md: section '## {opt.title()}' not found "
                     f"(boot/engine reference it; may be repo drift)")
    if not has(SEASON_SECTION_ALIASES):
        rep.warn("training/state.md: no season/phase/block section found "
                 "(one of Current Season / Current Phase expected)")
    return text


def check_challenge(repo, rep):
    path = os.path.join(repo, "training", "challenge_v2.json")
    d = load_json(path, rep)
    if d is None:
        if not os.path.exists(path):
            rep.error("training/challenge_v2.json: missing (single source of quest truth)")
        return
    # ERROR: universal fields present in both real repos
    for f in ("version", "last_updated_by", "last_updated_at"):
        if f not in d:
            rep.error(f"training/challenge_v2.json: missing required field '{f}'")
    mq = d.get("main_quest")
    if not isinstance(mq, dict):
        rep.error("training/challenge_v2.json: 'main_quest' must be an object")
    else:
        for f in ("id", "name", "type"):
            if f not in mq:
                rep.error(f"training/challenge_v2.json: main_quest missing '{f}'")
        # WARNING: count_target-specific fields (Akash's main_quest is a different type)
        if mq.get("type") == "count_target":
            for f in ("target", "count_from", "count_pattern"):
                if f not in mq:
                    rep.warn(f"training/challenge_v2.json: count_target main_quest missing '{f}'")
    quests = d.get("quests")
    if not isinstance(quests, list):
        rep.error("training/challenge_v2.json: 'quests' must be a list")
    else:
        for i, q in enumerate(quests):
            if not isinstance(q, dict):
                rep.error(f"training/challenge_v2.json: quests[{i}] must be an object")
                continue
            for f in ("id", "name", "type", "status"):
                if f not in q:
                    rep.error(f"training/challenge_v2.json: quests[{i}] ('{q.get('id','?')}') missing '{f}'")
            # WARNING: daily_streak needs a polarity to interpret its arrays
            if q.get("type") == "daily_streak" and "polarity" not in q:
                rep.warn(f"training/challenge_v2.json: quests[{i}] daily_streak missing 'polarity'")
    # WARNING: structural variance (challenge{} block vs season/phase top-level)
    if "challenge" not in d and not ("season" in d or "phase" in d):
        rep.warn("training/challenge_v2.json: neither a 'challenge' block nor 'season'/'phase' "
                 "present (season-structure drift across repos)")


def check_sessions(repo, rep):
    for f in sorted(glob.glob(os.path.join(repo, "sessions", "*.json"))):
        rel = os.path.relpath(f, repo)
        d = load_json(f, rep, label=rel)
        if d is None:
            continue
        if not isinstance(d, dict):
            rep.error(f"{rel}: session must be a JSON object")
            continue
        for field in ("session_date", "based_on_template", "phases"):
            if field not in d:
                rep.error(f"{rel}: missing required field '{field}'")
        if "session_date" in d and not ISO_DATE.match(str(d["session_date"])):
            rep.error(f"{rel}: session_date '{d['session_date']}' is not YYYY-MM-DD")
        if "phases" in d and not isinstance(d["phases"], list):
            rep.error(f"{rel}: 'phases' must be a list")


def check_sleep(repo, rep, state_text):
    path = os.path.join(repo, "training", "sleep_log.json")
    d = load_json(path, rep)
    if d is None:
        if not os.path.exists(path):
            rep.warn("training/sleep_log.json: missing (created on first sleep log)")
        return
    if not isinstance(d, list):
        rep.error("training/sleep_log.json: must be a JSON array")
        return
    json_dates = set()
    for i, e in enumerate(d):
        if not isinstance(e, dict):
            rep.error(f"training/sleep_log.json[{i}]: entry must be an object")
            continue
        date = e.get("date") or e.get("night") or e.get("day")
        if not date:
            rep.error(f"training/sleep_log.json[{i}]: entry missing a date field")
        else:
            json_dates.add(str(date)[:10])
        if not any(k in e for k in ("hours", "sleep", "duration", "sleep_hours")):
            rep.warn(f"training/sleep_log.json[{i}]: entry has no hours/sleep field")
    # WARNING: pairing — dates in state.md Sleep Log table but not in the json
    if state_text:
        table_dates = set()
        in_sleep = False
        for line in state_text.splitlines():
            if line.startswith("## "):
                in_sleep = line[3:].strip().lower().startswith("sleep log")
                continue
            if in_sleep and line.lstrip().startswith("-"):
                m = DATE_IN_LINE.search(line)
                if m:
                    table_dates.add(m.group(1))
        missing = sorted(table_dates - json_dates)
        if missing:
            rep.warn(f"sleep-log pairing: {len(missing)} date(s) in state.md Sleep Log table "
                     f"absent from sleep_log.json (e.g. {', '.join(missing[:3])}"
                     f"{'…' if len(missing) > 3 else ''}) — §13 requires both updated together")


def check_current_week(repo, rep):
    """training/current_week.json — the weekly-plan artifact (schema v1).
    ui/scripts/validate-current-week.mts is the authority; this is a light,
    node-free fallback so the shared gate catches gross breakage too."""
    path = os.path.join(repo, "training", "current_week.json")
    d = load_json(path, rep, label="training/current_week.json")
    if d is None:
        return  # optional — absent is fine (unavailable state)
    if not isinstance(d, dict):
        rep.error("training/current_week.json: must be a JSON object")
        return
    if d.get("schema_version") != 1:
        rep.warn(f"training/current_week.json: schema_version is {d.get('schema_version')!r}, expected 1")
    ds = d.get("data_status")
    if ds not in ("placeholder", "draft", "live"):
        rep.error(f"training/current_week.json: data_status {ds!r} not in placeholder|draft|live")
    for f in ("timezone", "days"):
        if f not in d:
            rep.warn(f"training/current_week.json: missing '{f}'")
    if isinstance(d.get("days"), list) and len(d["days"]) not in (0, 7):
        rep.warn(f"training/current_week.json: 'days' has {len(d['days'])} entries, expected 7")
    # A live week must carry a coach_read (contract: required when live).
    if ds == "live" and not d.get("coach_read"):
        rep.error("training/current_week.json: data_status=live requires a non-null coach_read")


def check_analytics(repo, rep):
    """training/analytics_snapshot.json is auto-generated and dashboard-consumed —
    if present it must at least parse."""
    path = os.path.join(repo, "training", "analytics_snapshot.json")
    load_json(path, rep, label="training/analytics_snapshot.json")


def check_soul_drift(repo, rep):
    """Engine-repo only: SOUL.md must equal compose(A,B,C)."""
    soul_dir = os.path.join(repo, "soul")
    compose = os.path.join(repo, "scripts", "compose-soul.mjs")
    if not (os.path.isdir(soul_dir) and os.path.exists(compose)):
        return  # instance repo — no layer sources, nothing to check
    import subprocess
    r = subprocess.run(["node", compose, "--check"], cwd=repo,
                       capture_output=True, text=True)
    if r.returncode != 0:
        rep.error("SOUL.md is out of date with soul/*.md — run `node scripts/compose-soul.mjs`")


def check_schema_version_constants(repo, rep):
    """Engine/UI repo only: producer SCHEMA_VERSION must equal consumer SUPPORTED_SCHEMA_VERSION."""
    prod = os.path.join(repo, "ui", "scripts", "build-data.mjs")
    cons = os.path.join(repo, "ui", "client", "src", "hooks", "useRepoData.ts")
    if not (os.path.exists(prod) and os.path.exists(cons)):
        return
    def grab(path, name):
        m = re.search(rf"{name}\s*=\s*(\d+)", open(path).read())
        return int(m.group(1)) if m else None
    p = grab(prod, "SCHEMA_VERSION")
    c = grab(cons, "SUPPORTED_SCHEMA_VERSION")
    if p is not None and c is not None and p != c:
        rep.error(f"schema_version mismatch: build-data.mjs SCHEMA_VERSION={p} but "
                  f"useRepoData SUPPORTED_SCHEMA_VERSION={c} (see docs/aggregate-schema.md)")


def main():
    ap = argparse.ArgumentParser(description="Validate a coach instance/engine repo's data contracts")
    ap.add_argument("--repo", default=".")
    ap.add_argument("--strict", action="store_true")
    ap.add_argument("--format", choices=["plain", "github"], default="plain")
    ap.add_argument("--staged", action="store_true", help="full data-file validation (VALIDATE binding)")
    args = ap.parse_args()

    repo = os.path.abspath(args.repo)
    rep = Report(fmt=args.format)
    print(f"Validating {repo}")

    state_text = check_state_md(repo, rep)
    check_challenge(repo, rep)
    check_sessions(repo, rep)
    check_sleep(repo, rep, state_text)
    check_current_week(repo, rep)
    check_analytics(repo, rep)
    check_soul_drift(repo, rep)
    check_schema_version_constants(repo, rep)

    sys.exit(rep.emit(strict=args.strict))


if __name__ == "__main__":
    main()
