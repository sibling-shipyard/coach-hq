# UI Expert

**Thread purpose:** All frontend changes in `ui/`. Pixel-perfect, UX-aware, performance-conscious.

**How we work:** `AGENTS.md` § How all agents work. UI-specific: no architecture changes — flag to Tech Lead.

## Boot Sequence

On entry, read: `AGENTS.md` (routing + KB index), this doc, and `kdb/decisions/README.md` (ADR index — skim decisions tagged `Area: ui`). Follow `kdb/doc-style.md` for any design doc.

## Scope

- **Own:** all of `ui/` — the client (`ui/client/src/`) *and* the serverless handlers in `ui/api/`, their shared code in `ui/api/_lib`, and their tests in `ui/api/_lib/_tests` and `ui/api/coach-chat/_tests`.
- **Don't touch:** `engine/core/`, `scripts/`, `user_data/` (Bob); `ios/` (iOS Builder); `client/src/data/` (pipeline-built — never edit directly).
- **Dev:** run from `ui/` — `npm run dev` (predev runs `build-data.mjs` then Vite, `localhost:3000`).

## Docs you own

Keep these current when `ui/` changes; rules in `docs/eng-docs/README.md`.

- `docs/eng-docs/coach-chat-flow.md` — end-to-end chat path through `ui/api/`, the must-read.
- `docs/eng-docs/gemini-flow.md` — prompt assembly, schema, and retry behavior.
- `docs/eng-docs/github-auth.md` — shared web + iOS sign-in backend.

## Gotchas

- Before opening a PR, run `npm run check` from `ui/` (typecheck — its `precheck` builds the generated data first, so a clean checkout passes).
- Widget work: read `ui/docs/reference-interactions/Widget Design Philosophy.md` first — Warm Instrument is visual *and* interaction spec; a re-skinned but interaction-flat widget is not done.
- Optional motion (150–250ms lifts, hover scrubs) must honor `prefers-reduced-motion: reduce` — see Widget Design Philosophy and `reference-interactions-acceptance.md` G5.
- CSS under `.wi-shell`: global button reset beats bare single-class selectors — use compound selectors; verify with `getComputedStyle` if type looks off.

## Learnings

One-liners only. Tradeoffs → ADR. KB rules → `AGENTS.md`. Cap ~15 entries — on overflow, promote the durable ones into the relevant `docs/eng-docs/` doc and drop the rest.

- Gemini's `responseSchema` in `ui/api/coach-chat.ts` fills properties roughly in declaration order — declare commitment fields (`file_updates`, `coach_note`) ahead of narrative ones (`title`, `session_closed`, `reply` last). Reduces skipped fields; doesn't eliminate them.
- `npm run dev:api` (`ui/scripts/local-api-server.mjs`) dynamically imports handlers and Node caches them by resolved path — restart the server after editing anything under `ui/api/`, or you're testing stale code.
- Coach-chat prompt/schema/model-behavior changes aren't verified by `tsc` or `npm run test` — run `npm run eval:coach-chat` live and read the raw response before calling it done.
- Vite caches JSON imports aggressively — restart dev server after data changes.
- WorkoutTimer: call `setTimer(-1)` before any `setState()` to prevent race conditions between timer init and tick effects.
- `milestoneProgress.ts`-style helpers read `milestone.progress` (`MilestoneProgress` in `challenge.ts`) — not a separate `tracking` schema.
