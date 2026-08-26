# 0011 — HQ four-band layout (shared, ui, ios, platform, engine)

- **Status:** Accepted · 2026-07-29 · Tech Lead
- **Area:** cross-cutting
- **Context:** HQ root mixes product surfaces, platform backend, engine IP, operator tooling, and dogfood athlete data (`user_data/`, `gen/`). M1 carved a clean athlete repo; HQ needs the same band discipline before more path moves.
- **Decision:** HQ organizes into five root bands — `shared/` (cross-platform fixtures + tokens), `ui/` (web + `ui/api/` platform backend), `ios/`, `platform/` (HQ IP: soul, carve/provision, contracts, plugins), `engine/` (exact mirror of athlete runtime post-carve). HQ never holds populated athlete instances.
- **Why:** One grep-friendly story for what ships to athlete repos vs what stays operator-only. Carve becomes "copy `engine/` verbatim + compose from `platform/`" instead of hunting HQ-only paths inside `engine/`.
- **Rejected:** New GitHub repo for platform backend → two-repo topology locked ([`scaling-plan.md`](../../docs/eng-docs/scaling-plan.md)). Move `ui/api/` to `platform/` now → correct logical home but Vercel Root Directory is `ui/`; defer until deploy rewire (P2). Rename `ui/` → `frontend/` → breaks Vercel config.

## Carve copy map

Authority: `platform/scripts/carve-skeleton.mjs`. Milestones: [`hq-restructure-plan.md`](../../docs/eng-docs/hq-restructure-plan.md).

**Amended by [0021](0021-coach-chat-reads-soul-directly-terminal-mode-retired.md):** SOUL no
longer propagates to athlete repos at all, and terminal/BYO-Claude coaching is retired from new
carves — the `propagated/SOUL.md`, `propagated/docs/`, and `engine/claude/athlete/` rows below no
longer apply to the skeleton template. They're kept here for historical/audit reference and
because the two existing live athlete repos still carry those files pending 0021's tracked
cleanup issue.

| Source (HQ) | Skeleton destination | Band |
|---|---|---|
| `engine/scripts/` (5 runtime + validate wrapper) | `engine/scripts/` | `engine/` |
| `engine/lib/`, `engine/core/` | `engine/` | `engine/` |
| `engine/.github/workflows/` (3 user workflows) | `.github/workflows/` | `engine/` |
| `platform/skeleton-templates/` (2 samples) | `user_data/.../templates/` | `platform/` |
| `platform/scripts/carve-skeleton.mjs` | not copied | `platform/` |
| `platform/plugins/` | not copied | `platform/` |
| Generated init templates | `user_data/*`, `gen/*` placeholders | skeleton stamps only |
| `user_data/`, `gen/` at HQ | **never copied** | R5 ✓ deleted from HQ |
| `ui/`, `ios/`, `kdb/`, `.github/agents/` | not copied | HQ-only |
| ~~`engine/claude/athlete/` → root Claude config~~ | ~~`.claude/`, `CLAUDE.md`~~ | retired, see 0021 |
| ~~`platform/scripts/compose-soul.mjs` + `platform/soul/`~~ | ~~`propagated/SOUL.md`~~ | retired, see 0021 |
| ~~`docs/ref-docs/` (5 refs) + `platform/skills/pipeline-tools.md`~~ | ~~`propagated/docs/`~~ | retired, see 0021 |

## Deferred

- `ui/api/` physical move to `platform/api/` with Vercel rewire.
