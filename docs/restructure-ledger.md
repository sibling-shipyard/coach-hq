# Restructure Migration Ledger

> **Purpose:** Single source of truth for every path move, archive, rename, and refactor in the coach-phelps restructure. Drives staged PRs (M0–M5) and the one-time mechanical migration for Sky's brother's fork at the end.
>
> **How to use:**
> 1. Before any move PR merges, find its rows here and confirm **who still uses it** is filled and the action is approved.
> 2. Reference ledger row IDs in PR descriptions (e.g. `M1: query_history dupe`).
> 3. Run the runnable `git mv` block for the phase batch; do not ad-hoc move paths not listed here.
> 4. Update **status** to `done` in the same PR that executes the move.
> 5. Nothing is archived until the **who still uses it** column clears.
>
> **Phase legend:**
> | Phase | Meaning |
> |-------|---------|
> | **M0** | Ledger & plan — governance only, no tree moves |
> | **M1** | Archive confirmed-dead files; prune dead code branches; fix stale skill paths |
> | **M2** | SOUL consolidation — extract reference sections to `docs/` (SOUL stays at repo root) |
> | **M3** | Badminton extraction into `plugins/badminton/` + taxonomy centralization |
> | **M4** | Ops & doc-naming normalization (`docs/CURRENT`, kebab-case docs; sync files keep names + `_purpose` comments) |
> | **M5** | `training/` internal reorg — lockstep with UI, iOS, Coach paths |
> | **P2** | Deferred — format pruning, history unification, hard-deletes |

**Audit date:** 2026-07-25 · **Taxonomy decision:** option **B** locked (`core/taxonomy.py`) — Sky confirmed 2026-07-25.

---

## Full migration table

