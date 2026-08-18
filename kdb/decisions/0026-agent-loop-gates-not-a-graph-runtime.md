# 0026 — Agent loop: gates in docs, not a graph runtime

- **Status:** Accepted · 2026-08-18 · Tech Lead
- **Area:** core
- **Context:** Our delegation loop had no checkable transitions — brief a subagent, hope, re-derive what happened. The proposed fix was to rebuild it in LangGraph (`StateGraph`, `Send()`, `interrupt()`, a Postgres checkpointer) so the loop became a real state machine with real checkpoints.
- **Decision:** Write the gates into the docs instead — a typed phase table in `kdb/doc-style.md`, and a freshness gate, a fixed report shape, a retry cap of 2, and five countable review checks in `.github/agents/tech-lead.md`.
- **Why:** Our nodes are Claude Code sessions inside a harness we do not control, so a graph runtime would be a second agent runtime bolted onto a repo whose backend is Vercel serverless and JSON in git. The plan doc plus the issue thread already is our checkpoint, and it survives a cold boot better than in-process state does.
- **Rejected:** LangGraph → a second runtime we do not control the nodes of, for a checkpoint we already have in git · Leaving the loop implicit → "delegate and hope" is what produced re-derived reports and unbounded retries in the first place.

<!-- Recorded because docs/plans/ is delete-on-ship. Without this ADR the reasoning
     leaves with docs/plans/ops-agent-setup.md and the next agent re-litigates it. -->
