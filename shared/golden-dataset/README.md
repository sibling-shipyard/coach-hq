# Golden dataset

One fake athlete, real schema. This is the sample data I show when there's no real athlete
data to show: the internal `/gallery` widget gallery, the localhost dev fallback for the Warm
Instrument home, the `/welcome` marketing page, and iOS SwiftUI previews.

## Files

- `widget_snapshots.json` — a `WidgetSnapshotsFile`, same shape as the pipeline-generated
  `gen/widget_snapshots.json`. Schema owned by
  `ui/client/src/components/home-warm/snapshots.ts`.
- `current_week.json` — a `CurrentWeekContract`, same shape as a real current-week file.
  Schema owned by `ui/client/src/components/home-warm/currentWeek.fixture.ts`.

I reuse the real schemas on purpose (see ADR-0005 and ADR-0007): no new types on either
platform, and if a schema changes, this data fails to compile/decode instead of silently
drifting.

## Who reads this

- Web: `ui/client/src/lib/goldenDataset.ts` imports both files through the `@golden` alias and
  re-exports them typed.
  - `/gallery` (`WidgetGallery.tsx`)
  - Warm Instrument home's localhost-dev fallback (`WarmInstrumentHome.tsx`)
  - `/welcome` marketing page (`WelcomePage.tsx`)
- iOS: `GoldenDataset.swift` bundles `widget_snapshots.json` and decodes it with the existing
  `WidgetSnapshots.swift` models, for SwiftUI `#Preview`s.

## iOS copy

iOS bundles its own copy at
`ios/CoachPhelps/CoachPhelps/Resources/golden_widget_snapshots.json`, manually synced from
`widget_snapshots.json` here — same "manual sync until codegen" convention as
`shared/warm-instrument/ios-token-mapping.md` uses for design tokens. If you change
`widget_snapshots.json`, copy it over the iOS Resources file too, or the two will drift.

## Changing a value

This folder only carries values, not shape. If you change a number here, check all the
consumers above still read sensibly — a change here is instantly visible on the marketing
page, the gallery, and iOS previews at once. `generated_at` in `widget_snapshots.json` must
stay a frozen literal, not `new Date()`, so builds stay deterministic.

This is fake data. It must never be shown to a signed-in athlete as if it were their own.
