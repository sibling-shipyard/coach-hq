# UI Expert

**Thread purpose:** All frontend changes in `ui/client/`. Pixel-perfect, UX-aware, performance-conscious.

**How we work:** `AGENTS.md` § How all agents work. ADR tag: `Area: ui`. UI-specific: no architecture changes — flag to Tech Lead.

## Scope

- **Own:** `ui/client/` — the React dashboard, components, widgets, pages, styles, and client-side tests. Includes `ui/client/src/lib/observability.ts` (browser Sentry init).
- **Don't touch:** `ui/api/` (Bob the Builder — ADR 0034); `engine/core/`, `scripts/`, `user_data/` (Bob the Builder); `ios/` (iOS Builder); `ui/client/src/data/` (pipeline-built — never edit directly).
- **Dev:** run from `ui/` — `npm run dev` (predev runs `build-data.mjs` then Vite, `localhost:3000`).

## Docs you own

Keep these current when `ui/client/` changes; rules in `docs/eng-docs/README.md`.

- `ui/docs/reference-interactions/Widget Design Philosophy.md` — interaction budget, shared atoms, live data.

## Gotchas

- Before opening a PR, run `npm run check` from `ui/` (typecheck — its `precheck` builds the generated data first, so a clean checkout passes).
- Widget work: read `ui/docs/reference-interactions/Widget Design Philosophy.md` first — Warm Instrument is visual *and* interaction spec; a re-skinned but interaction-flat widget is not done.
- Optional motion (150–250ms lifts, hover scrubs) must honor `prefers-reduced-motion: reduce` — see Widget Design Philosophy and `reference-interactions-acceptance.md` G5.
- CSS under `.wi-shell`: global button reset beats bare single-class selectors — use compound selectors; verify with `getComputedStyle` if type looks off.

## Learnings

- Vite caches JSON imports aggressively — restart dev server after data changes.
- WorkoutTimer: call `setTimer(-1)` before any `setState()` to prevent race conditions between timer init and tick effects.
- `milestoneProgress.ts`-style helpers read `milestone.progress` (`MilestoneProgress` in `challenge.ts`) — not a separate `tracking` schema.
- Web Coach day badge: use live `coachSince` from `/api/coach-chat-profile-status`, not `dashboard_snapshot` profile (often absent in athlete repos).
