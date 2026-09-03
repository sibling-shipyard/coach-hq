# F1 — Propagate to skeleton and all athlete repos — LLD

> Status: Current · Owner: Tech Lead · Verified: 2026-09-03

Execution detail for F1 in [`chat-commit-redesign.md`](chat-commit-redesign.md). Closes #760
(child of the #703 batched-migration epic). Runs **after this whole redesign has merged to `main`**,
past K1 - not just after B1/B3/D2/E1 are built, since Step 0 stamps the skeleton from HQ `main`
itself and an unmerged stack means an intermediate shape. Nothing in J1/J2/H1/K1 depends on F1 in
return; it closes #760 on its own schedule, independent of the rest of this plan. Executed as
separate PRs in each target repo, not a single HQ PR - tracked here as one plan.

## Ultimate goal — exact shape parity, not just this redesign's specific fields

The athlete's direction is broader than the field-by-field list below. **All 5 athlete repos and
`sibling-shipyard/coach-skeleton` should end up structurally identical** — every repo has exactly
what the skeleton has, nothing missing, nothing extra. Per-athlete *content* (real quest names,
real activity history, real profile facts) obviously differs, but the *shape* (which files exist,
which fixed-schema fields each file has) should match exactly. The field-specific backfill list
below (`coaching_style`, `main_quest`, etc.) is this redesign's own contribution to that goal, not
the whole of it — a full structural audit (below) is what actually closes it out.

## Step 0 — stamp the skeleton first; never hand-edit it

`sibling-shipyard/coach-skeleton` is not a normal repo to compare against as-is — it's entirely
regenerated from HQ by `platform/scripts/carve-skeleton.mjs --push`
(`git push -u origin main --force`, carve-skeleton.mjs:615), which force-pushes a fresh build from
HQ's current `main`. **Never hand-edit the skeleton repo directly** — any manual change is
overwritten the next time this script runs, and the script is the only source of truth for what the
skeleton should contain.

Run `node platform/scripts/carve-skeleton.mjs --push` (after B1, B3, D2, and E1 have all landed on
HQ `main` — not before, or the skeleton reflects an intermediate shape) as the literal first step of
this PR, before touching any athlete repo. Everything after this step compares against the
freshly-stamped skeleton, not a stale clone.

## Step 1 — full structural diff, skeleton vs. every athlete repo

Once Step 0 lands, diff each athlete repo's fixed-schema files (the exact set
`carve-skeleton.mjs` writes — `writeJson(outDir, "user_data/...", ...)` calls, currently 13 files
under `user_data/coach/` and `user_data/ledger/` plus `user_data/activities/sync_state.json`)
against the same paths in the freshly-stamped skeleton. Two directions matter:

- **Missing**: a fixed-schema file the skeleton has that an athlete repo doesn't. Confirmed real
  example, found before Step 0 (re-verify after, in case the skeleton itself changes). 4 of the 5
  athlete repos (`coach-skanda-2003`, `coach-akash-suresh`, `coach-prateekdevaraju`,
  `coach-date2022`) are missing `user_data/coach/latest_message.json` entirely — only the newest
  athlete (`coach-shreyas-95-cyber`, carved most recently) has it. It was added to the skeleton
  template at some point after the first 4 were carved and never backfilled. Currently harmless
  functionally (`parseLatestMessageFile` in `ui/api/coach-message/_lib/coachMessage.ts:450-451`
  treats a missing file identically to `{schema_version: 1, message: null}`) — but exactly the class
  of drift this step exists to catch and close.
- **Extra**: a file an athlete repo has that the skeleton doesn't. A preliminary pass, against a
  since-superseded skeleton clone before Step 0's importance was clear, suggested
  `coach-skanda-2003` and `coach-akash-suresh` may carry extra files under `user_data/coach/`
  beyond the fixed set. Treat that as a lead, not a finding - re-run this comparison for real
  against the freshly-stamped skeleton from Step 0, don't trust the preliminary numbers.

Exclude naturally-per-athlete content from this diff — `user_data/activities/hist/*`,
`user_data/activities/streams/*`, `user_data/activities/workout_plans/sessions/*` are expected to
differ (real activity/session data), not structural drift.

