# Skeleton Layout — Full BYO Tree

> Status: **Locked (2026-07-26)** · Owner: Tech Lead · Authority: [`m1-plan.md`](m1-plan.md) · Carve: [`platform/scripts/carve-skeleton.mjs`](../../platform/scripts/carve-skeleton.mjs)
>
> **Superseded in part:** Strava ingestion was removed entirely and this doc updated to match —
> see [ADR 0010](../kdb/decisions/0010-remove-strava-relocate-activity-tools.md). `engine/strava/`
> no longer exists; `query_history.py`/`rename_core.py` moved to `engine/core/`. `.env.example`
> was also dropped from the skeleton. Untouched: this doc still describes the manual clone+PAT
> setup flow, which self-serve GitHub auth (see [`github-auth.md`](github-auth.md)) has since replaced
> for new sign-ups — that's a separate, not-yet-done doc pass.

## Context

First ~10 athletes use **BYO Claude** — clone one repo, follow `SETUP.md`, open Claude Code, talk to Coach. The org template (`sibling-shipyard/coach-skeleton`) must ship the **complete coaching workspace** on first clone. Coach sessions fill `user_data/` — not repo structure.

**Permanent non-goals:** agents in skeleton, `platform/soul/` source layers, compose script, `ui/`, `ios/`, `kdb/`, plugins (add-on later).

---

## Goal State

Every athlete repo — greenfield or migrated — uses **identical layout**. iOS/HealthKit is the
only ingestion path (Strava removed, ADR 0010).

```mermaid
flowchart TB
  subgraph root["Repo root"]
    soul["propagated/SOUL.md + propagated/docs/"]
    gh[".github/workflows/"]
  end
  subgraph engine["engine/ — runtime, do not edit via coach"]
    scripts["scripts/ + lib/"]
    core["core/ — taxonomy, naming, query"]
  end
  subgraph gen["gen/ — pipeline output, rebuildable"]
    agg["aggregate.json, quest_log, sync_status, widget_snapshots"]
  end
  subgraph ud["user_data/ — athlete + coach memory"]
    act["activities/hist/, workout_plans/"]
    coach["coach/state.md, notes, reference/"]
    ledger["ledger/challenge_v2, current_week"]
  end
  soul --> coach
  engine --> gen
  ud --> gen
  gen --> dash["Shared dashboard"]
```

---

## Canonical tree

```
coach-skeleton/  (= coach-user after fork)
├── propagated/
│   ├── SOUL.md
│   └── docs/                        # timer-state-machine, current-week-contract, etc.
├── CLAUDE.md
├── README.md
├── SETUP.md
├── .coach-engine-version
├── .gitignore
│
├── .github/workflows/
│   ├── sync.yml
│   ├── validate-data.yml
│   └── apply-coach-patch.yml
│
├── engine/
│   ├── scripts/          # regenerate, aggregate, quest gen
│   ├── lib/
│   └── core/             # taxonomy, activity naming, local query_history.py
│
├── gen/
│   ├── aggregate.json
│   ├── widget_snapshots.json
│   ├── quest_log.md
│   ├── quest_history.json
│   └── sync_status.json
│
└── user_data/
    ├── activities/
    │   ├── hist/                    # synced activity JSON (iOS/HealthKit)
    │   ├── sync_state.json          # ingestion counters
    │   └── workout_plans/
    │       ├── templates/
    │       │   ├── foundation.json  # sample — shipped in carve
    │       │   └── strength_a.json
    │       └── sessions/            # YYYY-MM-DD_<id>.json coach overrides
    ├── coach/
    │   ├── state.md                 # boot anchor — First Session fills blanks
    │   ├── coach_notes.md
    │   ├── sleep_log.json
    │   ├── chat_history.json
    │   └── reference/
    └── ledger/
        ├── challenge_v2.json        # repo marker for GitHub App
        ├── plugins.json             # optional sport plugins gate
        └── current_week.json
```

**Not in skeleton:** `.github/agents/`, `platform/soul/`, compose script, plugins, HQ-only docs/skills.

---

## Lifecycle bands

| Band | Paths | Lifecycle |
|---|---|---|
| **init** | `user_data/coach/*`, `user_data/activities/hist/` | Seeded at fork or migration |
| **post-init** | `user_data/ledger/*`, `user_data/.../sessions/` | Precious — grows in use |
| **gen** | `gen/*` | Rebuildable — pipeline-owned |
| **engine** | `engine/*` | Carved from HQ — coach must not edit |

