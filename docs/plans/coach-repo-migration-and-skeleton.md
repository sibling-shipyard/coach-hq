# Migrate coach-skanda, coach-akash, and fix carve-skeleton.mjs

> Status: Current · Owner: Tech Lead · Verified: 2026-08-21

## Branch

Moved here from repo-root `skanda-part3-migration-and-skeleton.md` once parts 1, 2, and 4 of that
4-file plan shipped (docs rewrite, plan-root cleanup, eng/ref-docs triage — PRs #452, #451, #453).
This is the one part of that plan still open. Stacks on top of the current PR chain's tip, same as
everything else in this stack.

**Not a coach-hq PR in the usual sense for the athlete-repo halves.** `carve-skeleton.mjs` (Part
A below) is an HQ PR — stacks on the chain, needs Tech Lead review same as any code change.
Migrating `coach-skanda`/`coach-akash` (Parts B/C) is a direct-commit operation in *those* repos
(per `AGENTS.md`, Coach's own commit target — no coach-hq PR gates that).

## Why — confirmed by direct inspection this session, not assumption

`coach-skanda` and `coach-akash` are both pinned to
`hq_sha=13cc80403fd516e15c923e2d7863ae689d179359` (pre-redesign).

- **`coach-akash` is still on the old schema entirely**: `user_data/coach/state.md`,
  `coach_notes.md`, `opponent_notes.md`, `user_data/ledger/challenge_v2.json`. None of
  `profile.json`/`memory.json`/`injuries.json`/`coach_log.json`/`seasons.json`/`quests.json`/
  `progress.json`/`progressions.json` exist.
- **`coach-skanda` is half-migrated by hand**: it has the new files (`profile.json`,
  `memory.json`, `injuries.json`, `coach_log.json`, `seasons.json`, `quests.json`,
  `progress.json`, `progressions.json`) but all of them sit in `user_data/coach/`, not
  `user_data/ledger/` — PR #430 moved the four ledger files (`seasons`/`quests`/`progress`/
  `progressions`) to `user_data/ledger/`, and `coach-skanda` predates that move. It also still
  carries dead leftovers: `sleep_log.json`, `archive/`.
- **Both repos boot Claude Code from `propagated/SOUL.md`** (`CLAUDE.md` says "Read
  `propagated/SOUL.md` §1 and boot from `user_data/coach/state.md`") — the retired bare-`SOUL.md`
  name (ADR 0022 split it into `SOUL.chat.md`/`SOUL.claude.md`), pointing at a `state.md` that no
  longer exists in the new schema on either repo.
- **`coach-skeleton` (the carved output repo) does not exist locally** — there's no
  `sibling-shipyard/coach-skeleton` checkout to inspect. The real, current source of truth for
  what a fresh carve looks like is `platform/scripts/carve-skeleton.mjs`, and it's confirmed
  broken too: it still writes `STATE_MD_TEMPLATE`/`COACH_NOTES_TEMPLATE`/`challenge_v2.json` (old
  schema) and, per its own header comment and open issue **#358** ("Carve ships no SOUL — a fresh
  repo cannot run BYOB"), ships **no SOUL, no `.claude/`, no `CLAUDE.md`, no `propagated/docs/`**
  at all. Today's carve is worse than either athlete repo — it can't even boot Coach.

Relevant open issues to link, not re-derive: **#358** (carve ships no SOUL), **#327** ("How
updates reach athlete repos" — currently empty body, this migration work is exactly what it
should end up describing), **#378** (the epic these PRs close).

## Part A — fix `carve-skeleton.mjs` (HQ PR, closes #358)

1. Restore composed-SOUL carving: copy `platform/SOUL.claude.md` → the carved repo's `SOUL.md`
   (BYO build only — `SOUL.chat.md` never leaves HQ, per that file's own header comment).
2. Restore `.claude/` + root `CLAUDE.md` so Claude Code boots as Coach in a fresh carve — mirror
   whatever `coach-skanda`/`coach-akash`'s current `.claude/hooks/session-start.sh` +
   `.claude/settings.json` + `CLAUDE.md` do today, but fix the `CLAUDE.md` boot line to point at
   `SOUL.claude.md` (not the retired `propagated/SOUL.md` name) and drop the `state.md` boot
   reference.
3. Restore `propagated/docs/` — `current-week-contract.md`, `pipeline-tools.md`,
   `timer-state-machine.md` (per #358's own scope; the other ref-docs aren't needed).
4. Replace `STATE_MD_TEMPLATE`/`COACH_NOTES_TEMPLATE`/`CHALLENGE_V2_TEMPLATE` +
   `writeText(..., "user_data/coach/state.md", ...)`/`coach_notes.md`/`challenge_v2.json` (lines
   ~464-480 today) with empty/seed templates for the current schema: `profile.json`,
   `memory.json`, `injuries.json`, `coach_log.json` in `user_data/coach/`; `seasons.json`,
   `quests.json`, `progress.json`, `progressions.json` in `user_data/ledger/` (per PR #430's
   move — verify against `ui/api/coach-chat/_lib/coachQuestFiles.ts`'s `*_PATH` constants and
   `coachMemoryFiles.ts`'s, since those are the live source of truth for shape + path today, not
   this plan file).
5. Verification: run the carve script against a scratch output dir, diff the result against
   `coach-skanda`'s directory *shape* (not content) to confirm every current-schema file is
   present and nothing old-schema is written; confirm a Claude Code session in the scratch carve
   actually boots as Coach (reads `AGENTS.md` routing → `SOUL.claude.md`, not a dead-end).

## Part B — migrate `coach-akash` (direct commits in that repo, full migration from old schema)

Old → new mapping, to be nailed down precisely by the agent against the *actual* field-level
shapes in `ui/api/coach-chat/_lib/coach*Files.ts` (this plan names the files, not every field):

- `user_data/coach/state.md` → split across `profile.json` + `memory.json` + `injuries.json` +
  `coach_log.json` (state.md's prose sections map roughly 1:1 to these per
  `coach-redesign-part1-memory.md`, already shipped as #407 — reread that doc, or its equivalent
  content folded into the survivor doc if part 2 already merged it, for the exact field mapping
  the agent that built #407 used; don't reinvent it).
- `user_data/coach/coach_notes.md` → folded into `coach_log.json` rows (per #322).
- `user_data/ledger/challenge_v2.json` → `seasons.json` + `quests.json` + `progress.json` +
  `progressions.json` in `user_data/ledger/` (per `coach-redesign-part2-ledger.md`, shipped as
  #413/#430 — same instruction: reread it, or its survivor-doc equivalent, for the real mapping).
- `opponent_notes.md` — check whether anything still reads this (grep
  `ui/api/coach-chat/_lib/` and `platform/soul/`); if dead, drop it; if live, it's out of scope
  for this schema migration and should carry over unchanged.
- Update `CLAUDE.md`/boot files to the fixed carve-skeleton shape from Part A.
- `.coach-engine-version` bump to the current HQ sha post-migration.

## Part C — finish `coach-skanda`'s partial migration (direct commits, smaller diff)

- Move `seasons.json`, `quests.json`, `progress.json`, `progressions.json` from
  `user_data/coach/` → `user_data/ledger/` (git mv, preserve history).
- Remove dead leftovers: `sleep_log.json` (sleep tracking was dropped, confirm nothing reads it
  before deleting), `archive/` (folded into `coach_log.json` per #359 — confirm its contents are
  actually represented in `coach_log.json` before deleting, don't silently lose data if the
  by-hand migration missed something).
- Same `CLAUDE.md`/boot-file fix as Part B.
- `.coach-engine-version` bump.

## Part D — close out the epic

Once Parts B/C land: check off #322, #359, #362, #360, #316, #361 in #378 if each is genuinely
now true on both repos (verify, don't assume from the epic's own table) and close #378 itself
once verified. Comment `#327` ("How updates reach athlete repos") with a link to what this
migration plan actually did, since that issue's body is currently empty and this is real prior
art for whatever its real design turns out to be — don't close it, it's asking a broader question
than this one-time migration answers.

## Verification for the whole file

After Parts A-C, boot Coach (Claude Code) in both `coach-skanda` and `coach-akash` and confirm a
real turn (greet, one ordinary exchange) writes to the right new-schema files with no crash;
confirm `platform/scripts/carve-skeleton.mjs`'s scratch output also boots clean.

**This is data-loss-risk work** — real athlete history in `state.md`/`challenge_v2.json`. The
agent should back up (`git log`/tag or a throwaway branch) before rewriting either repo's
`user_data/`, and should show a diff of the field mapping before committing, not just commit and
report done.