| Phase | old_path | new_path | action | who still uses it | status |
|-------|----------|----------|--------|-------------------|--------|
| M0 | — | `docs/restructure-ledger.md` | create | This document; referenced by `docs/repo-restructure-plan.md` §6 | done |
| M0 | `docs/RESTRUCTURE_LEDGER.md` | `docs/restructure-ledger.md` | rename | M4 kebab-case normalization | done |
| M0 | — | `docs/repo-restructure-plan.md` (§4 taxonomy B locked) | update | Tech Lead plan; all subsequent PRs reference milestones | done |
| M1 | `skills/apple-fitness-screenshot-parser/` | — | **delete** | Superseded by `strava/fetch_strava.py` + pipeline. Only ref was `SOUL.md` §11 (removed). Sky 2026-07-25 | done |
| M1 | `skills/ebadders-match-parser/` | — | **delete** | Agent skill only; live parsing is `scripts/parse_match_description.py` + iOS `DescriptionParser`. Only ref was `SOUL.md` §11 (removed). Sky 2026-07-25 | done |
| M1 | `SOUL_PLAN.md` | `archive/SOUL_PLAN.md` | archive | Historical ref only: `SOUL_HISTORY.md:174`. Named in plan doc. No boot/CI/pipeline readers | done |
| M1 | `docs/dashboard_v2_spec.md` | `archive/docs/dashboard_v2_spec.md` | archive | Self-ref only. No code/CI/workflow refs. Superseded by live `ui/` | done |
| M1 | `docs/ui_ideas.md` | `archive/docs/ui_ideas.md` | archive | Self-ref only (`docs/ui_ideas.md:57`). No code/CI refs. Superseded by `ui/` | done |
| M1 | `docs/analytics-snapshot-design.md` | `archive/docs/analytics-snapshot-design.md` | archive | Stale design doc. Live impl: `scripts/generate_analytics_snapshot.py`, `scripts/run_sync_pipeline.py:284-299` | done |
| M1 | `docs/soul-v5-design.md` | — | **keep until M2** | Active M2 design spec (zero code refs expected). Archive after v5 lands | pending |
| M1 | `training/leaderboard.json` | `archive/training/leaderboard.json` | archive | Write-only: `scripts/run_sync_pipeline.py:46,144,158-159`. Zero readers (no `ui/`, Coach, iOS, workflow) | done |
| M1 | `training/sleep_log.json` | — | **keep** | Live contract: `scripts/run_sync_pipeline.py:47,272-279,395-398`; `ui/scripts/build-data.mjs:15,180-185`. Empty `[]` OK — P2 may remove pipeline step later | pending |
| M1 | `rename_review.md` | — | **delete** | Was `archive/rename_review.md`; one-off 2026 rename review, zero readers. Hard-deleted Sky 2026-07-25 | done |
| M2 | `SOUL.md` | — | **keep at root** | Sky 2026-07-25: `soul/` move reverted — too many boot/tooling refs | cancelled |
| M2 | `SOUL_HISTORY.md` | — | **keep at root** | Same as SOUL.md | cancelled |
| M2 | Timer/audio/protein/roster sections in `SOUL.md` | `docs/athlete-protein-reference.md`, `docs/badminton-roster.md`, `docs/visualization-audio-guide.md`; timer → `docs/timer-state-machine.md` §7 | extract | Plan §2 M2 goal | done |
| M2 | `skills/pipeline-tools.md` | same (update paths) | keep + update | On-demand CLI ref: `SOUL.md` §11; `SOUL_HISTORY.md:63`; `docs/soul-v5-design.md` | done |
| M2 | `docs/soul-v5-design.md` | `archive/docs/soul-v5-design.md` | archive | After v5 SOUL ships — currently active M2 spec | pending |
| M3 | `strava/oauth_reauth.py` | `strava/oauth_reauth.py` | keep | Fork auth contract: plan §10, `docs/coach-phelps-template-plan.md:29,337`, `SETUP.md` | done |
| M3 | `strava/rename_activities.py` | `strava/rename_activities.py` | keep | Manual bulk backfill; imports `strava/rename_core.py:33`; docs in `skills/pipeline-tools.md`, `SOUL.md` §11, `.github/agents/bob-the-builder.md` | done |
| M3 | `strava/parse_ebadders.py` | — | **delete** | Website HTML parser — superseded by text-description flow. Sky 2026-07-25 | done |
| M3 | `strava/merge_ebadders.py` | — | **delete** | Scrape-to-activity merge no longer needed. Sky 2026-07-25 | done |
| M3 | `scripts/generate_analytics_snapshot.py` | `plugins/badminton/analytics.py` | move | Thin wrapper → plugin; pipeline step 7: `scripts/run_sync_pipeline.py`; Coach: `SOUL.md` §2, §10 | done |
| M3 | `scripts/parse_match_description.py` | `scripts/parse_match_description.py` | keep | Pipeline + tests + iOS port; `{partner} me vs …` text format only | done |
| M3 | `training/ebadders_history.json` | `plugins/badminton/data/badminton_match_data.json` | move + rename | iOS: `GitHubAPIClient.swift`, `ActivityDetailView.swift`; `.github/workflows/sync.yml:14`; analytics + pipeline | done |
| M3 | `training/analytics_snapshot.json` | `training/analytics_snapshot.json` | keep | Output contract — byte-identical per plan §5. Coach on-demand: `SOUL.md` §2, §10. Not in `ui/scripts/build-data.mjs` | done |
| M3 | `strava/rename_core.py` (taxonomy inline) | imports `core/taxonomy.py` | refactor | `strava/rename_single.py:30`, `strava/rename_activities.py:33`; iOS mirror: `ActivityNamer.swift:4,14,62` | done |
| M3 | *(new)* | `core/taxonomy.py` | create | **Locked option B** — single source for `rename_core`, badminton analytics, parse. Sky confirmed 2026-07-25 | done |
| M4 | `training/sync_state.json` | `training/sync_state.json` | keep + `_purpose` comment | Strava: `fetch_strava.py`, `rename_activities.py`; iOS: `GitHubAPIClient.swift`, `HealthKitSyncManager.swift`; workflow path trigger. Rename cancelled Sky 2026-07-25 | done |
| M4 | `training/sync_status.json` | `training/sync_status.json` | keep + `_purpose` comment | Dashboard: `build-data.mjs`, UI pages; pipeline: `run_sync_pipeline.py`; CI: `sync.yml:75`; Netlify. Rename cancelled Sky 2026-07-25 | done |
| M4 | `docs/activity_enrichment_guide.md` | `docs/activity-enrichment-guide.md` | rename | Self-ref only | done |
| M4 | `docs/phelps_voice_profile.md` | `docs/phelps-voice-profile.md` | rename | SOUL.md, visualization-audio-guide, soul-v4/v5 design | done |
| M4 | `docs/phelps_research_notes.md` | `docs/phelps-research-notes.md` | rename | SOUL.md, soul-v4/v5 design | done |
| M4 | — | `docs/CURRENT.md` | create | Active doc index + M4 deep-link audit result | done |
| M5 | `training/state.md` | `training/coach/state.md` | move | Boot: `SOUL.md:9`; Coach ritual: `SOUL.md:37,416,432`; `README.md:48`; `VALIDATION_TESTS.md`; `docs/current-week-contract.md:17`; `training/coach/state.md` self-ref; `.github/CONVENTIONS.md:59`; `CLAUDE.md:38` | done |
| M5 | `training/coach_notes.md` | `training/coach/coach_notes.md` | move | `SOUL.md` (boot off, on-demand, ritual); `VALIDATION_TESTS.md:7-8,12`; `docs/current-week-contract.md:19`; `training/coach/archive/phases.md:4`; `.github/CONVENTIONS.md:59`; `CLAUDE.md:38` | done |
| M5 | `training/opponent_notes.md` | `training/coach/opponent_notes.md` | move | `SOUL.md:28,41,363`; `VALIDATION_TESTS.md:12`; `docs/audio-viz-rebuild-spec.md:55`; `docs/soul-v5-design.md:101` | done |
| M5 | `training/league_warmup.md` | `training/reference/league_warmup.md` | move | Static reference (Diesel Engine warm-up); not coach memory. Coach on-demand only — zero pipeline/CI/iOS refs | done |
| M5 | `training/workout_log.md` | `training/coach/archive/early_challenge_log.md` | move + archive | Was `training/coach/workout_log.md` interim; consolidated to `coach/archive/` in P2 cleanup. SOUL on-demand only | done |
| M5 | `training/archive/` | `training/coach/archive/` | move | `SOUL.md:33,98,356`; `VALIDATION_TESTS.md:23`; `.github/CONVENTIONS.md:59`; `CLAUDE.md:38`; `docs/current-week-contract.md:165` | done |
| M5 | `training/challenge_v2.json` | `training/ledger/challenge_v2.json` | move | `ui/scripts/build-data.mjs:10,73+`; `scripts/generate_quest_log.py:27`; `scripts/generate_quest_history.py:93`; `.github/workflows/sync.yml:7`; `.github/workflows/validate-data.yml:14-20,34`; `SOUL.md` (many); `CLAUDE.md:38` | done |
| M5 | `training/current_week.json` | `training/ledger/current_week.json` | move | `ui/scripts/build-data.mjs:11,107+`; `ui/scripts/validate-current-week.mts:23`; `.github/workflows/validate-data.yml:15-20,35`; `SOUL.md` (many); `docs/current-week-contract.md`; `CLAUDE.md:38`; `ui/netlify.toml:5` | done |
| M5 | `training/history/` | `training/activities/history/` | move | **P2 frozen:** `hk_*` + Strava-ID *filenames* unchanged inside dir. Consumers: `build-data.mjs:51`; `fetch_strava.py:25`; `query_history.py:28`; `rename_activities.py:43`; `run_sync_pipeline.py:44`; `generate_quest_log.py:28`; `plugins/badminton/analytics.py`; iOS `GitHubAPIClient.swift`, `HealthKitSyncManager.swift`, `ActivityDetailView.swift`; `.github/workflows/sync.yml:12,50`; `ui/netlify.toml:5` | done |
| M5 | `training/photos/` | — | **delete** | Was `fetch_strava.py` download target; no UI/iOS/Coach readers. `local_photos` in history JSON left as stale metadata (P2 strip). Sky 2026-07-25 | done |
| M5 | `training/last_week/` | — | **delete** | Was CI-only slice in `sync.yml`; removed — no consumer. Superseded by `strava/query_history.py --last Nd` | done |
| M5 | `training/analytics_snapshot.json` | `training/activities/badminton_analytics_snapshot.json` | move + rename | `plugins/badminton/analytics.py` (write); Coach on-demand: `SOUL.md:16,27,371`; `scripts/generate_analytics_snapshot.py` (wrapper); not in `build-data.mjs` | done |
| M5 | `training/quest_log.md` | `training/activities/quest_log.md` | move | Boot: `SOUL.md:8,23,40,334,439`; `scripts/generate_quest_log.py:29`; `.github/workflows/sync.yml:87`; `.github/CONVENTIONS.md:60`; `.github/agents/bob-the-builder.md:131` | done |
| M5 | `training/sleep_log.json` | `training/activities/sleep_log.json` | move | `run_sync_pipeline.py:47,254`; `ui/scripts/build-data.mjs:15,180-185` (reads from OUT_DIR copy, not source — pipeline step copies first) | done |
| M5 | `training/audio/` | `plugins/visualization/audio/` | move | Coach on-demand viz assets; `docs/audio-viz-rebuild-spec.md`; `docs/visualization-audio-guide.md`; `training/coach/coach_notes.md:858`. Was interim `training/media/audio/` | done |
| M5 | `training/references/` | `training/reference/` | move + rename | `progression_paths.md` only live file; refs in `archive/SOUL_PLAN.md`, `SOUL_HISTORY.md` (historical) — no boot/CI readers | done |
| M5 | `training/templates/` | — | **delete** | Legacy `workout_templates.md` superseded by repo-root `templates/*.json` per `SOUL.md:279`. Hard-deleted Sky 2026-07-25 | done |
| M5 | `training/sync_state.json` | `training/sync_state.json` | **keep** | M4 locked name + root path. Strava: `fetch_strava.py:27`; iOS: `GitHubAPIClient.swift`, `HealthKitSyncManager.swift`; workflow trigger: `sync.yml:13` | done |
| M5 | `training/sync_status.json` | `training/sync_status.json` | **keep** | M4 locked name + root path. `build-data.mjs:14,168+`; `run_sync_pipeline.py:45`; `sync.yml:75`; `ui/netlify.toml:5` | done |
| P2 | `training/activities/history/` (`hk_*` + Strava-ID schemes) | unified scheme? | defer | 832 Strava + 32 HealthKit files; plan §4 explicitly frozen | pending |
| P2 | `training/activities/history/` `local_photos` fields | strip stale paths | defer | Legacy download paths after M5 photo delete; `total_photo_count` retained | pending |
| P2 | `ui/client/src/data/` aggregate fields | prune unused | defer | Plan §4 P2 list | pending |
| P2 | `plugins/badminton/data/badminton_match_data.json` shape | prune fields | defer | Plan §4 P2 | pending |
| P2 | `training/sleep_log.json` pipeline step | remove if stays empty | defer | Plan §4 P2 | pending |
| P2 | `archive/training/leaderboard.json` | hard-delete | defer | After M1 archive + confirm still unread | pending |
| P2 | `scripts/generate_quest_history.py` + `training/seasons/` | clean ledger generation | defer | Brother's fork parity — keep script unchanged for now. `training/seasons/*/` dir absent; decide archive layout + season glob vs single-source ledger. Sky 2026-07-25 | pending |
| P2 | `training/coach/workout_log.md` | `training/coach/archive/early_challenge_log.md` | archive + delete source | Was archived narrative; content moved to `coach/archive/`. SOUL, ledger tree updated. Sky 2026-07-25 | done |
| P2 | `training/activities/last_week/` | — | **delete** | CI wrote 7-day slice in `sync.yml` but zero readers (Coach uses `query_history.py`). Removed from workflow. Sky 2026-07-25 | done |
| P2 | `training/media/audio/` | `plugins/visualization/audio/` | move | Viz scripts + rendered tapes; `docs/audio-viz-rebuild-spec.md`, `docs/visualization-audio-guide.md`, `coach_notes.md`. Sky 2026-07-25 | done |
| — | `strava/fetch_strava.py` | `strava/` | keep | Primary sync: `scripts/run_sync_pipeline.py:64-74`; extensive docs/agents/SOUL refs | done |
| — | `strava/query_history.py` | `strava/` | keep | Coach boot + logging workflow (see M1 dupe row) | done |
| — | `scripts/parse_match_description.py` | `scripts/` | keep | Pipeline + tests + iOS port (text description format) | done |
| — | `scripts/run_sync_pipeline.py` | `scripts/` | keep | `.github/workflows/sync.yml`; orchestrates all pipeline steps | done |
| — | `scripts/generate_quest_log.py` | `scripts/` | keep | `scripts/run_sync_pipeline.py:238-250`; `.github/workflows/sync.yml:84`; `SOUL.md` §11 | done |

