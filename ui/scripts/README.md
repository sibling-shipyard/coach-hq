# ui/scripts/ — build and CI tooling

Everything here runs at build time, in CI, or by hand for ops/dev - never against a live model
and never against a real athlete repo. That's what separates it from `ui/eval/` (coach-chat eval
and manual live-LLM testing, owned by vade-the-tester per ADR 0044) - see
[`ui/eval/README.md`](../eval/README.md) for why that material lives apart from this folder.

Extensions follow `kdb/decisions/0051-script-file-extension-convention.md`: `.mjs` when a script
runs at build time and imports no typed code, `.ts`/`.mts` when it imports typed code or benefits
from type-checking.

## Layout

| Folder    | What's in it                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build/`  | The data/soul build pipeline (`build-data.mjs`, `build-soul.mjs`, `generate-wi-tokens.mjs`, `generate-widget-snapshots.ts`) and the esbuild bundlers that shim cross-band `engine/` imports into `ui/api/*` serverless functions (`bundle-compile-workout-api.mjs`, `bundle-current-week-api.mjs`, `bundle-current-week-rollover-api.mjs`, `bundle-text-caps-api.mjs`, `bundle-widget-snapshots-api.mjs`). Wired into `predev`/`prebuild` in `ui/package.json`. |
| `checks/` | Standalone verification scripts, each runnable on its own: `check-coverage-reconciliation.ts` (test-results coverage-index drift), `check-span-health.mjs` (Sentry span-absence alert, scheduled by `.github/workflows/span-health.yml`), `validate-current-week.mts` (schema/invariant check for `current_week.json`).                                                                                                                                         |
| `dev/`    | `local-api-server.mjs` - the local stand-in for `vercel dev` used when testing real GitHub login/Coach Chat locally (`npm run dev:api`).                                                                                                                                                                                                                                                                                                                        |
| `lib/`    | Shared helpers plus their `.test.ts` siblings, some owned by vade-the-tester per ADR 0044 (`llmPricing.ts`, and `run-tests-logged.ts` at the top level of this folder depends on `testLog.ts` here) - check current ownership before editing.                                                                                                                                                                                                                   |
