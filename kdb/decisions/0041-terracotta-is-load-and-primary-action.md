# 0041 — Terracotta is load and primary action, never decorative or status

- **Status:** Accepted · 2026-09-09 · iOS Builder
- **Area:** cross-cutting (ios, ui)
- **Context:** `WarmInstrument.accent`/`Theme.swift:202`'s comment says terracotta is "reserved
  for LOAD only... never a generic accent, CTA, or brand color." iOS uses it (as
  `WorkoutTimerWarm.rust`) across 5 Swift files for timer CTAs, Settings' Sync Now, and Reset
  Test Branch. Web's `--wi-rust` is a plain background across 3 CSS files — `coach-chat.css`
  (11 sites), `workout-timer-warm.css` (14 sites), and `sport-analytics.css` (22 sites) — neither
  platform following the written rule.
- **Decision:** Terracotta is load **and** primary action. Never decorative, never a status
  color (success/error/warning stay on their own tokens).
- **Why:** A rule both platforms independently dropped, the same way, is wrong, not violated.
  "Never decorative" is the half worth keeping — the Engine card only reads as special while
  terracotta stays scarce elsewhere.
- **Rejected:** Repaint the 8 files onto a new accent color, keep the load-only rule as
  written → no code moves off the color today; the rule was describing a system nothing built.
  Repainting is a real design pass nobody has asked for, tracked as a separate P2 if wanted.
- **Enforces:** No new terracotta use may be decorative or a status indicator. Primary-action
  and load uses are both fine; a third category needs its own token, not this one.
- **How to apply:** Cite this ADR instead of "load only" — `Theme.swift:202`'s comment,
  `ios/DESIGN.md`, `ui/docs/reference-interactions/Widget Design Philosophy.md`, and
  `shared/warm-instrument/ios-token-mapping.md` are updated in the same PR that adds this file.
