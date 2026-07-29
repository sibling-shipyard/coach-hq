# 0011 — HQ four-band layout (shared, ui, ios, platform, engine)

- **Status:** Accepted · 2026-07-29 · Tech Lead
- **Area:** cross-cutting
- **Context:** HQ root mixes product surfaces, platform backend, engine IP, operator tooling, and dogfood athlete data (`user_data/`, `gen/`). M1 carved a clean athlete repo; HQ needs the same band discipline before more path moves.
- **Decision:** HQ organizes into five root bands — `shared/` (cross-platform fixtures + tokens), `ui/` (web + `ui/api/` platform backend), `ios/`, `platform/` (HQ IP: soul, carve/provision, contracts, plugins), `engine/` (exact mirror of athlete runtime post-carve). HQ never holds populated athlete instances.
- **Why:** One grep-friendly story for what ships to athlete repos vs what stays operator-only. Carve becomes "copy `engine/` verbatim + compose from `platform/`" instead of hunting HQ-only paths inside `engine/`.
- **Rejected:** New GitHub repo for platform backend → two-repo topology locked ([`scaling-plan.md`](../../docs/engineering/scaling-plan.md)). Move `ui/api/` to `platform/` now → correct logical home but Vercel Root Directory is `ui/`; defer until deploy rewire (P2). Rename `ui/` → `frontend/` → breaks Vercel config.

## Carve copy map (today)

Authority: `scripts/carve-skeleton.mjs`. Milestones: [`hq-restructure-plan.md`](../../docs/engineering/hq-restructure-plan.md).

| Source (HQ today) | Skeleton destination | Target band |
|---|---|---|
| `engine/scripts/` (5 runtime + validate wrapper) | `engine/scripts/` | `engine/` |
| `engine/lib/`, `engine/core/`, `engine/claude/athlete/` | `engine/` + root Claude config | `engine/` |
| `engine/.github/workflows/` (3 user workflows) | `.github/workflows/` | `engine/` |
| `engine/scripts/compose-soul.mjs` + `engine/soul/` | *(runs at carve)* → `propagated/SOUL.md` | `platform/` (R3) |
| `engine/docs/` (5 refs) + `engine/skills/pipeline-tools.md` | `propagated/docs/` | `platform/` → propagated |
| `engine/templates/` (2 samples) | `user_data/.../templates/` | platform templates → init stamp |
| `scripts/carve-skeleton.mjs`, `provision-user.sh` | not copied | `platform/scripts/` (R3) |
| `engine/plugins/`, compose-soul, soul layers | not copied | `platform/` (R3–R4) |
| Generated init templates | `user_data/*`, `gen/*` placeholders | skeleton stamps only |
| `user_data/`, `gen/` at HQ | **never copied** | R5 delete from HQ |
| `ui/`, `ios/`, `kdb/`, `.github/agents/` | not copied | HQ-only |

## Deferred

- `propagated/SOUL.md` under `platform/artifacts/` vs carve-only output.
- `ui/api/` physical move to `platform/api/` with Vercel rewire.
