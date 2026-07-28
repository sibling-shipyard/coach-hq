# 0007 — One golden dataset for all sample data

- **Status:** Accepted · 2026-07-28 · Tech Lead
- **Area:** cross-cutting
- **Context:** Fake data had grown in three unrelated places on web — gallery fixtures, a
  current-week fixture, and hardcoded consts inside the marketing Welcome page — and iOS had
  none at all, so previews and product screens had nothing real to show.
- **Decision:** One hand-authored golden dataset lives in `shared/golden-dataset/`, written in
  the same schemas as the real pipeline data (`WidgetSnapshotsFile`, `CurrentWeekContract`
  from `ui/client/src/components/home-warm/snapshots.ts` and `currentWeek.fixture.ts`). Web
  reads it through `ui/client/src/lib/goldenDataset.ts`; iOS bundles the same JSON and decodes
  it with the existing `WidgetSnapshots.swift` models. Marketing copy is not data and stays in
  the web app (`welcomeCopy.ts`).
- **Why:** Reusing the real schema means zero new types on either platform, and it keeps the
  fake data honest — if the schema changes, the sample data fails to typecheck or decode
  instead of drifting quietly. One folder also means one place to update when the sample story
  needs to change, instead of three.
- **Rejected:** Fixtures next to each component (what we had) — three copies that drift
  independently. Generating the golden file from real athlete data — leaks private data into a
  public marketing page. A new sample-only schema — a second contract to keep in sync with
  ADR-0005's real one, for no gain.
