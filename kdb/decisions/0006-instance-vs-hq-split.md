# 0006 — Instance vs HQ repo split (M1 topology)

- **Status:** Accepted · 2026-07-25 · Tech Lead
- **Area:** cross-cutting
- **Context:** M0 split the engine in hq; M1 needs three repos — shared UI, canonical skeleton, and lean per-user instances — without copying `ui/` or `ios/` into every athlete repo.
- **Decision:** `coach-phelps-hq` holds the shared dashboard + API only. `coach-engine` holds Soul A+B, validators, templates, Strava/sync pipeline, and an empty Layer C skeleton. Each `coach-<user>` instance holds migrated Layer C data + history + a pinned copy of the engine; it produces `data/aggregate.json` (schema v1) for the hosted UI repo-as-CDN fetch. Fresh instances are stamped via `provision-user.sh`; legacy monoliths are migrated with `migrate-layer-c.py` then archived after cutover.
- **Why:** One UI deploy serves N users; engine updates propagate from one canonical skeleton; instances stay small and ownership-scoped for the GitHub App install model (ADR 0001).
- **Rejected:** Propagate-in-place on legacy repos → entangled history and mixed ui/engine trees. Full monolith per user → duplicates Vercel UI and blocks centralized engine versioning.
