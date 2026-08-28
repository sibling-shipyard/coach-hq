# 0017 — Group related API endpoints behind Vercel catch-all routes, not query-param folding

- **Status:** Accepted · 2026-08-02 · Tech Lead
- **Area:** cross-cutting
- **Context:** Vercel's Hobby plan caps a deployment at 12 serverless functions, one per
  top-level `ui/api/*.ts`. `main` sat at exactly 12 after the coach-chat redesign landed, and a
  new profile-status endpoint pushed it to 13 and broke the build. The first fix folded that
  endpoint into `coach-chat.ts` behind a `?profileStatus=1` query param. It worked, but it buys
  one slot per endpoint, and it put onboarding logic inside a chat route.
- **Decision:** Where a directory holds several thin, related routes, consolidate them behind one
  catch-all — `ui/api/auth/[...action].ts`. Vercel counts a catch-all as a single function however
  many sub-paths it dispatches, and maps `/api/auth/*` onto it with no `vercel.json` rewrites.
  Every existing URL still resolves, including `/api/auth/callback`, which is registered as the
  GitHub OAuth callback and cannot change. Each original file's body becomes a named export, and
  a default `fetch` parses the segment and dispatches.
- **Why:** Consolidating `auth/`'s seven files into one took the deployment from 12 functions to
  6. That is real headroom, not a slot bought per endpoint. It also keeps unrelated routes free of
  query params that exist for Vercel's accounting rather than the route's own job.
- **Rejected:** Query-param dispatch on an unrelated route → buys exactly one slot and mixes
  concerns; reverted once the catch-all pattern landed · `vercel.json` rewrites → unnecessary, the
  file-based convention already does this with no config.
- **Enforces:** A route's shape follows its own concern, never the deployment's function budget.
  When the count binds, consolidate related routes — never fold an endpoint into an unrelated one.
- **How to apply:** Count with
  `find ui/api -name "*.ts" | grep -v '/_lib/\|/_tests/' | wc -l`. If a new endpoint would cross
  12, look for a directory of related thin routes to consolidate first, following
  `ui/api/auth/[...action].ts` as the template.
