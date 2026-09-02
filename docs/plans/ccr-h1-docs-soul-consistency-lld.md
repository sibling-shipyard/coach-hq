# H1 — Docs and SOUL consistency pass — LLD

> Status: Current · Owner: Tech Lead · Verified: 2026-09-01

Execution detail for H1 in [`chat-commit-redesign.md`](chat-commit-redesign.md). Closes #735. Runs
absolute last — after every other PR in this redesign, so it documents the true final state rather
than a moving target.

## Closes #735 directly — done, and not the way this section originally described

`platform/scripts/validate-soul.mjs`'s writable-set check found 7 paths §12 (the Commit Protocol)
writes that §2 ("Your files, your push") appeared not to declare. **Corrected while executing this
LLD.** The bullet lives in `platform/soul/B_engine.md`'s `s2_guardrails_git` section, not
`A_identity.md` as this section originally said. It already named all 7 paths - as bare filenames
sharing an earlier item's directory prefix in prose (e.g. `memory.json` right after
`user_data/coach/profile.json`). `validate-soul.mjs`'s parser takes every backtick-wrapped token
containing a `/` as a declared path, with no prefix inheritance, so those bare filenames were
invisible to it though a human reads the bullet fine. Fixed by writing every path in the bullet
in full, no implied prefix. Recomposed - confirmed `SOUL.chat.md`'s diff is empty (this section is
`CLAUDE_ONLY`) and `validate-soul.mjs` reports 0 new findings on both builds. Also ran
`--update-baseline`, which additionally cleared 9 already-resolved baseline entries this repo had
carried since before this redesign - the first fully clean `check.sh --quiet` run this whole stack
has had.

## Full sweep — every doc this redesign's PRs touch or invalidate

Per `AGENTS.md` § Doc upkeep, run `grep -rl <changed-path> docs/eng-docs/` for every file this
redesign's PRs actually changed, across A1 through G1. Update or delete what's now stale.
Known candidates from research already done in this planning pass.

- `docs/eng-docs/coach-chat-design-history.md` — likely references closing-turn behavior C1 removes;
  confirm and update or fold the removed behavior's history into it (design-history docs record
  what changed and why, this is exactly that kind of change).
- `docs/eng-docs/llm-provider-current.md` — check for any stale reference to per-turn commit
  behavior, retention counts, or the old ordinary/closing schema split.
- `docs/eng-docs/coach-data-schema.md` (if it exists — check; #513/#515's coaching-style removal
  commit touched it, confirm it still exists and gets `coaching_style` added back, `main_quest`'s
  nullability documented, `Season.status`'s widened enum documented).
- Any doc citing `#616`, `#674`, `#693`, `#703`, `#735`, `#736`, `#760` for context that's now
  resolved — update the citation to point at what actually shipped, per `AGENTS.md`'s
  "Closing an issue? grep -rn '#<N>' docs/ kdb/ first" rule.
- `ADR 0033` ("no archive tier") — confirm A2's chat-history-retention ADR doesn't accidentally
  read as reopening it; cross-reference explicitly if needed.

## Three older plan docs this redesign resolves

Not from this redesign's own PRs — leftover plan docs from earlier work that this redesign
supersedes or finishes. Handle here since H1 is already the doc-consistency pass, not a separate
PR:

1. **`docs/plans/coach-chat-redesign-final-audit.md` — delete outright.** A closing-cleanup doc for
   an older, already-fully-closed epic (#378, and all 6 of its named sub-issues, confirmed closed).
   Not cited by any code or ADR (checked). Its one still-live, unresolved lead — the `challenge_v2`
   legacy fallback in `build-dashboard-snapshot.mjs`'s `loadLedger()` — is folded into J1 rather than
   lost with the file.
2. **`docs/plans/coach-chat-redesign-testing.md` — rewrite, don't delete yet.** Describes the testing
   state of an earlier coach-chat stack (#437-#448); much of it (15 unit test files, 15 eval
   transcripts, live-API tooling) is exactly what G1/G2 change. Rewrite its content to describe the
   *post-this-redesign* testing state accurately, rather than deleting it — the athlete's call to
   keep this one around a little longer than the standard delete-on-ship rule, not this LLD's
   judgment call to override.
3. **`docs/plans/coach-chat-2026-08-28-test-pass.md` — delete, and close PR #618.** The manual daily
   test-pass checklist this whole redesign traces back to (this is the doc the original FSP bug
   report cited). Superseded in full by what actually shipped — delete the doc, and close PR #618
   (still open, carries this doc) as superseded rather than merging it as-is.

## SOUL version history

Per `AGENTS.md` § Doc upkeep #2, every soul-layer change across this redesign (C1's closing-ritual
removal, E1's coaching-style section, any prompt wording from D1/D2's validation work) needs a
`docs/eng-docs/SOUL_HISTORY.md` entry. It should match the post-cutover contract - Superpower +
short scene + 2-3 bullets + Why, ~12 lines. One entry per PR that touched a soul layer, not one
giant entry for the whole redesign, since each PR merges and ships independently.

## Plan-delete — K1's job, not H1's

**Correction, made while executing this LLD.** `chat-commit-redesign.md` itself says K1 runs last
of all, after H1. K1's own LLD (`ccr-k1-final-test-pass-lld.md`) is explicit that it's the PR that
deletes `docs/plans/chat-commit-redesign.md` and every `ccr-*.md` file, once its live pass is
green - not H1. This section originally claimed H1 does the deletion; that was written before K1
existed as its own milestone and never got updated. H1 folds durable content into eng-docs as it
goes (see the doc sweep above), but leaves every `docs/plans/ccr-*.md` file and
`chat-commit-redesign.md` itself in place for K1 to delete later.

## Tests

`python3 kdb/scripts/validate_kdb.py` clean (no stale-citation warnings). `node
platform/scripts/compose-soul.mjs --check` clean. `node platform/scripts/validate-soul.mjs` clean
against the updated baseline.

## Done when

#735 closed. No doc under `docs/eng-docs/` cites removed closing-turn behavior, the old retention
cap, or unresolved placeholder-data issues as current. `coach-chat-redesign-final-audit.md`
deleted, PR #618 closed as superseded (its own doc, `coach-chat-2026-08-28-test-pass.md`, never
merged to any branch this stack is built on - nothing to delete for it),
`coach-chat-redesign-testing.md` rewritten to describe the post-redesign testing state accurately.
`docs/plans/chat-commit-redesign*.md` and `ccr-*.md` stay in place - K1 deletes them, not H1.
