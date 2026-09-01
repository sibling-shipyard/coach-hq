# H1 — Docs and SOUL consistency pass — LLD

> Status: Current · Owner: Tech Lead · Verified: 2026-09-01

Execution detail for H1 in [`chat-commit-redesign.md`](chat-commit-redesign.md). Closes #735. Runs
absolute last — after every other PR in this redesign, so it documents the true final state rather
than a moving target.

## Closes #735 directly

`platform/scripts/validate-soul.mjs`'s writable-set check already found 7 paths §12 (the Commit
Protocol) writes that §2 ("Your files, your push") doesn't declare:
`user_data/coach/memory.json`, `user_data/ledger/current_week.json`, `user_data/coach/coach_log.json`,
`user_data/coach/injuries.json`, `user_data/ledger/progress.json`, `user_data/ledger/quests.json`,
`user_data/ledger/progressions.json`. Add all 7 to §2's declared list in `platform/soul/A_identity.md`,
recompose (`node platform/scripts/compose-soul.mjs`), run
`node platform/scripts/validate-soul.mjs --update-baseline`. This redesign is already editing §2/§12
adjacent content in several PRs (E1's coaching-style section, C1's closing-ritual removal) — fixing
this alongside means one recompose pass, not two.

## Full sweep — every doc this redesign's PRs touch or invalidate

Per `AGENTS.md` § Doc upkeep, run `grep -rl <changed-path> docs/eng-docs/` for every file this
redesign's PRs actually changed, across A1 through G1, and update or delete what's now stale.
Known candidates from research already done in this planning pass:

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

## SOUL version history

Per `AGENTS.md` § Doc upkeep #2: every soul-layer change across this redesign (C1's closing-ritual
removal, E1's coaching-style section, any prompt wording from D1/D2's validation work) needs a
`docs/eng-docs/SOUL_HISTORY.md` entry matching the post-cutover contract (Superpower + short scene +
2-3 bullets + Why, ~12 lines) — one entry per PR that touched a soul layer, not one giant entry for
the whole redesign, since each PR merges and ships independently.

## Plan-delete-on-last-PR

Per `AGENTS.md` § Doc upkeep #3: since this is the redesign's own finishing PR, fold anything
durable from `docs/plans/chat-commit-redesign.md` and its LLDs into the matching eng-docs (mostly
`coach-chat-design-history.md` and `coach-chat-testing.md`), then **delete the whole
`docs/plans/ccr-*.md` + `chat-commit-redesign.md` set** in this same PR. Git history is the archive.

## Tests

`python3 kdb/scripts/validate_kdb.py` clean (no stale-citation warnings). `node
platform/scripts/compose-soul.mjs --check` clean. `node platform/scripts/validate-soul.mjs` clean
against the updated baseline.

## Done when

#735 closed. No doc under `docs/eng-docs/` cites removed closing-turn behavior, the old retention
cap, or unresolved placeholder-data issues as current. `docs/plans/chat-commit-redesign*.md` and
`ccr-*.md` are deleted from the repo, their durable content living on in eng-docs instead.
