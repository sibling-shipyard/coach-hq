# `api/_lib/` — shared infra

Generic helpers used across more than one route, one level deep. Nothing feature-specific lives
here — `auth/` and `coach-chat/` each keep their own `_lib/` for that (see
[`../README.md`](../README.md)).

| File                | Role                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| `activityLookup.ts` | Find a hist file by activity id, shared by coach-chat and coach-message                                   |
| `fileEdits.ts`      | Apply an LLM's proposed edits to a file without asking it to reproduce the whole thing                    |
| `geminiModel.ts`    | Shared Gemini model id for every server-side `generateContent` call                                       |
| `githubGitData.ts`  | Atomic multi-file commit via GitHub's Git Data API (ADR 0012)                                             |
| `httpTimeout.ts`    | Generic fetch-with-timeout wrapper for any upstream HTTP call                                             |
| `llmClient.ts`      | The provider-neutral contract every LLM caller speaks, plus the adapter selector                          |
| `log.ts`            | Structured logger writing to both Vercel logs and Sentry breadcrumbs                                      |
| `sentry.ts`         | Sentry init and span/exception helpers for the Vercel Node functions                                      |
| `slugify.ts`        | The one slug function every id/filename mint in this codebase shares                                      |
| `llmAdapters/`      | The provider seam — one adapter file per LLM backend, reached through `llmClient.ts`'s `selectLlmAdapter` |

`_tests/` covers this folder's own modules, one file per module or a shared concern
(`githubGitData.test.ts` also covers Layer 3 of coach-chat's test taxonomy — see
[`docs/eng-docs/coach-chat-testing.md`](../../../docs/eng-docs/coach-chat-testing.md)).
