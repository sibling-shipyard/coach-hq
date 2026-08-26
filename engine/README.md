# engine/ — carved runtime mirror

Exactly what athlete repos get post-carve. **HQ-only authoring** lives in `platform/` (soul, plugins, templates, docs).

Layout: [`docs/eng-docs/skeleton-layout.md`](../docs/eng-docs/skeleton-layout.md) · Carve: [`platform/scripts/carve-skeleton.mjs`](../platform/scripts/carve-skeleton.mjs)

## Contents (carved verbatim)

| Path | Role |
|---|---|
| `scripts/` | Sync pipeline — regenerate derived, dashboard snapshot, athlete insights, quest history, validate current week |
| `lib/` | Shared layout + schema helpers |
| `core/` | Taxonomy, query_history, rename_core, vs-usual baselines |
| `.github/workflows/` | sync, validate-data, apply-coach-patch |
| `claude/athlete/` | Terminal-mode athlete Claude config, carved verbatim - kept intentionally so BYOB access keeps working (issue #454) |

The carve ships `platform/SOUL.claude.md` as root `SOUL.claude.md`, plus `.claude/` and
`CLAUDE.md`, so a fresh repo boots as Coach via BYO Claude Code (issue #358, landed).
`platform/SOUL.chat.md` never leaves HQ - coach-chat bundles it directly
(`ui/scripts/build-soul.mjs`) rather than reading anything from an athlete's repo. See the ADR
amending 0011 for the full rationale. (Two existing athlete repos carry these BYOB files
pointed at `SOUL.claude.md` per the migration in `docs/plans/coach-repo-migration-and-skeleton.md`
- kept intentionally, not a cleanup item; see issue #454.)

## Not in engine/ (platform/)

Soul layers, plugins, template authoring, coach reference docs, compose/carve/provision scripts.

Operator refresh: `node platform/scripts/carve-skeleton.mjs --push`