---

## M1 archive batch — runnable `git mv` block

**Confirmed safe (high confidence).** Run in M1 PR after updating any inbound refs. Do **not** run in M0.

> **NOT in this block:** `docs/soul-v5-design.md` — **KEEP until M2** (active v5 design spec).  
> **NOT in this block:** `training/sleep_log.json` — **KEEP** (live pipeline contract; empty data is OK).

```bash
# M1 archive batch — confirmed safe items only
mkdir -p archive/docs
mkdir -p archive/training

git mv SOUL_PLAN.md archive/SOUL_PLAN.md

git mv docs/dashboard_v2_spec.md archive/docs/dashboard_v2_spec.md
git mv docs/ui_ideas.md archive/docs/ui_ideas.md
git mv docs/analytics-snapshot-design.md archive/docs/analytics-snapshot-design.md

git mv training/leaderboard.json archive/training/leaderboard.json

git mv rename_review.md archive/rename_review.md  # hard-deleted 2026-07-25
```

**Deleted (not archived):** `skills/apple-fitness-screenshot-parser/`, `skills/ebadders-match-parser/` — superseded by pipeline scripts; Sky 2026-07-25.

---

## M1 additional tasks (same PR, not `git mv`)

These ship with M1 but are code/doc edits, not archives:

1. **Remove obsolete agent skills** — delete `skills/apple-fitness-screenshot-parser/` and `skills/ebadders-match-parser/`; drop `SOUL.md` §11 skill bullets.
2. **Remove leaderboard upsert** — `_upsert_leaderboard` in `scripts/run_sync_pipeline.py` (write-only orphan).
3. **Fix `SOUL_HISTORY.md`** — update `SOUL_PLAN.md` ref to `archive/SOUL_PLAN.md`.

