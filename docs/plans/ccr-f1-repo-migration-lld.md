# F1 — Propagate to skeleton and all athlete repos — LLD

> Status: Current · Owner: Tech Lead · Verified: 2026-09-01

Execution detail for F1 in [`chat-commit-redesign.md`](chat-commit-redesign.md). Closes #760
(child of the #703 batched-migration epic). Runs **last** — after B1, B3, D2, and E1 have landed in
HQ, so the migration matches the final shape rather than an intermediate one. Executed as separate
PRs in each target repo, not a single HQ PR — tracked here as one plan.

## Why last, not per-PR

Doing this migration incrementally (once per HQ PR that touches schema) means either migrating
athlete repos multiple times or missing something landed later in the stack. Batching it at the end
matches #703's own stated intent ("Pushes are expensive — never drip; batch and roll out
together") and means every target repo gets touched exactly once.

## Targets

`sibling-shipyard/coach-skeleton` (the stamped skeleton, kept in sync via
`platform/scripts/carve-skeleton.mjs`) and the 4 live athlete repos: `skanda-2003/coach-skanda-2003`,
`akash-suresh/coach-akash-suresh`, `prateekdevaraju/coach-prateekdevaraju`,
`date2022/coach-date2022`. All 4 are cloned locally under `/home/skanda_suresh/Projects/coach-*`.
**`git pull` each before starting** — the sync bot and the athletes themselves push to these
directly, so a stale local clone is a real risk here, not a formality.

## What changes, per repo, and why each is safe

1. **`user_data/ledger/quests.json` — `main_quest` placeholder → `null`, conditionally.** Only
   where `_meta.updated_by` is still `"skeleton-init"` (the placeholder was never overwritten by a
   real `quest_create`) — check each of the 4 real repos individually before touching. If an
   athlete already has a real main quest, **leave it alone**; this migration only clears the
   never-touched placeholder so B1's fixed completion gate can correctly re-prompt them for a real
   one. `coach-skeleton` always gets `null` (it's the template, never athlete-specific).
2. **`user_data/coach/memory.json` — add empty `coaching_style` field.** New, additive, `{"text":
   "", "updated_at": null, "trace_id": null}` shape (matching E1's other note fields) — safe on
   every repo regardless of FSP status, the athlete just gets asked the new question next
   conversation.
3. **`user_data/ledger/seasons.json` — no data change.** `Season.status`'s widened enum
   (`"archived"`/`"completed"`, from B3) is a type-level change only; existing `"active"` values
   stay valid, nothing to migrate.
4. **`user_data/coach/profile.json` — `timezone: "UTC"` placeholder: leave it.** Every real reader
   already falls back to `"UTC"` regardless (confirmed in B1), and unlike `main_quest` it doesn't
   feed any completion gate — no functional reason to touch 4 real athletes' profile data for this.
5. **Anything D2's full audit surfaces** on the real repos beyond what's listed above — check once
   D2 lands, before starting this PR, not assumed here.

## Execution, per repo

1. `git pull` (never skip, confirmed above).
2. `git checkout -b core/chat-commit-redesign-migration`.
3. Apply exactly the changes above that this repo actually needs (check current file content first
   — `coach-skanda-testing`'s pre-fix snapshot showed exactly this "still skeleton-init" case, real
   athlete repos may differ).
4. Commit: `core: propagate chat-commit-redesign schema to this repo (#760)`.
5. Push, open a PR in that repo, get it reviewed before merge — same discipline as any other PR,
   not a silent direct push despite being a mechanical change.

## Tests

Per repo: confirm `isFirstSessionRitualDone`-equivalent logic (or just a manual read of the
resulting JSON) shows the intended post-migration state. No athlete-facing behavior change should
be observable except a real athlete who was stuck on the placeholder now gets re-prompted for a
real quest next conversation — which is the fix working as intended, not a regression.

## Done when

All 5 repos (skeleton + 4 athletes) have their migration PR merged, each reviewed individually
(these are real athlete repos, not a batch-and-forget operation). #760 and #703's child-issue list
updated to reflect this wave shipped.
