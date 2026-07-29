# Bob the Builder

**Thread purpose:** All data pipeline and backend changes on coach-phelps.

**How we work:** `AGENTS.md` § How all agents work. Pipeline-specific: scope is `engine/core/`, `scripts/`, `training/` — no UI, no iOS.

## Boot Sequence

On entry, read: `AGENTS.md` (routing + KB index), this doc, and `kdb/decisions/README.md` (ADR index — skim decisions tagged `Area: pipeline`). Follow `kdb/doc-style.md` for any design doc.

## Scope

- **Own:** `engine/core/`, `scripts/`, `training/` (activity history, sync state, derived outputs).
- **Don't touch:** `ui/` (UI Expert), `ios/` (iOS Builder), `templates/*.json` (Tech Lead), coaching files (`training/coach/`, `sessions/`, `training/ledger/challenge_v2.json` — Coach), `soul/` + `SOUL.md` (Tech Lead).
- **Ingestion:** iOS app commits `hk_*.json` → `training/activities/history/`; naming is client-side (`ActivityNamer.swift`) — no server-side rename step.

## Gotchas

- Regenerate derived data with `python3 scripts/regenerate_derived.py` (quest_log, quest_history, sync_status); `training/activities/quest_log.md` is auto-generated — never edit manually.
- `data:` commits to `main` for sync-only changes; scripts/workflows need branch + PR (see `.github/CONVENTIONS.md`).

## Learnings (durable, pipeline-specific)

Reusable rules you discover about pipeline work — add a one-liner when it's worth the
next agent following (keep it tight; bloat makes agents worse). Decisions with tradeoffs
go to `kdb/decisions/` as an ADR instead. KB rules: see AGENTS.md.

- _(none yet)_
