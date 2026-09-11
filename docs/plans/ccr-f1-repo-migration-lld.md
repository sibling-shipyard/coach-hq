# F1 — Propagate to skeleton and all athlete repos — LLD

> Status: Current · Owner: Tech Lead · Verified: 2026-09-11

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

- **Missing**: a fixed-schema file the skeleton has that an athlete repo doesn't. Re-checked
  directly against all 5 local clones, `git pull`ed fresh, 2026-09-11: this has narrowed since the
  first pass. `coach-skanda-2003`, `coach-akash-suresh`, `coach-prateekdevaraju`, and
  `coach-shreyas-95-cyber` now all carry `user_data/coach/latest_message.json` - only
  `coach-date2022` still doesn't. Whoever backfilled the other 4 didn't touch this one; still
  harmless functionally (`parseLatestMessageFile` in
  `ui/api/coach-message/_lib/coachMessage.ts` treats a missing file identically to
  `{schema_version: 1, message: null}`), still worth closing in this pass so the file set is
  actually uniform.
- **Extra**: a file an athlete repo has that the skeleton doesn't. Confirmed real, no longer just a
  lead. Checked directly against all 5 clones 2026-09-11, still without a freshly-stamped skeleton
  to diff against since Step 0 hasn't run. Compared instead against `carve-skeleton.mjs`'s own
  `writeJson`/`writeText` call list, the same source of truth Step 0 would stamp from.
  - `coach-skanda-2003`: `user_data/coach/leftover_coach_notes.md`, `user_data/coach/sleep_log.json`,
    `gen/aggregate.json`, `gen/quest_log.md`.
  - `coach-akash-suresh`: the same four plus `user_data/coach/opponent_notes.md`,
    `gen/badminton_analytics_snapshot.json`, and a whole extra `user_data/ledger/seasons/`
    directory sitting alongside the real `user_data/ledger/seasons.json` file.
  - `coach-prateekdevaraju`, `coach-date2022`, `coach-shreyas-95-cyber`: none - each matches the
    fixed set exactly.
  - `leftover_coach_notes.md` and `sleep_log.json` are named directly in a `carve-skeleton.mjs`
    comment (next to `PROFILE_TEMPLATE`). It says they "no longer exist in a fresh carve, per
    #407/#413's split." These two are confirmed dead leftovers pre-dating that split, not
    per-athlete content the athlete chose to keep. `opponent_notes.md`,
    `badminton_analytics_snapshot.json`, and the extra `ledger/seasons/` directory are different -
    Akash-specific additions with no matching `carve-skeleton.mjs` entry at all, real Step 2
    decisions rather than an inherited leftover.

Exclude naturally-per-athlete content from this diff — `user_data/activities/hist/*`,
`user_data/activities/streams/*`, `user_data/activities/workout_plans/sessions/*` are expected to
differ (real activity/session data), not structural drift.

## Step 2 — the athlete decides, per item

Present the Step 1 diff results as a plain list per repo. **Every keep-or-remove call is the
athlete's, not assumed here** — bring the list, wait for the decision, then act on it.

## Step 3 — this redesign's own field-specific backfill

Real current state, re-checked directly against each repo (2026-09-11, `git pull`ed fresh) — read
straight from each repo's `quests.json`/`memory.json`/`profile.json` rather than assumed:

| Repo | `main_quest` | `current_season_id` | `coaching_style` | `equipment` note | Notes |
|---|---|---|---|---|---|
| `coach-skanda-2003` | `"Load Bearing"` (real) | `s_load_bearing_season` (real, active) | absent | populated (real gear list) | `profile.json`'s earlier empty `{}` is resolved - it now carries real `name`/`dob`/`timezone`/`height_cm`/`weight_kg`. No longer a mid-reset case; drop from the "info needed" checklist below. |
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
5. **`coach-skanda-2003`'s `profile.json`** — resolved as of this re-check (2026-09-11): it now
   carries real values, not the empty `{}` the first pass found. No action needed here anymore.
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
- [x] Skanda's repo: resolved on its own as of 2026-09-11's re-check - `profile.json` now has real
  data, no athlete decision needed.
- [ ] Step 2's per-item keep-or-remove decisions, now that Step 1's real diff is in hand (see the
  Missing/Extra lists above, re-verified 2026-09-11) - specifically Akash's leftover files/directory
  and `coach-date2022`'s missing `latest_message.json`.
- [ ] Flag here immediately if any other field this redesign adds turns out to need a real answer
  the same way — don't assume this list is exhaustive once D2's audit lands.
- [x] `timezone` (B1) and `coach_log.json` shape (C2) — checked 2026-09-03, no backfill/migration
  needed for either, see Step 3 items 8 and 9 above.
- [ ] This whole plan is still blocked on the redesign stack itself: as of 2026-09-11, B1/B2/B3,
  D1/D2/D3, E1, and everything through K1 are still open, unmerged PRs (`#773`-`#822` and later),
  stacked under `main`. F1 cannot execute (Step 0 stamps the skeleton from HQ `main`, not a branch)
  until that stack actually merges.

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
