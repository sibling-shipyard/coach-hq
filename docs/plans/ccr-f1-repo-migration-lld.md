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

## Principle: backfill real values, never leave a new field blank

The athlete's explicit direction: where this redesign adds or fixes a field on an *existing*
athlete's repo, get the real answer directly (the athlete asks each person, outside the app) and
write it in as part of this migration — don't add an empty field and rely on the app asking about it
naturally next conversation. A fresh/never-onboarded repo is different — there, "blank until FSP
fills it" is correct and intentional (that's the whole point of B1). This principle is specifically
about repos that already have a real, established athlete on them.

## Targets — 5 live athletes, not 4

A 5th athlete has joined since this plan was first drafted. Full list, all cloned locally under
`/home/skanda_suresh/Projects/coach-*`: `sibling-shipyard/coach-skeleton` (the stamped skeleton),
`skanda-2003/coach-skanda-2003`, `akash-suresh/coach-akash-suresh`,
`prateekdevaraju/coach-prateekdevaraju`, `date2022/coach-date2022`, and
`shreyas-95-cyber/coach-shreyas-95-cyber` (new). **`git pull` each before starting** — the sync bot
and the athletes themselves push to these directly, so a stale local clone is a real risk here, not
a formality.

## Real current state, checked directly against each repo (2026-09-01)

Read straight from each repo's `quests.json`/`memory.json`/`profile.json` rather than assumed —
this is what actually needs backfilling, not a generic template:

| Repo | `main_quest` | `coaching_style` | `equipment` note | Notes |
|---|---|---|---|---|
| `coach-skanda-2003` | `"Load Bearing"` (real) | absent | populated (real gear list) | **`profile.json` is `{}` — empty.** This repo looks mid-reset, not a normal backfill case — confirm with the athlete before treating this like the others. |
| `coach-akash-suresh` | `"Weekly Structured Sessions"` (real) | **already present: `"accountability"`** | empty | Leftover from before the feature was removed (#513/#515) — the field was deleted from the schema, but this repo's data was never cleaned up. Confirm with Akash this value is still accurate before keeping it as-is; don't silently trust stale data. |
| `coach-prateekdevaraju` | **still the skeleton placeholder** (`"20 Strength Sessions"`, `_meta.updated_by: "skeleton-init"`) | absent | empty | **Live instance of the exact bug this whole redesign traces back to** — Prateek never got a real `quest_create`. Needs a real main quest backfilled, not just nulled — ask him directly what his actual goal is, same as any other backfill here. |
| `coach-date2022` | `"First Unassisted Pull-Up"` (real) | absent | populated (real gear list) | |
| `coach-shreyas-95-cyber` | `"Rebuild Posture and Core Foundation"` (real) | absent | empty | New athlete, cloned for the first time this session. |

## What changes, per field

1. **`coaching_style`** — backfill a real value for all 5, gathered by the athlete talking to each
   person directly. Akash's repo already has one (`"accountability"`) — confirm it's still accurate
   rather than assume; the other 4 need a real answer from scratch. **Info needed from the athlete
   before this PR can execute:** each of the 5 people's answer to E1's FSP question ("What works
   when things get hard: someone holding you accountable, someone cheering you on, or someone
   walking through the why?") — one of `accountability` / `encouragement` / `analysis` per person.
2. **`main_quest`** — only `coach-prateekdevaraju` needs anything here (the other 4 already have a
   real quest). **Info needed from the athlete:** Prateek's actual current 3-6 month goal, backfilled
   as a real `main_quest` object (not nulled-and-wait) — same shape `applyQuestCreate` produces
   (`id`, `name`, `type`, `target`, optional `count_pattern`).
3. **`equipment`** — empty on `coach-akash-suresh`, `coach-prateekdevaraju`, `coach-shreyas-95-cyber`.
   Worth being direct about why: this is exactly the field this session found being silently
   dropped by #616's write-loss bug — these 3 athletes may well have *stated* their equipment in a
   past conversation and had it lost, not simply never been asked. **Info needed from the athlete:**
   whether these 3 already said their equipment somewhere recoverable (check `chat_history.json` if
   any old threads survived, or just ask them directly) before assuming it's genuinely never been
   discussed.
4. **`coach-skanda-2003`'s empty `profile.json`** — not a normal backfill case, flagging separately.
   **Info needed from the athlete:** confirm whether this repo is intentionally mid-reset (matches
   the recent "clear stale onboarding-complete Keychain flag on repo recreate" fix) and should just
   go through FSP fresh, or whether real prior data needs restoring from somewhere.
5. **`Season.status`'s widened enum** (B3) — no data change needed, existing `"active"` values stay
   valid on all 5 repos.
6. **Anything D2's full audit surfaces** beyond what's listed above — check once D2 lands, before
   starting this PR, not assumed here.

## Info still needed from the athlete before this PR can execute

Checklist, not to be left blank at execution time:
- [ ] Coaching style (one of `accountability`/`encouragement`/`analysis`) for all 5 people —
  Akash's existing value confirmed or corrected, the other 4 answered fresh.
- [ ] Prateek's real current main quest/goal.
- [ ] Whether Akash's, Prateek's, and Shreyas's equipment was ever actually stated and lost, or
  genuinely never discussed — and if stated, what it was.
- [ ] Skanda's repo: intentional reset (go through FSP fresh) or real data to restore.
- [ ] Flag here immediately if any other field this redesign adds turns out to need a real answer
  the same way — don't assume this list is exhaustive once D2's audit lands.

## Execution, per repo

1. `git pull` (never skip, confirmed above).
2. `git checkout -b core/chat-commit-redesign-migration`.
3. Apply exactly the changes this repo actually needs, using the real backfilled values gathered
   above — never a placeholder, never left blank.
4. Commit: `core: propagate chat-commit-redesign schema to this repo (#760)`.
5. Push, open a PR in that repo, get it reviewed before merge — same discipline as any other PR,
   not a silent direct push despite being a mechanical change.

## Tests

Per repo: a manual read of the resulting JSON confirms the intended post-migration state, with real
values in every field this migration touches — no athlete should see Coach ask them something they
already answered outside the app just because the field looked blank.

## Done when

All 6 repos (skeleton + 5 athletes) have their migration PR merged, each reviewed individually
(these are real athlete repos, not a batch-and-forget operation), with every field backfilled from a
real answer rather than left empty. #760 and #703's child-issue list updated to reflect this wave
shipped.
