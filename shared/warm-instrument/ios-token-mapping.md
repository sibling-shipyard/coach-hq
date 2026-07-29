# Warm Instrument — iOS token mapping

Source of truth: [`tokens.json`](./tokens.json).

| Output | Generator |
|---|---|
| Web CSS (`wi-tokens.generated.css`) | `node ui/scripts/generate-wi-tokens.mjs` |
| iOS Swift (`WarmInstrumentTokens.generated.swift`) | `node ios/scripts/generate-wi-tokens.swift.mjs` |

Both read the same JSON. iOS codegen runs automatically via an Xcode pre-build phase on
`CoachHQWidgetExtension` (before the main app embeds the widget).

## Token map

| Token (JSON path) | Web CSS var | iOS generated | App wrapper |
|---|---|---|---|
| `palette.paper` | `--wi-surface` | `Palette.paper` | `Theme.cardBackground` (light) |
| `palette.desk` | `--wi-page` | `Palette.desk` | `Theme.mutedBackground` (light) |
| `palette.surfaceMuted` | `--wi-surface-muted` | `Palette.surfaceMuted` | `WarmInstrument.surfaceMuted` (light) |
| `palette.ink` | `--wi-ink` | `Palette.ink` | `Theme.ink` (light) |
| `palette.inkMuted` / `inkFaint` | — | `Palette.inkMuted` / `inkFaint` | `WarmInstrument.*` |
| `palette.accent` | `--wi-rust` | `Palette.accent` | load-only terracotta |
| `palette.alarmBg` / `alarmFg` | alarm classes | `Palette.alarmBg` / `alarmFg` | `WarmInstrument.*` |
| `lines.border` / `borderDashed` | `--wi-line*` | `Lines.*` | `Theme.cardBorder` / `WarmInstrument.borderDashed` |
| `lines.headerRule` | — | `Lines.headerRule` | `WarmInstrument.headerRule` |
| `shadows.card` / `engine` | `--wi-*-shadow` | `Shadows.*` | `WarmInstrument.*` |
| `radius.cardIosPt` | scaled from `cardWebPx` | `cardRadius` | `Theme.cornerRadius` |
| `sports.*.hex` | `--wi-*` | `sportColors[WarmSportId]` | `WarmInstrument.sportColor` |

Dark-mode adaptive colors (elevated dark surfaces, lighter ink) remain hand-authored in
`Theme.swift`; codegen supplies light-mode bases via `Palette.UI`.

**Typography:** SF Pro replaces Space Grotesk; SF Mono / `.monospacedDigit()` replaces Space
Mono. Coach voice: Newsreader italic vs system serif italic — open decision (see
`ios/DESIGN.md`).
