# HQ Restructure Plan

> **Active** · M1 cleared · Authority: [`scaling-plan.md`](scaling-plan.md) (two-repo topology unchanged)

## Context

HQ root mixes product (`ui/`, `ios/`), platform backend (`ui/api/`), engine IP, ops scripts, and **dogfood athlete data** (`user_data/`, `gen/`). M1 carved a clean athlete repo; HQ needs the same discipline.

**Locked:** HQ holds contracts + empty stamps + sample fixtures only — never populated user data. `ui/` and `ui/api/` stay at root (Vercel). No new GitHub repos. [#86](https://github.com/sibling-shipyard/coach-phelps-hq/issues/86) v4 migration runs in parallel, not a gate.

**Non-goals:** rename `ui/` → `frontend/`, move `ui/api/` out of `ui/`, cross-user features.

## Goal — five bands at root

```mermaid
flowchart TB
  subgraph hq["coach-phelps-hq"]
    shared["shared/ golden-dataset, warm-instrument"]
    ui["ui/ client + api"]
    ios["ios/"]
    plat["platform/ soul, scripts, contracts, plugins"]
    eng["engine/ carved mirror only"]
  end
  plat -->|carve| skel["coach-skeleton"]
  shared -->|local dev sample data| ui
  ui -->|prod + api| ios
```

| Band | Holds |
|---|---|
| `shared/` | Cross-platform sample data + design tokens ([ADR 0007](../kdb/decisions/0007-golden-dataset-for-sample-data.md)) |
| `ui/` | Web app + platform backend (`ui/api/auth/`, coach-chat, repo-file) |
| `ios/` | Native app |
| `platform/` | Soul layers + operator scripts (R3 ✓); plugins/contracts in R4 |
| `engine/` | Exactly what athlete repos get post-carve |

**Carve rule:** `platform/` → `propagated/` + stamps; `engine/` copies verbatim. CI fails if platform paths leak into carve output.

## Milestones

One PR each · grep every consumer · one exit test ([`hq-port-plan.md`](hq-port-plan.md) discipline).

```mermaid
flowchart LR
  R0["R0 ADR"] --> R1["R1 docs"]
  R1 --> R3["R3 platform/"]
  R3 --> R4["R4 engine mirror"]
  R4 --> R5["R5 drop dogfood"]
  R2["R2 golden ✓"] -.-> R5
```

| # | Size | Done when |
|---|---|---|
| **R0** | S | ADR records four-band layout + carve copy map | **Done** — [ADR 0011](../kdb/decisions/0011-hq-four-band-layout.md) |
| **R1** | S | Eng plans under `docs/engineering/` | **Done** |
| **R2** | M | **Mostly done** — `shared/golden-dataset/` powers local dev; R5 finishes decoupling `ui/client/src/data/` from HQ `user_data/` |
| **R3** | M | `platform/` band — soul + operator scripts | **Done** |
| **R4** | L | HQ-only code out of `engine/`; skeleton re-carved |
| **R5** | S | Delete root `user_data/`, `gen/`, `data/`; local dev uses golden dataset only |

## Risks (one-liners)

- Grep `vercel.json` + CI before any `ui/` path change.
- One milestone per PR — big-bang `git mv` broke dashboard once.
- `validate-soul` compose path moves with `platform/soul/`.

## Deferred → ADR before R0

- `propagated/SOUL.md` under `platform/artifacts/` vs carve-only output.
- Plugin pack layout (#90) vs full `platform/plugins/` carve.

## P2 follow-ups

- Server-side Coach never mounts athlete data locally (`ui/api/coach-chat.ts` is the start).
- Optional `--live` local dev against remote athlete repo.
