# ui/api/ — Vercel serverless functions

Every non-`_`-prefixed `.ts` file under here becomes a routed function, mapped by its literal file
path (confirmed in `ui/scripts/local-api-server.mjs`'s dev-server route table, which mirrors real
Vercel behavior). That's why some routes are flat files and others are folders: a file can only
move into a folder if its URL is allowed to change too. The Hobby plan caps a deployment at 12
functions — see [`kdb/decisions/0017-vercel-function-count-catch-all-routes.md`](../../kdb/decisions/0017-vercel-function-count-catch-all-routes.md)
for the catch-all pattern (`auth/[...action].ts`) used to stay under that cap. Currently 7 routed
files total, well under the cap.

## Routed files

| Path | Role |
|---|---|
| `coach-chat.ts` | Real Coach Phelps sessions (GET history, POST greet/message) |
| `coach-chat-context.ts` | Warms the SOUL/state/quest_log cache ahead of the athlete opening chat (A3) |
| `coach-chat-profile-status.ts` | Has this athlete finished the First Session Protocol? (B2) |
| `repo-file.ts` | Fetches the signed-in user's `gen/dashboard_snapshot.json` (Repo-as-CDN model) |
| `waitlist.ts` | Marketing waitlist email capture |
| `widget-snapshots.ts` | Server-side Warm Instrument Home snapshots (ADR 0005) |
| `auth/[...action].ts` | Every OAuth/session endpoint, catch-all — see [`auth/README.md`](auth/README.md) |
| `coach-chat/*.ts` (3 files above) | Routes only — internals live in `coach-chat/_lib/`, see [`coach-chat/README.md`](coach-chat/README.md) |

## Non-routed (`_`-prefixed, excluded from routing at any depth)

| Path | Role |
|---|---|
| `_lib/` | Generic cross-cutting infra only — `fileEdits.ts` (JSON merge-patch), `githubGitData.ts` (atomic multi-file commits, ADR 0012), `httpTimeout.ts` (fetch-with-timeout). **Not** a place for feature-specific internals — `auth/` and `coach-chat/` each own their own `_lib/` for that. |
| `_generated/` | Build output (`soul.ts`, written by `ui/scripts/build-soul.mjs`) — never hand-edit |
| `auth/_lib/`, `auth/_tests/` | See [`auth/README.md`](auth/README.md) |
| `coach-chat/_lib/`, `coach-chat/_tests/` | See [`coach-chat/README.md`](coach-chat/README.md) |
