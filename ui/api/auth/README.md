# api/auth/ — OAuth + session

Every auth endpoint lives behind one Vercel catch-all route, `[...action].ts`, which matches all
of `/api/auth/*` and dispatches internally — see [`kdb/decisions/0017-vercel-function-count-catch-all-routes.md`](../../../kdb/decisions/0017-vercel-function-count-catch-all-routes.md)
for why (this used to be 7 separate routed files, now 1 function). Each original endpoint is a
named exported handler inside `[...action].ts` (`handleCallback`, `handleMe`, etc.), all
delegating real logic to `_lib/` below.

## `_lib/`

| File                                                   | Role                                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `session.ts`                                           | Encrypted session cookie helpers, shared by every handler here                         |
| `resolve-auth.ts`                                      | Resolves GitHub credentials per-request — cookie (web) or Bearer token (iOS)           |
| `repo-resolution.ts`                                   | Installation/repo lookup shared across the OAuth callback and iOS flows                |
| `pkce.ts`                                              | PKCE + state helpers for the GitHub OAuth authorization-code flow (pure Web Crypto)    |
| `github-dashboard-snapshot.ts`                         | Fetches `gen/dashboard_snapshot.json` from an athlete repo via the GitHub Contents API |
| `generate-widget-snapshots-from-dashboard-snapshot.ts` | Runs Warm Instrument snapshot models against a fetched dashboard bundle (ADR 0005)     |

`_tests/` holds this folder's own test suite — one file per `_lib` module or endpoint being
covered, matching the naming there.
