# engine/ — carved runtime mirror

Exactly what athlete repos get post-carve. **HQ-only authoring** lives in `platform/` (soul, plugins, templates, docs).

Layout: [`docs/eng-docs/skeleton-layout.md`](../docs/eng-docs/skeleton-layout.md) · Carve: [`platform/scripts/carve-skeleton.mjs`](../platform/scripts/carve-skeleton.mjs)

## Contents (carved verbatim)

| Path | Role |
|---|---|
| `scripts/` | Sync pipeline — regenerate derived, aggregate, quest log/history, validate current week |
| `lib/` | Shared layout + schema helpers |
| `core/` | Taxonomy, query_history, rename_core |
| `.github/workflows/` | sync, validate-data, apply-coach-patch |

Every real athlete talks to Coach Phelps exclusively through the hosted coach-chat web/iOS app —
there's no local/BYO coaching mode, so athlete repos carry no Claude Code config and no SOUL
copy. SOUL.md lives once, in HQ, and the coach-chat backend bundles `platform/SOUL.md` directly
(`ui/scripts/build-soul.mjs`) rather than reading anything from an athlete's repo. See the ADR
amending 0011 for the full rationale. (Two existing athlete repos still carry the pre-retirement
`propagated/`/`.claude/`/`CLAUDE.md` files from before this change — tracked for cleanup in a
GitHub issue, not deleted yet since coach-chat is still stabilizing.)

## Not in engine/ (platform/)

Soul layers, plugins, template authoring, coach reference docs, compose/carve/provision scripts.

Operator refresh: `node platform/scripts/carve-skeleton.mjs --push`
