# 0007 — One golden dataset for all sample data

- **Status:** Accepted · 2026-07-28 · Tech Lead
- **Area:** cross-cutting
- **Context:** Fake data had grown in three unrelated places on web, and iOS had none, so
  previews and product screens had nothing real to show. The two consumer groups also differ.
  `/gallery` and `/welcome` read pre-baked snapshots and never ask what today is. Home, Workouts
  and Coach Chat compute their own numbers off the wall clock. A hand-typed fixture with
  frozen dates looks right the day it is written and goes stale every day after.
- **Decision:** `shared/golden-dataset/` holds two layers. A static committed layer in the real
  `WidgetSnapshotsFile` / `CurrentWeekContract` schemas, and a generated gitignored layer whose
  dates are computed from `Date.now()` at build time. Build detail lives in
  [`golden-dataset.md`](../../docs/eng-docs/golden-dataset.md).
- **Why:** Reusing the real schemas adds no new types and keeps the fake data honest — a schema
  change breaks the typecheck instead of drifting. The static/generated split matches the only
  way the two consumer groups actually differ.
- **Rejected:** Fixtures beside each component → copies that drift apart · Generating from real
  athlete data → leaks private data onto a public page · A sample-only schema → a second contract
  to keep in sync with 0005, for nothing · Hand-typing the generated layer's dates → correct for
  one day, wrong every day after.
- **Enforces:** Sample data is generated from the production schema, never hand-typed beside the
  component that renders it. A fixture that freezes a date must be read only by consumers that
  never ask what today is.
