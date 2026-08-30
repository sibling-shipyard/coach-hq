# 0034 — Agent-layer restructure: Bob the Builder split and Cyclops triage

- **Status:** Accepted · 2026-08-30 · Tech Lead
- **Area:** cross-cutting
- **Context:** Bob's scope (`engine/core/`, `scripts/`, `user_data/`) covers a fraction of the backend. UI Expert owns the React dashboard (`ui/client/`) and the entire serverless backend (`ui/api/` — Gemini orchestration, coach-chat, auth, observability, eval). Those are different domains sharing one agent's context window. Sentry is now live across all surfaces (ADR 0032), and the test structure has grown layered subdirectories. The agent layer has not kept up.
- **Decision:** Split into six agents. Bob the Builder gains `ui/api/`, `ui/observability/`, `ui/scripts/`, and all `ui/api/` tests. UI Expert narrows to `ui/client/` only. A new Cyclops agent reads Sentry events and produces routed incident briefs. Tech Lead, iOS Builder, and Coach Phelps keep their current scope.
- **Why:** The split aligns ownership with concern boundaries. `ui/api/` is backend code inside a frontend directory; giving it to the agent who writes widget CSS means every Gemini retry bug competes with dashboard UX for context. Cyclops turns Sentry from a passive log into an active triage loop.
- **Rejected:** Keep UI Expert's scope and give Bob only Sentry/eval → leaves the core mismatch (LLM backend + React frontend in one agent). Move `ui/api/` out of `ui/` physically → Vercel requires `api/` inside the project root.
- **Enforces:** No agent owns both `ui/client/` and `ui/api/`. Bob the Builder is the sole owner of serverless handlers, Gemini integration, auth, and backend observability.
