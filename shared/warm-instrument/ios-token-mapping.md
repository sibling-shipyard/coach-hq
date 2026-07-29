# Warm Instrument — iOS token mapping

Source of truth: [`tokens.json`](./tokens.json). Web CSS is generated into
`ui/client/src/components/home-warm/wi-tokens.generated.css`. iOS maps the same hex values
in `ios/CoachHQ/CoachHQ/Views/Theme.swift` (manual sync until codegen).

| Token (JSON path) | Web CSS var | iOS `Theme` target |
|---|---|---|
| `palette.paper` | `--wi-surface` | `cardBackground` (light) |
| `palette.desk` | `--wi-page` | page / grouped background |
| `palette.surfaceMuted` | `--wi-surface-muted` | coach-read card tint |
| `palette.ink` | `--wi-ink` | `ink` |
| `palette.accent` | `--wi-rust` | load-only terracotta — **not** generic accent |
| `palette.alarmBg` / `alarmFg` | alarm flood classes | cold indigo-grey alarm |
| `radius.cardWebPx` | card shell (26px) | scale to `radius.cardIosPt` (16–20pt) |
| `sports.*.hex` | `--wi-badminton`, etc. | sport color properties |

**Typography:** SF Pro replaces Space Grotesk; SF Mono / `.monospacedDigit()` replaces Space
Mono. Coach voice: Newsreader italic vs system serif italic — open decision (see
`ios/DESIGN.md`).

**Regenerate web tokens:** `node ui/scripts/generate-wi-tokens.mjs`
