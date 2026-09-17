# 0051 — Script file-extension convention: .mjs for build-time, .ts/.mts for typed

- **Status:** Accepted · 2026-09-17 · Tech Lead
- **Area:** cross-cutting
- **Context:** `ui/scripts/` and the new `ui/eval/` mix `.ts`, `.mjs`, and `.mts` with no
  documented rule. A structure audit found no obvious reasoning behind which script got which
  extension, just organic drift.
- **Decision:** A script gets `.mjs` when it runs at build time and imports no typed code — no
  type-checking needed. It gets `.ts` or `.mts` when it imports typed code from `ui/api/` or
  `ui/scripts/lib/`, or otherwise benefits from type-checking.
- **Why:** The distinction that already exists in practice is "does this need the type checker,"
  not file location or how it's invoked. Naming the real distinction stops the drift instead of
  arguing over it file by file.
- **Rejected:** One extension for everything → hides which scripts get type-checked and which
  don't. `.js` for build tooling → the repo already standardized on ESM (`.mjs`), so bare `.js`
  would just add a fourth option.
- **Enforces:** No new script in `ui/scripts/` or `ui/eval/` picks an extension by habit — it
  follows this rule.
- **How to apply:** Applied to existing scripts during the `docs/plans/ui-api-scripts-structure-audit.md`
  execution stack (issue #1190).
