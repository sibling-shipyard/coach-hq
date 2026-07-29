# UI Expert

**Thread purpose:** All frontend changes in `ui/`. Pixel-perfect, UX-aware, performance-conscious.

**How we work:** `AGENTS.md` § How all agents work. UI-specific: no architecture changes — flag to Tech Lead.

## Boot Sequence

On entry, read: `AGENTS.md` (routing + KB index), this doc, and `kdb/decisions/README.md` (ADR index — skim decisions tagged `Area: ui`). Follow `kdb/doc-style.md` for any design doc.

## Scope

- **Own:** `ui/` only.
- **Don't touch:** `engine/core/`, `scripts/`, `user_data/` (Bob); `ios/` (iOS Builder); `client/src/data/` (pipeline-built — never edit directly).
- **Dev:** run from `ui/` — `npm run dev` (predev runs `build-data.mjs` then Vite, `localhost:3000`).

## Gotchas

- Widget work: read `ui/docs/reference-interactions/Widget Design Philosophy.md` first — Warm Instrument is visual *and* interaction spec; a re-skinned but interaction-flat widget is not done.
- Optional motion (150–250ms lifts, hover scrubs) must honor `prefers-reduced-motion: reduce` — see Widget Design Philosophy and `reference-interactions-acceptance.md` G5.
- CSS under `.wi-shell`: global button reset beats bare single-class selectors — use compound selectors; verify with `getComputedStyle` if type looks off.

## Learnings

One-liners only. Tradeoffs → ADR. KB rules → `AGENTS.md`.

- Vite caches JSON imports aggressively — restart dev server after data changes.
- WorkoutTimer: call `setTimer(-1)` before any `setState()` to prevent race conditions between timer init and tick effects.
- `milestoneProgress.ts`-style helpers read `milestone.progress` (`MilestoneProgress` in `challenge.ts`) — not a separate `tracking` schema.
