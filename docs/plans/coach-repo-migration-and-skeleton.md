# Migrate coach-skanda, coach-akash, and fix carve-skeleton.mjs

> Status: Current · Owner: Tech Lead · Verified: 2026-08-22

## Branch

Moved here from repo-root `skanda-part3-migration-and-skeleton.md` once parts 1, 2, and 4 of that
4-file plan shipped (docs rewrite, plan-root cleanup, eng/ref-docs triage — PRs #452, #451, #453).
This is the one part of that plan still open. Stacks on top of the current PR chain's tip, same as
everything else in this stack.

**Not a coach-hq PR in the usual sense for the athlete-repo halves.** `carve-skeleton.mjs` (Part
A below) is an HQ PR — stacks on the chain, needs Tech Lead review same as any code change.
Migrating `coach-skanda`/`coach-akash` (Part B) is a direct-commit operation in *those* repos
(per `AGENTS.md`, Coach's own commit target — no coach-hq PR gates that).

## Why — confirmed by direct inspection this session, not assumption

`coach-skanda` and `coach-akash` are both pinned to
`hq_sha=13cc80403fd516e15c923e2d7863ae689d179359` (pre-redesign), and **both `main` branches are
still on the old schema entirely** — `user_data/coach/state.md`, `coach_notes.md`,
`user_data/ledger/challenge_v2.json`. None of `profile.json`/`memory.json`/`injuries.json`/
`coach_log.json`/`seasons.json`/`quests.json`/`progress.json`/`progressions.json` exist on either
`main`. (An earlier version of this doc claimed `coach-skanda` was "half-migrated by hand" — that
was wrong, a read of a scratch branch's working tree mistaken for `main`'s real state. Corrected
2026-08-22, see "Migration scripts already exist" below for what that scratch branch actually
was.)

- `coach-akash` also has `opponent_notes.md`, which `coach-skanda` doesn't — see "Files the
  scripts don't touch" below.
- **Both repos boot Claude Code from `propagated/SOUL.md`** (`CLAUDE.md` says "Read
  `propagated/SOUL.md` §1 and boot from `user_data/coach/state.md`") — the retired bare-`SOUL.md`
  name (ADR 0022 split it into `SOUL.chat.md`/`SOUL.claude.md`), pointing at a `state.md` that no
  longer exists once this migration lands.
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

## Migration scripts already exist — use them, don't hand-edit

`ui/scripts/migrate-coach-memory-part1.mjs`, `-part2.mjs`, `-part3.mjs` already do this exact
migration, each with a docstring saying "run once, on a scratch branch, never against main
directly":

- **Part 1** — `state.md` + `coach_notes.md` + `rolling_state.json` → `profile.json` +
  `memory.json` + `injuries.json` + `coach_log.json` in `user_data/coach/`. Deletes the three old
  files.
- **Part 2** — `user_data/ledger/challenge_v2.json` → `seasons.json` + `quests.json` +
  `progress.json` + `progressions.json` in `user_data/ledger/`. Deletes `challenge_v2.json` and
  `user_data/coach/archive/seasons/`. Own docstring flags a real limitation: it migrates only the
  **current** season — past seasons under `archive/seasons/` are not replayed into
  `seasons.json`/`progress.json`; a retired season just gets a row in `seasons[]`, no daily
  history. Accept that gap or reconstruct it by hand later — not this script's job.
- **Part 3** — smaller field-level fixups to `chat_history.json` (adds `_meta`, drops
  `ageLabel`/`status`/`dayOffset` per thread) and `current_week.json` (drops a few dead fields,
  adds `trace_id`). Idempotent — safe to run twice.

**Already proved out once.** `coach-skanda`'s local checkout has a branch
(`core/final-verification`, one commit ahead of `main`) that's exactly this migration's output —
clearly produced by running these scripts, per the memory guidance to verify coach-chat changes on
a scratch branch before calling anything done. That branch predates recent schema tweaks though
(don't reuse it) — rerun the scripts fresh off current `main` for the real migration.

**Decision: script, not hand.** ~18 months of real training/injury/season history across two
people is exactly where hand-transcription introduces silent mistakes. The scripts exist, are
already scoped to scratch-branch-only use, and already proved out once on real data. Rerun them
fresh, diff the result by hand before committing (the scripts don't touch git — review is a
separate, deliberate step), then PR.

### Files the scripts don't touch

Parked, don't delete or hand-migrate any of these three as part of this pass — decision deferred
to **#454** ("Athlete-repo leftovers," supersedes the now-closed #265):

- **`opponent_notes.md`** (`coach-akash` only) — none of the three scripts reference it. Leave in
  place untouched.
- **`sleep_log.json`** (both repos) — sleep tracking was dropped from the new schema; nothing
  reads it today, but it stays for now.
- **Archived seasons** (`user_data/coach/archive/seasons/`) — Part 2's script only migrates the
  *current* season; past seasons stay in the old archive shape, untouched, not replayed into
  `seasons.json`/`progress.json`. Keep the archive directory as-is.

`opponent_notes.md`/`sleep_log.json`/archived-seasons aside, everything else under `user_data/`
the scripts don't name (activity history, workout templates, `reference/`) is untouched by
design — this migration is schema-shape only, not a full repo rewrite.

### Leftover coach-notes — capture what the new schema doesn't

`coach_notes.md` (and any prose in `state.md`) likely holds real coaching context that
`profile.json`/`memory.json`/`injuries.json`/`coach_log.json` have no field for — the old files
were free text, the new ones are structured. Don't let that information silently vanish on
delete. Per repo, before deleting `state.md`/`coach_notes.md`: read them, diff against what the
new schema actually captures, and write whatever's not represented into a new
`user_data/coach/leftover_coach_notes.md` — plain prose, no schema, just "this was in the old
notes and has nowhere to live yet." This is a new file this migration creates, not one of the
four new-schema files.

### BYOB stays — both SOULs get verified, not both shipped everywhere

Confirmed direction (supersedes #265, which wanted these files *deleted*): both athlete repos
keep working BYOB (terminal Claude Code) access. That means `SOUL.claude.md`, `.claude/`, and
root `CLAUDE.md` get fixed to boot correctly (see Part B step 7), not removed.

`SOUL.chat.md` is different — it never leaves HQ (its own header comment, ADR 0022) and is read
directly by the hosted coach-chat backend, not from the athlete repo. So "new users see both
Claude and in-app Gemini, for FSP and normal chat" is already true structurally once
`SOUL.claude.md` boots correctly — there's nothing to carve or copy for the Gemini/hosted side.
Verify, don't build: after migration, confirm (a) a Claude Code session in each repo boots as
Coach via the fixed `CLAUDE.md` → `SOUL.claude.md`, and (b) the hosted coach-chat app still
serves both repos normally (it never depended on repo content for this).

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

## Part B — migrate both athlete repos (direct commits, one PR per repo, script-driven)

Both `coach-skanda` and `coach-akash` need the identical procedure — neither is ahead of the
other, per the corrected "Why" section above. Do both, same steps, separately (separate branches,
separate PRs, separate review — don't let one repo's diff hide inside the other's).

**Per repo:**

1. `git pull --rebase origin main` (or plain `git pull`, no local commits expected) — start from
   the real current `main`, not a stale local checkout or the old `core/final-verification`
   scratch branch.
2. Create a new branch (naming per that repo's own convention — check its recent branch names,
   this plan doesn't assume coach-hq's `.github/CONVENTIONS.md` applies verbatim to athlete
   repos).
3. Back up first: tag the pre-migration commit or note its SHA before running anything, in
   addition to the branch itself being a natural rollback point.
4. Before running the scripts: read `state.md`/`coach_notes.md`, diff against the new schema's
   actual fields, and draft `user_data/coach/leftover_coach_notes.md` per "Leftover coach-notes"
   above — do this first, while the old files still exist to read from.
5. Run the three scripts in order, pointed at the repo checkout:
   ```
   node ui/scripts/migrate-coach-memory-part1.mjs <path-to-repo>
   node ui/scripts/migrate-coach-memory-part2.mjs <path-to-repo>
   node ui/scripts/migrate-coach-memory-part3.mjs <path-to-repo>
   ```
6. `opponent_notes.md`, `sleep_log.json`, and archived seasons — leave untouched, per "Files the
   scripts don't touch" above (#454 tracks the deferred decision on these, not this migration).
7. **Show the full diff before committing** — every field mapping, not just a file-count summary.
   This is the real athlete's training/injury/season history; a silent value-transposition here is
   the actual risk, not a missing file.
8. Update `CLAUDE.md`/boot files to the fixed carve-skeleton shape from Part A (do Part A first if
   sequencing allows, so both repos copy the corrected boot files rather than hand-writing them
   twice). This restores/fixes BYOB, it does not remove it — see "BYOB stays" above.
9. `.coach-engine-version` bump to the current HQ sha.
10. Commit, push, open the PR in that repo (per `AGENTS.md`, this is Coach's own commit target in
    athlete repos — no coach-hq PR gates it, but it still gets a real PR + diff review before
    merging to that repo's `main`, same discipline as everything else in this stack).

## Part C — close out the epic

Once Part B lands for both repos: check off #322, #359, #362, #360, #316, #361 in #378 if each is genuinely
now true on both repos (verify, don't assume from the epic's own table) and close #378 itself
once verified. Comment `#327` ("How updates reach athlete repos") with a link to what this
migration plan actually did, since that issue's body is currently empty and this is real prior
art for whatever its real design turns out to be — don't close it, it's asking a broader question
than this one-time migration answers.

## Verification for the whole file

After Parts A-C, boot Coach (Claude Code) in both `coach-skanda` and `coach-akash` and confirm a
real turn (greet, one ordinary exchange) writes to the right new-schema files with no crash;
confirm `platform/scripts/carve-skeleton.mjs`'s scratch output also boots clean. Also confirm the
hosted coach-chat app (web + iOS) still works normally for both repos post-migration — per "BYOB
stays" above, it never depended on repo content, so this should be a no-op, but confirm it rather
than assume it.

**This is data-loss-risk work** — real athlete history in `state.md`/`challenge_v2.json`. The
agent should back up (`git log`/tag or a throwaway branch) before rewriting either repo's
`user_data/`, and should show a diff of the field mapping before committing, not just commit and
report done.