**Reverted / deferred:** `scripts/generate_quest_history.py` — left unchanged (brother fork parity). P2: clean season-ledger generation.

---

## M5 training reorg — target tree

```
training/
├── coach/                  # Human-edited coaching memory (direct-to-main lane)
│   ├── state.md
│   ├── coach_notes.md
│   ├── opponent_notes.md
│   └── archive/
│       ├── week_plans.md
│       ├── phases.md
│       └── early_challenge_log.md  # 60-Day Challenge days 1–10 (Mar 2026)
├── ledger/              # Structured JSON consumed by dashboard + validate-data
│   ├── challenge_v2.json
│   └── current_week.json
├── activities/               # Auto-generated / sync artifacts
│   ├── history/            # P2: hk_* + Strava-ID filename schemes frozen
│   ├── badminton_analytics_snapshot.json
│   ├── quest_log.md
│   └── sleep_log.json
├── reference/              # Static coach reference (progression paths, warm-up protocol)
│   ├── progression_paths.md
│   └── league_warmup.md
├── sync_state.json         # M4 locked — stays at training root
└── sync_status.json        # M4 locked — stays at training root
```

## M5 training reorg — runnable `git mv` block

Run on branch `core/repo-restructure-m5-training` **before** consumer path updates. Do **not** move `sync_state.json` / `sync_status.json`.

