# engine/ — carved runtime mirror

Exactly what athlete repos get post-carve. **HQ-only authoring** lives in `platform/` (soul, plugins, templates, docs).

Layout: [`docs/engineering/skeleton-layout.md`](../docs/engineering/skeleton-layout.md) · Carve: [`platform/scripts/carve-skeleton.mjs`](../platform/scripts/carve-skeleton.mjs)

## Contents (carved verbatim)

| Path | Role |
|---|---|
| `scripts/` | Sync pipeline — regenerate derived, aggregate, quest log/history, validate current week |
| `lib/` | Shared layout + schema helpers |
| `core/` | Taxonomy, query_history, rename_core |
| `claude/athlete/` | BYO Claude config (→ repo root on carve) |
| `.github/workflows/` | sync, validate-data, apply-coach-patch |

## Not in engine/ (platform/)

Soul layers, plugins, template authoring, coach reference docs, compose/carve/provision scripts.

Operator refresh: `node platform/scripts/carve-skeleton.mjs --push`
