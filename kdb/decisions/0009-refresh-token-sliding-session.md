# 0009 — Refresh-token rotation for "stay logged in until logout"

- **Status:** Accepted · 2026-07-29 · Tech Lead
- **Area:** cross-cutting
- **Context:** The old session cookie expired after a fixed 8h, forcing a re-login mid-day.
  `coach-phelps` has GitHub's "expire user authorization tokens" opted in, so the real GitHub
  access token embedded in every session already dies at 8h regardless of the cookie's own
  lifetime — the 8h cookie wasn't arbitrary, it was matched to that.
- **Decision:** Capture the `refresh_token` GitHub already returns (previously discarded) and
  silently exchange it for a new access token when the old one is near expiry, in one shared
  `ensureFreshSession()` helper (`ui/api/auth/_lib/session.ts`) every session-reading handler
  goes through. The cookie itself becomes sliding, renewed to a 180-day cap on each successful
  refresh. iOS gets the same rotation via a new `/api/auth/refresh` endpoint, since the
  confidential half of the exchange needs `client_secret` server-side, not embedded in the app.
- **Why:** Matches GitHub's own recommended token-expiration setting and current
  session-management guidance (OWASP): short-lived access token + silent background refresh,
  not a long-lived raw token. Anyone active within any 6-month window (the refresh token's own
  GitHub-side validity) never sees a login screen again; an abandoned session still has a real,
  bounded worst case instead of a token valid forever if it ever leaks.
- **Rejected:** Opt out of GitHub's token expiration (never-expiring raw token) → simpler, but
  GitHub itself recommends against it for security, and a leaked never-expiring token has no
  natural safety net. Just raise `SESSION_MAX_AGE_SEC` without refresh logic → doesn't work at
  all, the underlying GitHub token would still die at 8h and every request past that would 401.