## Step 2 — the athlete decides, per item

Present the Step 1 diff results as a plain list per repo. **Every keep-or-remove call is the
athlete's, not assumed here** — bring the list, wait for the decision, then act on it.

## Step 3 — this redesign's own field-specific backfill

Real current state, checked directly against each repo (2026-09-01) — read straight from each
repo's `quests.json`/`memory.json`/`profile.json` rather than assumed:

| Repo | `main_quest` | `current_season_id` | `coaching_style` | `equipment` note | Notes |
|---|---|---|---|---|---|
| `coach-skanda-2003` | `"Load Bearing"` (real) | `s_load_bearing_season` (real, active) | absent | populated (real gear list) | **`profile.json` is `{}` — empty.** This repo looks mid-reset, not a normal backfill case — confirm with the athlete before treating this like the others. |
| `coach-akash-suresh` | `"Weekly Structured Sessions"` (real) | `s_the_transformation_v2` (real, active) | **already present: `"accountability"`** | empty | Leftover from before the feature was removed (#513/#515) — the field was deleted from the schema, but this repo's data was never cleaned up. Confirm with Akash this value is still accurate before keeping it as-is; don't silently trust stale data. |
| `coach-prateekdevaraju` | **still the skeleton placeholder** (`"20 Strength Sessions"`, `_meta.updated_by: "skeleton-init"`) | `season_strength_weight_gain_sea_o1jd` (real, active) | absent | empty | **Live instance of the exact bug this whole redesign traces back to** — Prateek never got a real `quest_create`. Needs a real main quest backfilled, not just nulled — ask him directly what his actual goal is, same as any other backfill here. |
| `coach-date2022` | `"First Unassisted Pull-Up"` (real) | `chin-over-the-bar` (real, active) | absent | populated (real gear list) | |
| `coach-shreyas-95-cyber` | `"Rebuild Posture and Core Foundation"` (real) | `season_posture_core_rebuild_r9it` (real, active) | absent | empty | New athlete, cloned for the first time this session. |

All 5 already have a real, active current season — B3's new `main_quest.season_id` link backfills
cleanly onto every existing real `main_quest` (Prateek's excepted, since his isn't real yet either).

## What changes, per field (Step 3)

1. **`coaching_style`** — backfill a real value for all 5, gathered by the athlete talking to each
   person directly. Akash's repo already has one (`"accountability"`) — confirm it's still accurate
   rather than assume; the other 4 need a real answer from scratch. **Info needed from the athlete
   before this PR can execute:** each of the 5 people's answer to E1's FSP question. It asks what
   works when things get hard - someone holding you accountable, someone cheering you on, or
   someone walking through the why. One of `accountability` / `encouragement` / `analysis` per
   person.
2. **`main_quest`** — only `coach-prateekdevaraju` needs a real value backfilled (the other 4 already
   have one). **Info needed from the athlete:** Prateek's actual current 3-6 month goal, backfilled
   as a real `main_quest` object (`id`, `name`, `type`, `target`, optional `count_pattern`). Also his
   real `season_id` - see the next item; every athlete gets this field, Prateek's just needs a real
   `main_quest` to attach it to.
3. **`main_quest.season_id`** (new field from B3) — backfill onto all 5, not just Prateek. All 5
   already have a real, active `current_season_id` (confirmed directly: `s_load_bearing_season`,
   `s_the_transformation_v2`, `season_strength_weight_gain_sea_o1jd`, `chin-over-the-bar`,
   `season_posture_core_rebuild_r9it`) — set each real `main_quest.season_id` to that athlete's own
   `current_season_id`. No athlete input needed for this one, purely mechanical linking of two
   values that already exist.
4. **`equipment`** — empty on `coach-akash-suresh`, `coach-prateekdevaraju`, `coach-shreyas-95-cyber`.
   Worth being direct about why. This is exactly the field this session found being silently
   dropped by #616's write-loss bug — these 3 athletes may well have *stated* their equipment in a
   past conversation and had it lost, not simply never been asked. **Info needed from the athlete:**
   whether these 3 already said their equipment somewhere recoverable (check `chat_history.json` if
   any old threads survived, or just ask them directly) before assuming it's genuinely never been
   discussed.
5. **`coach-skanda-2003`'s empty `profile.json`** — not a normal backfill case, flagging separately.
   **Info needed from the athlete:** confirm whether this repo is intentionally mid-reset (matches
   the recent "clear stale onboarding-complete Keychain flag on repo recreate" fix) and should just
   go through FSP fresh, or whether real prior data needs restoring from somewhere.
6. **`Season.status`'s widened enum** (B3) — no data change needed, existing `"active"` values stay
   valid on all 5 repos.
7. **Anything D2's full audit surfaces** beyond what's listed above — check once D2 lands, before
   starting this PR, not assumed here.
8. **`timezone`** (B1) — checked directly against all 5 repos (2026-09-03): every one already
   carries a real IANA value (`coach-skanda-2003`: `Asia/Kolkata`, `coach-akash-suresh`:
   `Europe/London`, `coach-prateekdevaraju`: `Europe/London`, `coach-date2022`: `Europe/London`,
   `coach-shreyas-95-cyber`: `America/Los_Angeles`). B1's `timezone: null` placeholder fix only
   changed the carve *template* going forward — it never leaked into any live repo's data. No
   backfill needed; re-confirm at Step 0 in case a repo changed since this check.
9. **`coach_log.json`** (C2) — checked against C2's LLD and a live repo's file (2026-09-03): C2
   changes *write* behavior (overwrite same calendar day's row instead of always appending), not
   the file's shape — `{version, rows: [{id, date, ts, type, text, trace_id}]}` is unchanged. Step
   1's structural diff should find nothing here; no migration of existing rows needed.

## Info still needed from the athlete before this PR can execute

Checklist, not to be left blank at execution time:
- [ ] Coaching style (one of `accountability`/`encouragement`/`analysis`) for all 5 people —
  Akash's existing value confirmed or corrected, the other 4 answered fresh.
- [ ] Prateek's real current main quest/goal.
- [ ] Whether Akash's, Prateek's, and Shreyas's equipment was ever actually stated and lost, or
  genuinely never discussed — and if stated, what it was.
- [ ] Skanda's repo: intentional reset (go through FSP fresh) or real data to restore.
- [ ] Step 2's per-item keep-or-remove decisions, once Step 1's real diff is in hand.
- [ ] Flag here immediately if any other field this redesign adds turns out to need a real answer
  the same way — don't assume this list is exhaustive once D2's audit lands.
- [x] `timezone` (B1) and `coach_log.json` shape (C2) — checked 2026-09-03, no backfill/migration
  needed for either, see Step 3 items 8 and 9 above.

## Execution, per repo

1. `git pull` (never skip — the sync bot and the athletes themselves push to these directly, so a
   stale local clone is a real risk here, not a formality).
2. `git checkout -b core/chat-commit-redesign-migration`.
3. Apply exactly the changes this repo actually needs — Step 2's structural decisions plus Step 3's
   field backfills, using real values gathered above, never a placeholder, never left blank.
4. Commit: `core: propagate chat-commit-redesign schema to this repo (#760)`.
5. Push, open a PR in that repo, get it reviewed before merge — same discipline as any other PR,
   not a silent direct push despite being a mechanical change.

## Tests

Per repo, a manual read of the resulting JSON confirms the intended post-migration state. Same
fixed-schema shape as the freshly-stamped skeleton, real values in every field this migration
touches, and no athlete asked something they already answered outside the app just because the
field looked blank.

## Done when

`node platform/scripts/carve-skeleton.mjs --push` has run and `sibling-shipyard/coach-skeleton`
reflects the final post-redesign shape. All 5 athlete repos are structurally identical to it (no
missing fixed-schema files, no unresolved extras) per the athlete's own per-item decisions, and
every field this redesign touches carries a real backfilled value. Each of the 6 repo PRs (skeleton
re-stamp counts as one) is merged individually. #760 and #703's child-issue list updated to reflect
this wave shipped.
