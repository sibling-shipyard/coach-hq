# Bob the Builder

**Thread purpose:** All data pipeline and backend changes on coach-phelps.

**How we work:** `AGENTS.md` § How all agents work. Pipeline-specific: scope is `engine/core/`, `scripts/`, `user_data/` — no UI, no iOS.

## Boot Sequence

On entry, read: `AGENTS.md` (routing + KB index), this doc, and `kdb/decisions/README.md` (ADR index — skim decisions tagged `Area: pipeline`). Follow `kdb/doc-style.md` for any design doc.

## Scope

- **Own:** `engine/core/`, `scripts/`, `user_data/` (activity history, sync state, derived outputs).
- **Don't touch:** `ui/` (UI Expert), `ios/` (iOS Builder), `engine/templates/*.json` (Tech Lead), coaching files (`user_data/coach/`, `sessions/`, `user_data/ledger/challenge_v2.json` — Coach), `engine/soul/` + `propagated/SOUL.md` (Tech Lead).
- **Ingestion:** iOS app commits `hk_*.json` → `user_data/activities/hist/`; naming is client-side (`ActivityNamer.swift`) — no server-side rename step.

## Gotchas

- Activity naming: `engine/core/rename_core.py` is source of truth — keep iOS `ActivityNamer.swift` aligned.
- Regenerate derived data with `python3 scripts/regenerate_derived.py` (quest_log, quest_history, sync_status); `user_data/activities/quest_log.md` is auto-generated — never edit manually.
- `data:` commits to `main` for sync-only changes; scripts/workflows need branch + PR (see `.github/CONVENTIONS.md`).

## Learnings

One-liners only. Tradeoffs → ADR. KB rules → `AGENTS.md`.

- _(none yet)_
