# Warm Instrument — iOS token mapping

> Status: Current · Verified: 2026-08-23

Source of truth: [`tokens.json`](./tokens.json). `generate.mjs` writes both
`ui/client/src/components/home-warm/wi-tokens.generated.css` and
`ios/CoachHQ/CoachHQ/Views/WarmInstrumentTokens.generated.swift`.
`Theme.swift` looks up sport / workout hexes from `WITokens` — do not hand-edit
those tables, or the generated CSS / Swift.

| Token (JSON path) | Web CSS var | iOS target |
|---|---|---|
| `palette.paper` | `--wi-surface` | `Theme.cardBackground` (light) |
| `palette.desk` | `--wi-page` | page / grouped background |
| `palette.surfaceMuted` | `--wi-surface-muted` | coach-read card tint |
| `palette.ink` | `--wi-ink` | `Theme.ink` |
| `palette.accent` | `--wi-rust` | load-only terracotta — **not** generic accent |
| `palette.alarmBg` / `alarmFg` | alarm flood classes | cold indigo-grey alarm |
| `radius.cardWebPx` | card shell (26px) | scale to `radius.cardIosPt` (16–20pt) |
| `sports.*.hex` | `--wi-badminton`, `--wi-weights`, etc. | `WITokens.Sports` via `Theme` / `WarmInstrument.Sport` |
| `workouts.*.hex` | `--wi-workout-foundation`, etc. | `WITokens.Workouts` via `Theme.foundationColor`, etc. |

**Typography:** SF Pro replaces Space Grotesk; SF Mono / `.monospacedDigit()` replaces Space
Mono. Coach voice: Newsreader italic vs system serif italic — open decision (see
`ios/DESIGN.md`).

**Regenerate:** `node shared/warm-instrument/generate.mjs` (or `npm run generate-tokens` from `ui/`)
