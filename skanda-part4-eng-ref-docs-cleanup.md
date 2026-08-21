# Part 4 — triage docs/eng-docs, docs/ref-docs, docs/plans

## Branch

Stacks after part 3.

## Why

`docs/eng-docs/` and `docs/ref-docs/` mix current and historical docs. **No physical
`hist-docs/` folder** — Akash owns that restructuring separately, don't build it here. This is
in-place triage only: re-check each doc against current code, correct it if it's meant to
describe today's system, or mark it `Status: Historical` (per `docs/eng-docs/README.md`'s
existing convention — `kdb/scripts/validate_kdb.py` already skips path-checking those files on
purpose) if it's a dated record kept for citation. Grep for citations before deciding a doc is
dead-and-deletable vs. historical-and-kept — don't assume from the filename.

## Step 1 — `docs/eng-docs/`

Likely candidates (verify each — this is a starting list from the directory listing, not a final
one):
- `soul-C-schema.md`, `soul-path-to-v6.md`, `soul-two-builds.md` — check if superseded by ADR
  0022 + the current composed-SOUL reality. Mark `Status: Historical` if kept for rationale, or
  delete outright if genuinely nothing cites it.
- `m1-plan.md`, `hq-restructure-plan.md`, `hq-port-plan.md`, `website-unification-history.md`,
  `phelps-research-notes.md` — check for staleness/citations the same way.
- `coach-chat-design-history.md` — name suggests it's already meant as history; likely just needs
  the `Status: Historical` tag applied, not a rewrite.
- `activity-naming-migration.md` — check for staleness/citations.
- `challenge-v2-schema.md` — this one is likely **dead** content now that `challenge_v2.json`
  itself is retired per the ledger split; verify no code still reads it. If part 3's athlete-repo
  migration mapping needs it as a reference for the old shape, link it from there rather than
  deleting outright, otherwise delete.

## Step 2 — `docs/ref-docs/`

These carve to athlete repos, so extra care: a doc removed from `propagated/docs/` on carve stops
shipping to new athletes — verify against #358's restore list from part 3 first. Check
`badminton-plugin.md`, `phelps-voice-profile.md`, `soul-calibration.md`, `timer-state-machine.md`,
`current-week-contract.md`, `milestone-schema.md`, `season-close.md` against current
schema/behavior — these were flagged in earlier review as citing `state.md`/`coach_notes.md`/
`challenge_v2.json`; confirm whether that's since been fixed by #445/#446 or is still stale,
update in place (these are carve-shipped reference, not history — they get corrected, not
removed).

## Step 3 — `docs/plans/`

Per `docs/eng-docs/README.md`'s own rule ("`docs/plans/` — deleted when shipped"), audit its
contents (`backend-decision.md`, `coach-chat-follow-up.md`, `coach-chat-modularization.md`,
`coach-intent-schema.md`, `coach-memory.md`, `coach-schema-redesign-lld.md`,
`coach-schema-redesign.md`, `ledger-split-plan.md`, `llm-provider-future.md`,
`ops-agent-setup.md`) the same way as part 2's root-file triage:

- `coach-schema-redesign.md`/`-lld.md` and `coach-memory.md`/`ledger-split-plan.md` are very
  likely fully shipped (they're #378's own cited design docs, and #378's steps are done) —
  confirm against the epic's "Done when" checklist, fold anything durable into the new
  `coach-data-schema.md` from part 1 if it's not already captured there, then delete.
- Leave genuinely forward-looking ones (`backend-decision.md`, `llm-provider-future.md`) alone —
  they're not shipped yet.

## Verification

`node kdb/scripts/validate_kdb.py` clean (checks front matter and `Status: Historical` path
exemptions). For `docs/ref-docs/` changes specifically, re-run the carve script from part 3 (if
landed) or `platform/scripts/carve-skeleton.mjs` as it exists today, and confirm the
athlete-facing `propagated/docs/` output still matches intent — this is the one category here
with a real "ships to someone else" blast radius, not just internal doc hygiene.
