# 0046 — Close agent-scope gaps, correct Tech Lead's own delegation

- **Status:** Accepted · 2026-09-15 · Tech Lead
- **Area:** cross-cutting
- **Context:** A scope audit (vade-the-tester's role doc was one day old, agent count now
  seven) found real gaps. `.github/workflows/`, `kdb/scripts/`, `platform/scripts/`,
  `platform/agent-kit/`, `engine/lib/`, `engine/scripts/`, and `shared/` had no declared
  owner, defaulting to the CODEOWNERS `*` fallback. A commit and issue-label audit also
  found Tech Lead hand-fixing multi-file changes inside Bob's own directories
  (`engine/`, `ui/api/`) instead of delegating.
- **Decision:** `platform/` in full, `.github/workflows/`, `kdb/scripts/`, and
  `shared/golden-dataset/` + `shared/workout-library/` become explicit Tech Lead scope.
  `engine/lib/` and `engine/scripts/` join Bob the Builder's scope, same shape as
  `engine/core/`. `shared/warm-instrument/` (design tokens) joins UI Expert's scope — it
  already feeds `ui/client/` directly and was touched by open issues #943/#957. No new
  agent is added; vade-the-tester (added 2026-09-14) stays as designed.
- **Why:** Every gap area was tooling or pipeline work adjacent to an existing agent's
  domain, not a new one. The issue-label data showed the opposite of an understaffing
  problem — `bob-the-builder` sat at 2 open issues against 40 `area:core`. An eighth
  agent would add a boundary to maintain without fixing the real cause: Tech Lead
  absorbing work that was already Bob's.
- **Rejected:** Add a dedicated infra/platform agent for the gap areas → recreates the
  exact `engine/core/` vs `engine/lib/` style boundary confusion vade-the-tester's own
  docs already had to spell out once. Leave gaps on the CODEOWNERS default → review item 2
  ("diff is a subset of declared files") can't check an undeclared area.
- **Enforces:** No repo area defaults to the CODEOWNERS `*` fallback without a named owner
  in `AGENTS.md` § The Team and the owning role doc's Scope section.
- **How to apply:** A PR touching any of the newly-declared areas cites this ADR if the
  Tech Lead role-doc `## Learnings` entry on `area:core` delegation (added the same day)
  needs updating for a repeated pattern.
