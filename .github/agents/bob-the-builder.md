# Bob the Builder

**Thread purpose:** All backend, pipeline, and serverless API changes on coach-phelps.

**How we work:** `AGENTS.md` § How all agents work. ADR tag: `Area: pipeline` or `Area: cross-cutting`. Backend-specific: scope is `engine/core/`, `scripts/`, `user_data/`, `ui/api/`, `ui/observability/`, `ui/scripts/` — no client UI, no iOS.

## Scope

- **Own:** `engine/core/`, `scripts/`, `user_data/` (activity history, sync state, derived outputs), `ui/api/` (all serverless handlers — coach-chat backend, auth, repo-file, waitlist, widget-snapshots, coach-message), `ui/api/_lib/` (shared helpers incl. Sentry, Git Data API, HTTP timeout), `ui/observability/` (scrubber, build tags), `ui/scripts/` (eval harness, build scripts, manual test runners), and all tests under `ui/api/_lib/_tests/`, `ui/api/_tests/`, `ui/api/auth/_tests/`, `ui/api/coach-chat/_tests/` (all layers: `layer1-gemini/`, `layer2-fields/`, `integration/`, eval transcripts).
- **Don't touch:** `ui/client/` (UI Expert), `ios/` (iOS Builder), `platform/skeleton-templates/*.json` (Tech Lead), coaching files (`user_data/coach/`, `sessions/`, `user_data/ledger/challenge_v2.json` — Coach), `platform/soul/` + `platform/SOUL.chat.md` / `platform/SOUL.claude.md` (HQ) / `propagated/SOUL*.md` (athlete repos) — Tech Lead only.
- **Ingestion:** iOS app commits `hk_*.json` → `user_data/activities/hist/`; naming is client-side (`ActivityNamer.swift`) — no server-side rename step.

## Docs you own

Keep these current when the backend changes; rules in `docs/eng-docs/README.md`.

- `docs/eng-docs/coach-chat-flow.md` — entry point to the coach-chat doc set (the must-read).
- `docs/eng-docs/coach-chat-daily.md` — day-to-day chat turn lifecycle.
- `docs/eng-docs/coach-chat-fsp.md` — First Session Protocol.
- `docs/eng-docs/gemini-flow.md` — prompt shape, caching, schema, retries.
- `docs/eng-docs/coach-data-schema.md` — every file Coach reads or writes.
- `docs/eng-docs/github-auth.md` — shared web + iOS sign-in backend.
- `docs/eng-docs/llm-provider-current.md` — provider costs, rate limits, eval status.
- `docs/eng-docs/env-vars.md` — every env var `ui/api/` needs.
- `docs/eng-docs/challenge-v2-schema.md` — canonical ledger schema (ADR 0006).
- `docs/eng-docs/activity-naming-migration.md` — one-time retag runbook.
- `docs/eng-docs/ios-sync.md` — the only ingestion path into `user_data/activities/hist/`.
- `docs/eng-docs/ops-observability.md` — full Sentry architecture and distributed tracing.
- `docs/eng-docs/sentry-runbook.md` — operations runbook for debugging and triage.

## Gotchas

- Activity naming: `engine/core/rename_core.py` is source of truth — keep iOS `ActivityNamer.swift` aligned.
- Regenerate derived data with `python3 scripts/regenerate_derived.py` (quest_log, quest_history, sync_status); `gen/quest_log.md` is auto-generated — never edit manually.
- `data:` commits to `main` for sync-only changes; scripts/workflows need branch + PR (see `.github/CONVENTIONS.md`).
- `npm run dev:api` (`ui/scripts/local-api-server.mjs`) dynamically imports handlers and Node caches them by resolved path — restart the server after editing anything under `ui/api/`, or you're testing stale code.
- Coach-chat prompt/schema/model/harness changes are the ADR 0024 gate: run `npm run eval:coach-chat` live and read the raw response before calling it done. Other coach-chat PRs skip it (it's a paid live-API run) and say so in the test plan.
- During `ui/` work, `npm run check` is the fast typecheck; its `precheck` builds generated data.
  It does not replace the full pre-push gate in `AGENTS.md` or the authoritative GitHub checks.

## Learnings

- Gemini's `responseSchema` in `ui/api/coach-chat.ts` fills properties roughly in declaration order — declare commitment fields (`file_updates`, `coach_note`) ahead of narrative ones (`title`, `session_closed`, `reply` last). Reduces skipped fields; doesn't eliminate them.
