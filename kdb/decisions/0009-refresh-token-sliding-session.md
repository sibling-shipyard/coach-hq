# 0009 — Refresh-token rotation for "stay logged in until logout"

- **Status:** Accepted · 2026-07-29 · Tech Lead
- **Area:** cross-cutting
- **Context:** The session cookie expired after a fixed 8 hours, so athletes were re-logging in
  mid-day. That 8 hours was not arbitrary. This repo opts in to GitHub's "expire user
  authorization tokens", so the access token embedded in every session already dies at 8 hours no
  matter how long the cookie lives. Raising the cookie alone would change nothing.
- **Decision:** Keep the `refresh_token` GitHub already returns and previously threw away, and
  exchange it for a new access token when the old one nears expiry. One shared
  `ensureFreshSession()` in `ui/api/auth/_lib/session.ts` does this, and every session-reading
  handler goes through it. The cookie becomes sliding, renewed to a 180-day cap on each
  successful refresh. iOS gets the same rotation through `/api/auth/refresh`, because the
  confidential half of the exchange needs `client_secret` on the server rather than in the app.
- **Why:** This is what GitHub's own token-expiration setting and current session guidance both
  recommend — a short-lived access token with a silent background refresh. Anyone active within
  any six-month window never sees a login screen again. An abandoned session still expires, so a
  leaked token has a bounded worst case instead of none.
- **Rejected:** Opt out of GitHub's token expiration → simpler, but it means a never-expiring raw
  token with no safety net if it leaks, and GitHub advises against it · Raise `SESSION_MAX_AGE_SEC`
  with no refresh logic → does not work at all; the GitHub token still dies at 8 hours and every
  request after that returns 401.
- **Enforces:** A session lives no longer than the credential inside it. Extending a cookie
  without refreshing the token it carries buys nothing.
