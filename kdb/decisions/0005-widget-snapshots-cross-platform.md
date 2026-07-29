# 0005 — Widget snapshots as the cross-platform contract

- **Status:** Accepted · 2026-07-24 · Tech Lead
- **Area:** ui
- **Context:** Warm Instrument home widgets exist on web (`home-warm/`) with model logic in
  TypeScript. iOS in-app Home and WidgetKit need the same figures without re-implementing
  analytics. Sport colors and design tokens already diverged between `Theme.swift` and
  `warm-instrument.css`.
- **Decision:** Treat **widget snapshots** (typed JSON, generated at build/sync time) as the
  portable API between platforms. TypeScript models remain the source of truth; the pipeline
  writes `training/widget_snapshots.json` (copied to `ui/client/src/data/`). Design tokens
  live in `shared/warm-instrument/tokens.json`; web CSS via `ui/scripts/generate-wi-tokens.mjs`,
  iOS via `ios/scripts/generate-wi-tokens.swift.mjs` (Xcode pre-build). Views stay native —
  React on web, SwiftUI on iOS.
- **Why:** WidgetKit cannot run TS model code at render time; iOS Home should not fork
  analytics logic. One snapshot schema keeps web, in-app Home, and home-screen widgets aligned.
  Web keeps client-side models for interactive widgets (plan drag, hover scrub); snapshots
  serve glance surfaces and iOS.
- **Rejected:** Shared React Native / WebView widgets → wrong platform feel, heavy bundle.
  Port all model logic to Swift by hand → guaranteed drift. Monorepo TS package consumed by
  iOS via JavaScriptCore → fragile, no WidgetKit benefit.
