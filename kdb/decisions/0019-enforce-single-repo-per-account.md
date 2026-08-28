# 0019 — Enforce one repo per GitHub account: block and instruct, no picker

- **Status:** Accepted · 2026-08-03 · Tech Lead
- **Area:** cross-cutting (web auth, iOS auth)
- **Context:** GitHub's install flow cannot restrict an account to exactly one repo — the picker
  only offers "all repos" or a multi-select. So an account can end up with two or more owned,
  marker-matched repos. The two platforms then disagreed. Web showed a repo picker and let the
  athlete choose, which quietly allowed a multi-repo state nothing downstream supports. iOS never
  read the case at all, and dropped those accounts into the same "needs setup" branch as a brand
  new one, with nothing on screen to explain it.
- **Decision:** When two or more owned, marker-matched repos resolve, neither platform lets the
  athlete proceed. Both show a blocking message telling them to remove the extra grants in
  GitHub's own installation settings and retry. `list-my-repos` returns 409 with
  `{ error: "multiple_repos_granted" }` instead of candidates. There is no picker.
- **Why:** GitHub cannot enforce one repo per account, so the app has to. The picker did not solve
  the ambiguity, it deferred it — one athlete picked, and every downstream consumer still assumed
  a state the account did not have.
- **Rejected:** Keep the picker and teach iOS to pick too → lets athletes into a state the rest of
  the system does not support, and every consumer downstream then needs multi-repo handling.
- **Enforces:** Refuse an unsupported state where you detect it. Never offer a choice that
  resolves into something the rest of the system cannot handle.
- **How to apply:** Any resolution finding 2+ owned, marker-matched repos returns
  `reason: "multiple_repos_granted"` and refuses — never a pick. See `resolveOwnedRepos()` in
  `ui/api/auth/_lib/repo-resolution.ts` (shared by the cookie and bearer-token paths),
  `listMyReposImpl` in `ui/api/auth/[...action].ts`, the `MESSAGES` map in
  `ui/client/src/pages/AuthError.tsx`, and `ios/CoachHQ/CoachHQ/Services/GitHubAuthManager.swift`.
