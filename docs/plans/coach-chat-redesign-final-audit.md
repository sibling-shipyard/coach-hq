# Coach-chat redesign — final full-repo audit

> Status: Current · Owner: Tech Lead · Verified: 2026-08-21

## Context

Last step of the redesign that started with issue #378. Everything up to here — the schema split,
prompt/insights rebuild, `handle()` decomposition, `turnWrites/` split, doc rewrite, plan-root
cleanup, athlete-repo migration, real end-to-end testing, and dashboard rewiring off the
compatibility shim — is scoped in its own plan file. This is the closing pass: walk the whole
repo once the dust has settled and find what the redesign left behind. Not a new redesign, a
cleanup of the one that just happened.

**Sequencing is load-bearing, not arbitrary.** Dead-code and "what's broken" checks are only
meaningful once the thing they're checking is actually finished — auditing for dead code while
the dashboard is still reading through a lossy compatibility shim would flag real, still-load-bearing
code as dead. Run this last.

## Prerequisites — do not start until all of these are true

1. `docs/plans/coach-chat-redesign-testing.md` complete — daily flow, FSP, and frontend all
   verified against real athlete repos, not just unit tests.

Athlete-repo migration (both `coach-skanda` and `coach-akash` on the current schema,
`carve-skeleton.mjs` fixed) already shipped — no longer a prerequisite.
3. `docs/plans/ui-dashboard-rewiring.md` shipped — dashboard reads split-ledger data directly,
   `splitLedgerChallenge.ts` shim retired or reduced to its final legacy-only scope.

If any of these three isn't done, this audit will misclassify still-live code as dead. Check
before starting, don't assume from this list alone.

## Plan

**Branch:** stacks after all three prerequisites above.

### 1. Dead code sweep

- `grep -rn "challenge_v2\|state\.md\|coach_notes\.md\|opponent_notes\.md\|sleep_log\.json"`
  across `ui/`, `engine/`, `platform/` — anything still referencing the pre-redesign schema by
  name that isn't an intentional legacy/historical path (check against
  `docs/eng-docs/challenge-v2-schema.md`'s `Status: Historical` scope — some legacy references
  are supposed to survive for genuinely-unmigrated repos, don't delete those blindly).
- Every file in `ui/api/coach-chat/_lib/` — confirm each is actually imported somewhere
  (`coachIntents.ts`'s appliers specifically, since the redesign moved a lot of that logic into
  `turnWrites/*.ts` and the old appliers may be orphaned).
- `engine/` scripts — any generator/script that predates the redesign and was superseded by a
  newer one but never removed.
- **Old-setup fallback sweep, not just dead code.** Grep the whole repo — not only `ui/` — for any
  code path that still reads, writes, or falls back to the pre-redesign shape: `challenge_v2`,
  bare `propagated/SOUL.md`, `training/*` legacy paths, terminal-mode carve files
  (`engine/claude/athlete/`), anything matching the "legacy → new" map in
  `docs/eng-docs/skeleton-layout.md`. A live, reachable fallback branch is worse than dead code —
  it silently keeps searching for the old setup and can reactivate the moment its trigger condition
  is met again. Confirm no onboarding/carve path can still produce the condition that trips it, then
  delete the branch, not just note it. Known instance to start from:
  `engine/scripts/build-dashboard-snapshot.mjs`'s `loadLedger()` legacy `challenge_v2.json`
  fallback (and the `ledger_schema`/`challenge_v2` fields it emits into
  `gen/dashboard_snapshot.json`) — tracked in `coach-chat-open-items.md`.
- Unused exports across `ui/client/src/lib/` — a lint pass (`ts-prune` or equivalent) rather than
  manual grep, given the size of the client tree.

### 2. What's broken — repo-wide

Not limited to coach-chat. Go through each top-level area and check for real breakage, not just
lint/type-check cleanliness:

- `ui/client/` — every page loads without a console error against a real generated snapshot
  (build both a migrated and, if still relevant, unmigrated repo's data and check each).
- `ui/api/` — every route still returns a sane response for its documented contract; check for
  any endpoint left over from a retired flow (cross-reference against
  `docs/eng-docs/coach-chat-daily.md`'s endpoint table and the `README.md`'s route list).
- `engine/` — `validate-data` and any other CI-invoked script actually pass against both live
  repos' real current data, not just fixtures.
- `platform/` — `compose-soul.mjs --check` clean on both builds; `validate-soul` baseline (from
  `docs/eng-docs/soul-path-to-v6.md`'s Rules section) hasn't silently drifted.
- `ios/` — confirm it actually builds and boots against the current schema (this plan doesn't
  own iOS work, but a broken build is worth surfacing to iOS Builder even if fixing it isn't in
  scope here).
- `kdb/scripts/validate_kdb.py` clean, zero warns, not just zero failures.

### 3. Documentation drift check

Second verification pass on `coach-chat-daily.md`/`coach-chat-fsp.md`/`coach-data-schema.md` —
these were written and verified once already (2026-08-21), but part 3's migration and the UI
rewiring plan will have touched files these docs cite. Re-verify field-by-field against source,
same discipline as the first pass, not a skim.

### 4. Close out the epic

Once 1-3 are clean: check off any of #378's remaining sub-issues (#322, #359, #362, #360, #316,
#361) that are genuinely true now — verify each against real code, not the tracking table alone —
and close #378 itself if every sub-issue resolves. This is the actual final step of the
redesign that started it.

## Done when

- Dead-code sweep produces a list of confirmed-dead files/exports, each removed in this PR (not
  left as a follow-up list — this audit's whole point is finishing the cleanup, not just
  documenting it further).
- Every area in section 2 checked with a real result recorded, not assumed.
- `#378` closed, or a clear explanation of what's still blocking it if not.

## Scope guard

No new features. No redesigns of anything found broken beyond what's needed to make it correct —
a broken thing gets fixed to match its own documented contract, not improved beyond it. Anything
that looks like a genuinely new feature opportunity while doing this audit → a P2/P3 line item in
a follow-up doc, not code in this PR.
