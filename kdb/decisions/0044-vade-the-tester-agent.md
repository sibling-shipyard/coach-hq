# 0044 — A dedicated agent owns testing infrastructure and process

- **Status:** Accepted · 2026-09-14 · Tech Lead
- **Area:** cross-cutting
- **Context:** Testing is ad hoc today — whoever makes a change decides what to test and runs it themselves. Three tools cover coach-chat (`docs/eng-docs/coach-chat-testing.md`), plus an unowned fourth pattern: direct live verification against a real athlete repo. Dated result logs pile up unreadable, and no paid check skips a case that already passed against unchanged code.
- **Decision:** A new agent, vade-the-tester, owns testing infrastructure and process — running every test kind, authoring new coverage when a change needs it, deciding what needs re-running, and writing one readable report per day. Tech Lead hands off "verify this" the same way it hands off Sentry triage to Cyclops.
- **Why:** Testing has grown into its own domain — four kinds, a paid-call budget, a coverage question — that competes for context with whoever is also shipping the feature. Cyclops proved a triage-only agent scope works (ADR 0034); testing needs the same split.
- **Rejected:** Leave testing with whoever ships the change → no one owns re-run discipline or the report format, so both keep decaying. Fold it into Bob the Builder's scope → Bob already owns the backend the tests exercise; testing needs to stay a separate lens on that code, not the same one.
- **Enforces:** No agent both ships a coach-chat change and decides, unsupervised, that its own tests passed. vade-the-tester runs and reports; Tech Lead reviews the evidence.
- **How to apply:** `.github/agents/vade-the-tester.md` is the scope of record. The plan that designed this (`docs/plans/vade-the-tester.md`) is deleted per the plan-delete-on-last-PR rule now that its finishing PR (#1053) has landed — see this file's own git history for the original design.
