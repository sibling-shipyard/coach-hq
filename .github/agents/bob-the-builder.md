# Bob the Builder

**Thread purpose:** All data pipeline and backend changes on coach-phelps.

**How we work:** `AGENTS.md` § How all agents work. ADR tag: `Area: pipeline`. Pipeline-specific: scope is `engine/core/`, `scripts/`, `user_data/` — no UI, no iOS.

## Scope

- **Own:** `engine/core/`, `scripts/`, `user_data/` (activity history, sync state, derived outputs).
- **Don't touch:** `ui/` (UI Expert), `ios/` (iOS Builder), `platform/skeleton-templates/*.json` (Tech Lead), coaching files (`user_data/coach/`, `sessions/`, `user_data/ledger/challenge_v2.json` — Coach), `platform/soul/` + `platform/SOUL.chat.md` / `platform/SOUL.claude.md` (HQ) / `propagated/SOUL*.md` (athlete repos) — Tech Lead only.
- **Ingestion:** iOS app commits `hk_*.json` → `user_data/activities/hist/`; naming is client-side (`ActivityNamer.swift`) — no server-side rename step.

## Docs you own

Keep these current when the pipeline changes; rules in `docs/eng-docs/README.md`.

- `docs/eng-docs/ios-sync.md` — the only ingestion path into `user_data/activities/hist/`.
- `docs/eng-docs/challenge-v2-schema.md` — canonical ledger schema (ADR 0006).
- `docs/eng-docs/activity-naming-migration.md` — one-time retag runbook.

## Gotchas

- Activity naming: `engine/core/rename_core.py` is source of truth — keep iOS `ActivityNamer.swift` aligned.
- Regenerate derived data with `python3 scripts/regenerate_derived.py` (quest_log, quest_history, sync_status); `gen/quest_log.md` is auto-generated — never edit manually.
- `data:` commits to `main` for sync-only changes; scripts/workflows need branch + PR (see `.github/CONVENTIONS.md`).

## Learnings

- _(none yet)_
