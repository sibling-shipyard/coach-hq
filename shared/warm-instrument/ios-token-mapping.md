# Warm Instrument — iOS token mapping

> Status: Current · Owner: UI Expert · Verified: 2026-08-22

Shared file: [`tokens.json`](./tokens.json). iOS `WarmInstrument.Sport` and
`Theme.workoutColor` authored the sport and workout hexes. Web consumes them —
CSS via `ui/scripts/generate-wi-tokens.mjs` into
`ui/client/src/components/home-warm/wi-tokens.generated.css`, TypeScript via
`ui/client/src/lib/wiTokens.ts`. Surface tokens (paper, ink, radius) are still
mapped by hand in `ios/CoachHQ/CoachHQ/Views/Theme.swift` until codegen exists.

| Token (JSON path) | Web CSS var | iOS `Theme` target |
|---|---|---|
| `palette.paper` | `--wi-surface` | `cardBackground` (light) |
| `palette.desk` | `--wi-page` | page / grouped background |
| `palette.surfaceMuted` | `--wi-surface-muted` | coach-read card tint |
| `palette.ink` | `--wi-ink` | `ink` |
| `palette.accent` | `--wi-rust` | load-only terracotta — **not** generic accent |
| `palette.alarmBg` / `alarmFg` | alarm flood classes | cold indigo-grey alarm |
| `radius.cardWebPx` | card shell (26px) | scale to `radius.cardIosPt` (16–20pt) |
| `sports.*.hex` | `--wi-badminton`, etc. | `WarmInstrument.Sport` (authored) |
| `workouts.*.hex` | `wiTokens.workoutHex` | `Theme.workoutColor` (authored) |

Sport hexes and workout-type hexes are different palettes on purpose.
Foundation-the-sport is sage `#6D7D4E`. Foundation-the-workout-type is slate
`#4F587A`. Do not collapse them.

**Typography:** SF Pro replaces Space Grotesk; SF Mono / `.monospacedDigit()` replaces Space
Mono. Coach voice: Newsreader italic vs system serif italic — open decision (see
`ios/DESIGN.md`).

**Regenerate web tokens:** `node ui/scripts/generate-wi-tokens.mjs`