```bash
# M5 — create domain dirs
mkdir -p training/coach training/ledger training/activities training/reference plugins/visualization

# Coach memory
git mv training/state.md training/coach/state.md
git mv training/coach_notes.md training/coach/coach_notes.md
git mv training/opponent_notes.md training/coach/opponent_notes.md
git mv training/league_warmup.md training/reference/league_warmup.md
git mv training/workout_log.md training/coach/archive/early_challenge_log.md
git mv training/archive training/coach/archive

# Structured ledger
git mv training/challenge_v2.json training/ledger/challenge_v2.json
git mv training/current_week.json training/ledger/current_week.json

# Activity artifacts (bulk dirs)
git mv training/history training/activities/history
git mv training/analytics_snapshot.json training/activities/badminton_analytics_snapshot.json
git mv training/quest_log.md training/activities/quest_log.md
git mv training/sleep_log.json training/activities/sleep_log.json

# Media + reference (do not pre-create training/reference — git mv references → reference directly)
git mv training/audio plugins/visualization/audio
git mv training/references training/reference
# workout_templates.md deleted — superseded by repo-root templates/*.json
```

**Same PR must update:** `ui/scripts/build-data.mjs`, `ui/scripts/validate-current-week.mts`, `ui/netlify.toml`, `scripts/{run_sync_pipeline,generate_quest_log,generate_quest_history}.py`, `plugins/badminton/analytics.py`, `strava/{fetch_strava,query_history,rename_activities}.py`, `.github/workflows/{sync,validate-data}.yml`, `ios/.../GitHubAPIClient.swift`, `HealthKitSyncManager.swift`, `ActivityDetailView.swift`, `SOUL.md`, `CLAUDE.md`, `.github/CONVENTIONS.md`, agent docs, and inline refs in `training/coach/*`.

**iOS smoke-test checklist (manual, pre-merge):**
1. Build app in Xcode — no compile errors
2. Trigger HealthKit sync — confirm new `hk_*` file lands in `training/activities/history/` on GitHub
3. Confirm `training/sync_state.json` counters increment
4. Open synced activity in app — description save still writes history + badminton match data

**Exit tests:** `validate-data` green · `cd ui && npm run build` green · grep shows zero stale `training/state.md`-style flat paths in live code (exclude `archive/`, `SOUL_HISTORY.md` historical mentions, `data/aggregate.json`)

---

## Critical path

**M0 → M1 → M3 → M5** · M2 and M4 parallelize off M1.
