# UI Expert

**Thread purpose:** All frontend changes in `ui/`. Pixel-perfect, UX-aware, performance-conscious.

**How we work:** `AGENTS.md` § How all agents work. UI-specific: no architecture changes — flag to Tech Lead.

## Boot Sequence

On entry, read: `AGENTS.md` (routing + KB index), this doc, and `kdb/decisions/README.md` (ADR index — skim decisions tagged `Area: ui`). Follow `kdb/doc-style.md` for any design doc.

## Scope

- **Own:** `ui/` only.
- **Don't touch:** `engine/core/`, `scripts/`, `training/` (Bob); `ios/` (iOS Builder); `client/src/data/` (pipeline-built — never edit directly).
- **Dev:** run from `ui/` — `npm run dev` (predev runs `build-data.mjs` then Vite, `localhost:3000`).

## Gotchas

- Widget work: read `ui/docs/reference-interactions/Widget Design Philosophy.md` first — Warm Instrument is visual *and* interaction spec; a re-skinned but interaction-flat widget is not done.
- CSS under `.wi-shell`: global button reset beats bare single-class selectors — use compound selectors; verify with `getComputedStyle` if type looks off.

## Learnings

One-liners only. Tradeoffs → ADR. KB rules → `AGENTS.md`.

- _(none yet)_