---

## BYO boundary (clone / setup / coach)

| Phase | Who | What |
|---|---|---|
| **Clone** | Athlete | Full repo on disk — SOUL, engine, gen, user_data |
| **Setup** | Athlete + operator (App/secrets in M1) | `SETUP.md`: secrets, GitHub App |
| **Coach** | Athlete + Claude | Fills `user_data/` per SOUL boot + First Session Protocol |

We cannot hide files from a local clone. Control is **SOUL boot sequence**, **write allowlist** (§2/§12), and **CI validators** — not filesystem ACL.

**Boot trigger:** empty Athlete Profile in `user_data/coach/state.md` → First Session Protocol.

**Coach writable:** `user_data/coach/*`, `user_data/ledger/*`, `user_data/.../sessions/*`, not `engine/`, `gen/`, or `SOUL.md`.

---

## Ingestion

iOS/HealthKit is the only path (Strava removed, ADR 0010). The iOS app commits `hk_*.json`
directly to `user_data/activities/hist/`; the workflow's only pipeline entry is
`regenerate_derived.py`.

---

## Path migration map (legacy → new)

For `provision-user.sh --migrate` and HQ consumer updates (PR 2).

| Old | New |
|---|---|
| `training/coach/*` | `user_data/coach/*` |
| `training/ledger/*` | `user_data/ledger/*` |
| `training/activities/history/` | `user_data/activities/hist/` |
| `training/activities/sleep_log.json` | `user_data/coach/sleep_log.json` |
| `training/sync_state.json` | `user_data/activities/sync_state.json` |
| `training/sync_status.json` | `gen/sync_status.json` |
| `training/widget_snapshots.json` | `gen/widget_snapshots.json` |
| `training/activities/quest_log.md` | `gen/quest_log.md` |
| `training/activities/quest_history.json` | `gen/quest_history.json` |
| `training/chat_history.json` | `user_data/coach/chat_history.json` |
| `training/reference/` | `user_data/coach/reference/` |
| `data/aggregate.json` | `gen/aggregate.json` |
| `sessions/` | `user_data/activities/workout_plans/sessions/` |
| `templates/` | `user_data/activities/workout_plans/templates/` |
| `scripts/`, `lib/` | `engine/scripts/`, `engine/lib/` |
| `strava/`, `core/` | `engine/core/` (Strava ingestion removed, ADR 0010 — only naming/query logic carries over) |

---

## Greenfield vs migrate

| | Greenfield (user_3) | Migrate (Akash, Skanda) |
|---|---|---|
| Source | Fork org skeleton as-is | Legacy `coach-phelps` + path rewrite |
| Templates | `foundation` + `strength_a` from carve | Athlete's real templates (rewritten paths) |
| `hist/` | Empty until sync | Full history import |
| Secrets | Operator sets PAT | Copy from legacy repo |

Same tree in both cases.

---

## Delivery plan (two PRs)

```mermaid
flowchart LR
  P0["Phase 0 docs"] --> PR1["PR 1: Phases 1-2"]
  PR1 --> PR2["PR 2: Phase 3 consumers"]
  PR2 --> M1b["M1b provision-user.sh"]
  M1b --> M1cd["M1c/d onboard"]
```

| PR | Scope | Done when |
|---|---|---|
| **PR 1** | `carve-skeleton.mjs`, engine path migration, SOUL file map, skeleton push | Live skeleton matches this doc, engine scripts use new paths |
| **PR 2** | `ui/api/*`, iOS path updates | Dashboard + iOS read new paths |
| **After merge** | M1b provision, M1c/d validation | See [`m1-plan.md`](m1-plan.md) |

**Cutover:** B-style — you/Skanda tolerate brief breakage until PR 2 lands.

---

## Deferred

- **Plugins** — badminton, visualization/audio; optional add-on pack, not in base carve
- **SOUL propagation** — manual carve refresh until M2/M3 server-side engine

---

## Appendix

| Concern | Path |
|---|---|
| Carve operator tool | `platform/scripts/carve-skeleton.mjs` |
| HQ engine source | `engine/` |
| Live skeleton | https://github.com/sibling-shipyard/coach-skeleton |
| M1 milestones | [`m1-plan.md`](m1-plan.md) |
