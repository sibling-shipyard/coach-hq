# Plan: second live coach-chat testing round, against all 5 real repos

> Status: Plan · Owner: Tech Lead · Created: 2026-09-16 · Tracking: #1105

## Context

This is the second live-testing round for coach-chat, following the 2026-09-15 pass
(`test-results/2026-09-15.md`). It only makes sense to run once
`docs/plans/coach-chat-test-harness-hardening.md`'s Track A, B, and C PRs have all merged - this
doc assumes that's done. Do not start this round early: running it against the un-hardened
harness just reproduces the same false positives the hardening doc exists to fix (see that doc's
Context section for the F1/B1/B2 findings this round is meant to avoid repeating).

Tracking issue: **#1105**. This doc's finishing PR (the day-doc PR, Step 3 below) closes it with
`Fixes: #1105` - it's the last piece of the issue's "Done when" list. Every prerequisite PR from
the hardening doc uses `Refs: #1105` instead.

## Prerequisites (confirm before starting)

1. All of `coach-chat-test-harness-hardening.md`'s PRs (A1, A2, A2b, A3, A4, A5, B1-B5, C1-C3)
   are merged to `main` and green.
2. `run-simulation-suite.ts --dry-run --all-repos` runs cleanly and shows the expected
   `"skipped-precondition"` results for the known-unmet cases (e.g. `quest-event` on
   `prateek`/`date2022`, which have no real habit quest).

## Step 1 - full live pass

Seeding is now automatic. `current_week.json` used to only get real planned sessions from a
manually-run Weekly Kick-off Ritual conversation someone had to remember to do ahead of time.
The hardening doc's A2b gives `ambiguous-contradiction` a real seed recipe instead, so every repo
that doesn't already have a live week gets one seeded honestly, per repo, as part of the pass
itself. No manual pre-seeding step is needed before this round starts.

1. Run the full simulation suite plus the formalized all-5-repo pass from A3 -
   `run-simulation-suite.ts --all-repos`, or the equivalent flag combination A3 ships - against
   all 5 real athlete repos. Use a scratch branch per repo; never reset a real athlete repo
   (`coach-chat-testing.md`'s Type 3 manual-testing conventions).
2. Watch for `"skipped-precondition"` and `"seed-failed"` results. Confirm each
   `"skipped-precondition"` has a legitimate reason - an unseedable precondition, or a case where
   a different repo already matches naturally. Treat any `"seed-failed"` as a real result worth
   investigating, not noise to ignore.
3. Read every non-obvious result by hand before trusting the harness's own pass/fail - same
   standard as 2026-09-15. The harness's scoring is better than it was, but it still isn't a
   substitute for a human reading the actual diff on anything surprising.

## Step 2 - verify the rollover fix live

1. Pick a real repo with a currently-stale week frame (check via `repoDataProfile.ts` from A1, or
   by reading `current_week.json` directly).
2. Send one ordinary turn against it.
3. Confirm `current_week.json`'s frame (week id / dates) advanced as part of that turn's commit,
   folded in alongside whatever else that turn wrote.
4. The fix may have already self-healed every repo on incidental earlier turns during Step 1, so
   no repo may have a stale frame left by the time this step runs. If so, note that in the
   day-doc rather than forcing an artificial stale state. A fix that can't be caught in the act
   because it already healed everything is still evidence it's working - just weaker evidence
   than an explicit before/after check.

## Step 3 - produce the day-doc and close the issue

1. Write `test-results/<date>.md` in house style (`kdb/test-doc-style.md`), same structure as
   2026-09-15's: per-run sections, model/cost tables, pass/fail per scenario×repo.
2. Open the PR with `Fixes: #1105` - this is the PR that closes the tracking issue, since "a
   second live-testing round runs... and a new day-doc is produced" is the issue's last
   uncompleted "Done when" criterion.
3. Get explicit merge permission before merging - standing rule, not implied by green CI.

## Verification

- Every scenario×repo combination in the pass gets a real pass/fail/skipped-precondition/
  seed-failed result, not a silent gap.
- `ambiguous-contradiction` produces an actual `current_week.json` reconcile write against real
  planned sessions for the first time (previously always fell back to a different write).
- The rollover fix is confirmed live per Step 2.
- Day-doc reviewed against `kdb/test-doc-style.md` before merge, rated 1-5 on ease-of-reading per
  `AGENTS.md`'s doc-feedback rule.
