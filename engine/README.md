# engine/ — carved runtime mirror

Exactly what athlete repos get post-carve. **HQ-only authoring** lives in `platform/` (soul, plugins, templates, docs).

Layout: [`docs/eng-docs/skeleton-layout.md`](../docs/eng-docs/skeleton-layout.md) · Carve: [`platform/scripts/carve-skeleton.mjs`](../platform/scripts/carve-skeleton.mjs)

## Contents (carved verbatim)

| Path | Role |
|---|---|
| `scripts/` | Sync pipeline — regenerate derived, dashboard snapshot, athlete insights, quest history, validate current week |
| `lib/` | Shared layout + schema helpers |
| `core/` | Taxonomy, query_history, rename_core |
| `.github/workflows/` | sync, validate-data, apply-coach-patch |

The composed SOUL lives once, in HQ, and the coach-chat backend bundles `platform/SOUL.chat.md`
directly (`ui/scripts/build-soul.mjs`) rather than reading anything from an athlete's repo. The
carve ships **no SOUL at all** today, so a freshly carved repo has no SOUL copy — this change does
not alter that. ADR 0022 adds a BYO Claude Code build, `platform/SOUL.claude.md`, but nothing
carves it yet; issue #358 is the change that puts a SOUL back in the carve. When it lands,
`SOUL.claude.md` is the only build ever carved — `SOUL.chat.md` is coach-chat's and never leaves
HQ. See the ADR amending 0011 for the full rationale. (Two existing athlete repos still carry the pre-retirement
`propagated/`/`.claude/`/`CLAUDE.md` files from before this change — tracked for cleanup in a
GitHub issue, not deleted yet since coach-chat is still stabilizing.)

## Not in engine/ (platform/)

Soul layers, plugins, template authoring, coach reference docs, compose/carve/provision scripts.

Operator refresh: `node platform/scripts/carve-skeleton.mjs --push`
