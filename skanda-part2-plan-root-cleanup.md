# Part 2 — clean up root plan files and BACKLOG.md

## Branch

Stacks after part 1's tip.

## Why

11 `coach-redesign-partN-*.md` files sit in the repo root, several already fully shipped (parts
1-3, 8-11 correspond to merged PRs). `BACKLOG.md` has stale/resolved items mixed with live ones.
This repo's own plan-file convention has drifted — per `docs/eng-docs/README.md`'s "Reference vs.
plan" table, `docs/plans/` is delete-on-ship, but these `coach-redesign-partN-*.md` files live in
repo root instead and were never deleted once shipped.

## Step 1 — triage the 11 root files against merged PRs

For each, confirm via `gh pr list --state merged` + reading the file whether its scope is fully
shipped:

- `coach-redesign-part1-memory.md` (#407), `coach-redesign-part2-ledger.md` (#413/#430),
  `coach-redesign-part3-rollout.md` (#420), `coach-redesign-part8-pr1-coach-log-window.md`
  (#437), `coach-redesign-part9-pr2-generators-and-insights.md` (#439),
  `coach-redesign-part10-pr3-wire-insights.md` (#443),
  `coach-redesign-part11-pr4-soul-and-prompt-rebuild.md` (#445/#446) — all look fully shipped
  from PR history as of this session; **confirm by reading each file's own "Done when" section
  against the actual merged diff**, don't just trust the number match, then delete.
- `coach-redesign-part4b-fsp-reliability.md` — check against #431/#432/#434 the same way; likely
  shippable.
- `coach-redesign-part5-wiring-plan.md`, `coach-redesign-part6-not-wired-in.md`,
  `coach-redesign-part7-prompting.md` — check whether these were superseded by later work
  (#445/#446/#447/#448 touched prompting and wiring extensively) or are still open scope; fold
  any still-live item into one of the survivor doc(s) below rather than deleting real unfinished
  work.

**Fold whatever's still genuinely open** (from any of the 11) into **at most 2 files** — propose
`docs/plans/coach-chat-open-items.md` (small, active work items). Keep it to 1 file unless the
surviving content genuinely splits into two unrelated concerns, in which case name the second by
its actual topic, not a generic "part2".

## Step 2 — `BACKLOG.md`

Re-check each of its 5 items against current code (its own stated practice: "delete each line
once it's actually re-checked/fixed") and fold whatever's still real into whichever survivor file
from Step 1 makes sense, then delete `BACKLOG.md`. From a quick read this session:
- Item 1 (`coach_since` stamping dead) is very likely resolved by ADR 0018's later work — verify,
  don't assume.
- Item 5 (decompose `handle()`) is done (#447).
- Items 2/3 (reasoning-field strip) were already flagged declined-not-built in prior review —
  confirm that's still the call and drop them.
- Item 4 (route consolidation, `coach-chat`/`coach-chat-context`/`coach-chat-profile-status` →
  catch-all) is still real P2 — carry it forward into the survivor doc.

## Step 3 — READMEs

Audit every `README.md` in the repo (`find . -name README.md -not -path "*/node_modules/*"`)
against current code, not just the ones already known-stale. At minimum, confirmed candidates
needing updates as of this session:
- Repo-root `README.md` — quickstart and file-reference table still cite the old schema.
- `ui/api/coach-chat/README.md` — its `_lib/` table is missing newer files:
  `coachQuestFiles.ts`, `coachWeekFiles.ts`, `coachWorkoutFiles.ts`, `fspWrites.ts`,
  `onboardingWrites.ts`, `workoutSchema.ts`, `turnWrites/`.

Add a README to any folder that's grown complex enough to need one and doesn't have one yet —
`ui/api/coach-chat/_lib/turnWrites/` already has one (good precedent to match). Judgment call on
which folders qualify; don't add READMEs everywhere reflexively.

## Verification

Doc-only PR. `node kdb/scripts/validate_kdb.py` clean. Spot-check a handful of claims in the
rewritten root `README.md` against actual current file paths before calling it done.
