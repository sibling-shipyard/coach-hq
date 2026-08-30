# 0035 — Cross-surface error taxonomy

- **Status:** Accepted · 2026-08-30 · Tech Lead
- **Area:** cross-cutting (observability, web, iOS, coach-chat API)
- **Context:** Web, API, and iOS send errors to three Sentry projects. The same failure is a different native class on each surface, so a dashboard cannot ask "is sync broken everywhere?"
- **Decision:** Every captured event carries an `operation` tag. Browser errors use `web` (`observability.ts`). API errors use the route with slashes turned to dots (`apiOperation()` in `sentry.ts`, e.g. `auth.callback`). iOS uses the native name (`rage_report`, `healthkit.sync`). A new cross-surface feature reuses one shared string, not a new one per surface. Rage Reports group by fingerprint `rage_report` (#699). They arrive as `event.type:default` because `capture(message:)` sends that, not because of ADR 0032.
- **Why:** Grouping by native error class splits one outage into three issues. The tag is the pivot Cyclops and the dashboard already query.
- **Rejected:** Rename native error classes before capture → loses the stack. Invent a parallel `issue_category` tag (`ui_glitch`, `sync_failure`) → nothing reads it. Mandate `<domain>.<action>` as the only format → contradicts `web` and `rage_report` the day this lands.
- **Enforces:** A PR that adds a cross-surface feature uses the same `operation` string on every surface it touches. It does not add a second tag for the same idea.
