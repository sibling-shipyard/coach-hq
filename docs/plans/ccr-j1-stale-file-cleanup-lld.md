# J1 — Repo-wide stale/unused file cleanup — LLD

> Status: Current · Owner: Tech Lead · Verified: 2026-09-01

Execution detail for J1 in [`chat-commit-redesign.md`](chat-commit-redesign.md). Runs after every
other feature PR (A-I) — sweeping for dead files before the redesign finishes would mean
re-checking anything it deletes along the way. Runs **before** H1, not after — H1 deletes this
plan's own docs as its last step, so anything that still needs to reference this LLD has to run
first.

## Confirmed real example — not hypothetical

`ui/scripts/migrate-coach-memory-part1.mjs`, `-part2.mjs`, `-part3.mjs` — three one-time data
migration scripts, presumably run once during a past schema change. This is exactly the class of
file the athlete flagged: something that did its job once and has no reason to still exist in the
repo. Confirm each has actually run against every athlete repo (git history / commit messages on
the athlete repos, or `kdb/decisions/` for the schema change it migrated) before deleting — don't
delete a migration script that's still owed to a repo nobody's checked yet.

## Scope — whole repo, not just coach-chat

Sweep systematically, not just `ui/scripts/`:
- `ui/scripts/` — one-time migration scripts, superseded build tools, anything not referenced by
  `package.json` scripts or another script's own invocation.
- `ui/api/`, `ui/client/` — dead exports, orphaned components, superseded utilities left behind by
  this redesign's own churn (C1 deletes `closeSignal.ts` outright — confirm nothing still imports
  it after that PR lands; similarly for anything else this redesign's PRs replace rather than edit
  in place).
- `engine/scripts/`, `engine/lib/` — same question, pipeline side.
- `docs/eng-docs/` — this redesign's own H1 already handles doc staleness from this specific work;
  J1 checks for pre-existing staleness H1 wouldn't have reason to touch.
- `platform/` — anything superseded by soul-layer or carve-script changes across this whole
  redesign.

## How to find real dead code, not guesses

- `grep -rn` each candidate file's exported names across the rest of the repo — zero real
  references (test files importing it to test it don't count as "used elsewhere") means it's dead.
- Check `package.json` `scripts` blocks (root, `ui/`, any other) for whether a script file is
  actually wired to an npm command — an unreferenced `.mjs`/`.ts` file with no script entry and no
  import anywhere is the clearest signal.
- For anything ambiguous (looks unused but touches something you can't fully trace), flag it in the
  PR description rather than silently deleting — this is cleanup, not archaeology; when genuinely
  unsure, ask rather than guess.

## Tests

`npm test` / `tsc --noEmit` / `eslint` all clean after deletion — confirms nothing still referenced
what got removed. No new tests needed; this PR only removes things.

## Done when

Every deleted file is confirmed dead by the method above, listed in the PR description with why
(migration already ran / superseded by which PR / genuinely orphaned), and the full check suite
(`bash platform/scripts/check.sh --quiet`) stays green.
