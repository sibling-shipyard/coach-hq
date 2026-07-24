#!/usr/bin/env python3
"""
parity-check.py — before/after behavioral parity for the M0 SOUL split.

The coach must behave identically after SOUL.md is split into A/B/C. A byte diff
can't prove that (Layer B was intentionally reworded into capability contracts),
so we prove it two ways:

  1. RULE INVENTORY (this script). Every mandatory rule / behavior in the
     pre-split baseline (docs/parity/soul-v1-baseline.md, an exact git snapshot
     of SOUL.md v1.0) must still be present in the post-split engine. Each anchor
     below is a behavior that, if dropped, would change how the coach acts.
  2. NEAR-VERBATIM DIFF (manual, for reviewers). Layers A and C were moved
     near-verbatim; diff the baseline's §3-8 against soul/A_identity.md +
     soul/C_athlete.md to confirm no coaching content was lost in the move.

Checks the anchors against the COMPOSED SOUL.md (the actual read path) so this
tests exactly what a runtime boots from.

Usage: parity-check.py [--repo PATH]     # exit 1 if any anchor is missing
"""
import argparse
import os
import re
import sys

# (id, human description, [regex alternatives — at least one must match]).
# Grounded in SOUL.md v1.0 §1-§13. Regexes are lenient on wording (B was
# reworded) but strict on the *behavior* being present.
ANCHORS = [
    # -- Boot (§1) --
    ("boot.sync", "Boot syncs latest committed state first",
     [r"git pull --rebase origin main", r"\bSYNC\b.*latest|latest.*committed"]),
    ("boot.empty_profile", "Empty Athlete Profile triggers First Session Protocol",
     [r"Athlete Profile.*empty|empty.*Athlete Profile"]),
    ("boot.review_activity", "Mandatory activity review before greeting",
     [r"Review new activity", r"catching up, not reporting"]),
    ("boot.freshness_guard", "Freshness guard on stale sync",
     [r"[Ff]reshness guard", r"might be worth hitting Sync"]),
    ("boot.timezone", "Resolve athlete timezone for ambient awareness",
     [r"TZ=.*date|TIME\(.*timezone|resolve.*[Tt]imezone|Timezone.*Athlete Profile"]),
    ("boot.back_pocket", "Data in back pocket, not on clipboard",
     [r"back pocket, not (on|your) .*clipboard"]),
    # -- Guardrails / write authority (§2) --
    ("guard.no_code", "Coach doesn't write code",
     [r"don't write code|You don't write code"]),
    ("guard.direct_to_main", "Coach files commit direct to main, no PR",
     [r"direct to `?main`?.*[Nn]o.*PR|no branch, no PR|direct.*no PR"]),
    ("guard.never_edit_engine", "Never modify SOUL/templates/pipeline/workflows",
     [r"[Nn]ever modify.*templates|Never modify.*SOUL"]),
    ("guard.no_manual_streaks", "Never hand-compute streaks/rates",
     [r"[Nn]ever manually compute|do not compute these manually|hand-compute"]),
    # -- Quests (§9) --
    ("quest.polarity", "default_done vs default_not_done polarity",
     [r"default_done", r"default_not_done"]),
    ("quest.excused_vs_missed", "Excused vs missed arrays, one only",
     [r"missed_dates", r"excused_dates"]),
    ("quest.stamp", "Stamp last_updated_by/at after edits",
     [r"last_updated_by.*coach|last_updated_at"]),
    # -- Rules engine (§10) --
    ("rules.deload", "Deload every 4th week halves sets, keeps intensity",
     [r"[Dd]eload.*4th week|cut sets in half"]),
    ("rules.autoreg", "Fatigue auto-regulation (shoulder/back/legs modifiers)",
     [r"overhead pressing", r"bird-dogs", r"[Ll]egs dead"]),
    ("rules.recovery_class", "Recovery logged as Yoga to classify correctly",
     [r"Yoga.*Recovery|log.*recovery.*Yoga"]),
    # -- Workflows (§11) --
    ("wf.greeting", "Greeting: no day count, no data-first",
     [r"[Nn]o day count", r"Don't open with data|do not mention stats"]),
    ("wf.preworkout", "Pre-workout check reads injury flags before prescribing",
     [r"before prescribing|Pre-Workout Check|Never prescribe.*without checking"]),
    ("wf.sleep_pairing", "Sleep hours land in BOTH state.md table and sleep_log.json",
     [r"sleep_log\.json.*state\.md|Sleep Log table.*sleep_log\.json|pair"]),
    ("wf.eod_checkin", "End-of-day check-in only on explicit close signals",
     [r"explicit clos|goodnight|that'?s it for today"]),
    ("wf.session_files", "Session-file 8-point protocol (session_date/based_on_template)",
     [r"session_date", r"based_on_template"]),
    ("wf.timer_physics", "Timer physics optional fields (prep_secs/both_sides)",
     [r"prep_secs", r"both_sides"]),
    ("wf.exercise_explainer", "Exercise explainer order (what/cue/why/visual)",
     [r"[Mm]ovement cue", r"Exercise Explainer"]),
    # -- Tools (§12) --
    ("tools.query_history", "query_history.py for activity lookups",
     [r"query_history\.py|QUERY_ACTIVITY"]),
    ("tools.regen_questlog", "Regenerate quest_log before commit",
     [r"generate_quest_log\.py|REGENERATE\(quest_log\)"]),
    # -- Commit protocol (§13) --
    ("commit.mandatory", "Mandatory closing ritual / commit protocol",
     [r"Commit Protocol|closing ritual|You don't leave without saving"]),
    ("commit.validate_before_push", "Validate JSON before pushing (no PR gate)",
     [r"validate.*before.*push|VALIDATE.*COMMIT|json\.load\(open"]),
    ("commit.recent_notes", "Always update Recent Session Notes (drop oldest)",
     [r"Recent Session Notes.*oldest|drop.*oldest.*add.*today"]),
    ("commit.interim_save", "Interim autosave after >10 exchanges",
     [r"[Ii]nterim [Ss]ave|10 exchanges"]),
    ("commit.rollback", "Rollback via git checkout of last good state.md",
     [r"git checkout.*state\.md|[Rr]ollback"]),
    # -- Identity / philosophy (§3-6) — the voice must survive the split --
    ("soul.identity", "Coach Phelps identity: process over outcome",
     [r"Process over outcome|most decorated Olympian"]),
    ("soul.core_loop", "Core loop: Validate → Share → Redirect",
     [r"Validate.*Share.*Redirect"]),
    ("soul.not_therapist", "Not a therapist boundary",
     [r"[Nn]ot a therapist"]),
    ("soul.playbook", "Situation playbook scenarios present",
     [r"After a bad session|losing streak|wants to skip"]),
    ("soul.seasons", "Thinks in seasons; Base/Build/Peak framework",
     [r"seasons, not days", r"Base Phase|Build Phase|Peak Phase"]),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=".")
    args = ap.parse_args()
    repo = os.path.abspath(args.repo)

    baseline_path = os.path.join(repo, "docs", "parity", "soul-v1-baseline.md")
    composed_path = os.path.join(repo, "SOUL.md")
    for p in (baseline_path, composed_path):
        if not os.path.exists(p):
            print(f"ERROR: missing {p}")
            sys.exit(2)

    baseline = open(baseline_path).read()
    composed = open(composed_path).read()

    missing_baseline, missing_new = [], []
    for aid, desc, pats in ANCHORS:
        rx = [re.compile(p, re.I | re.S) for p in pats]
        # Sanity: the anchor should actually exist in the baseline (guards against
        # a badly-written regex silently passing).
        if not any(r.search(baseline) for r in rx):
            missing_baseline.append((aid, desc))
        if not any(r.search(composed) for r in rx):
            missing_new.append((aid, desc))

    print(f"Parity: {len(ANCHORS)} rule anchors from SOUL.md v1.0 baseline\n")
    if missing_baseline:
        print("  ANCHOR REGEX ERROR — these did not match the baseline (fix the pattern):")
        for aid, desc in missing_baseline:
            print(f"    ? {aid}: {desc}")
        print()
    if missing_new:
        print("  DROPPED IN SPLIT — present in v1 baseline, absent from new SOUL.md:")
        for aid, desc in missing_new:
            print(f"    ✗ {aid}: {desc}")
    else:
        print("  ✓ every baseline rule anchor is present in the post-split SOUL.md")

    failed = bool(missing_baseline) or bool(missing_new)
    print(f"\n{'FAIL' if failed else 'PASS'} — {len(missing_new)} dropped, "
          f"{len(missing_baseline)} regex error(s)")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
