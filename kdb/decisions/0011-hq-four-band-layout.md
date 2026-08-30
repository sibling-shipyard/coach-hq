# 0011 — HQ five-band layout (shared, ui, ios, platform, engine)

- **Status:** Accepted · 2026-07-29 · Tech Lead
- **Area:** cross-cutting
- **Context:** HQ root mixed product surfaces, platform backend, engine IP, operator tooling and
  dogfood athlete data. M1 had already carved a clean athlete repo, so HQ needed the same band
  discipline before any more paths moved.
- **Decision:** HQ organises into five root bands. `shared/` for cross-platform fixtures and
  tokens, `ui/` for the web app and the `ui/api/` backend, `ios/`, `platform/` for HQ-only IP
  (soul, carve, contracts, plugins), and `engine/` as an exact mirror of the athlete runtime
  after carve. HQ never holds a populated athlete instance. The carve copy map lives in
  [`skeleton-layout.md`](../../docs/eng-docs/skeleton-layout.md).
- **Why:** One grep-friendly answer to what ships to athlete repos and what stays operator-only.
  Carve becomes "copy `engine/` verbatim, compose from `platform/`" instead of hunting for
  HQ-only paths inside `engine/`.
- **Rejected:** A separate repo for the platform backend → the two-repo topology is locked in
  `scaling-plan.md` · Move `ui/api/` to `platform/` now → the right logical home, but Vercel's
  root directory is `ui/`; deferred to the deploy rewire · Rename `ui/` to `frontend/` → breaks
  Vercel config.
- **Enforces:** A path's band tells you whether it ships to athletes. Before adding a root
  directory, say which band it is — if it is none of the five, it does not belong at HQ root.
