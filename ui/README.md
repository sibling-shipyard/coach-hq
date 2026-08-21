# ui/ — hosted dashboard + Coach Phelps backend

Single Vercel deployment: a Vite/React dashboard (`client/`) served alongside serverless
functions (`api/`) that also power the iOS app. HQ-only — athlete repos don't carry this folder.

| Path | Role |
|---|---|
| `client/` | The dashboard React app — pages, components, hooks. `client/src/data/` is generated, not hand-edited (see below). |
| `api/` | Serverless functions — routing, Coach Phelps backend, auth. See [`api/README.md`](api/README.md), and [`api/coach-chat/README.md`](api/coach-chat/README.md) for the coach-chat internals specifically. |
| `scripts/` | Build-time and operator scripts — `build-data.mjs` (pre-build data generation), `build-soul.mjs` (bundles `platform/SOUL.chat.md`), `eval-coach-chat.ts` (paid/live Gemini eval gate), migration scripts. |
| `docs/` | UI-specific working docs (product-page TODOs, reference-interaction acceptance criteria) — not `docs/eng-docs/`, which is repo-wide. |

## Data flow into `client/src/data/`

`npm run dev`/`npm run build` both run `scripts/build-data.mjs` first (`predev`/`prebuild` in
`package.json`), which populates `client/src/data/` — including `dashboard_snapshot.json`, which
`useRepoData.ts` statically imports and Vite bundles at build time. **Never hand-edit anything in
`client/src/data/`** — on HQ it's copied from `shared/golden-dataset/`; in an athlete repo it's
built from that repo's own `user_data/`/`gen/` via `engine/scripts/build-dashboard-snapshot.mjs`.

## Commands

```bash
cd ui
npm run dev      # local dev server, runs build-data.mjs first
npm run build    # production build
npx tsc --noEmit
npm test -- --run
npm run eval:coach-chat   # paid/live Gemini gate — only when explicitly requested
```

## Related

- [`docs/eng-docs/coach-chat-daily.md`](../docs/eng-docs/coach-chat-daily.md) — ordinary-turn flow
- [`docs/eng-docs/coach-chat-fsp.md`](../docs/eng-docs/coach-chat-fsp.md) — First Session Protocol
- [`docs/eng-docs/coach-data-schema.md`](../docs/eng-docs/coach-data-schema.md) — every file/enum Coach reads or writes
- [`docs/eng-docs/gemini-flow.md`](../docs/eng-docs/gemini-flow.md) — Gemini request/schema/caching details
