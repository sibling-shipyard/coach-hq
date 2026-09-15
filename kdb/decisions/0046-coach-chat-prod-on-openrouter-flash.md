# 0046 — Coach chat production runs on OpenRouter, not direct Gemini

- **Status:** Accepted · 2026-09-15 · Tech Lead
- **Area:** cross-cutting (coach-chat backend, provider seam)
- **Context:** the athlete set `LLM_PROVIDER=openrouter` and `OPENROUTER_API_KEY` in Vercel's
  Production environment on 2026-09-05, and removed `GEMINI_API_KEY` from Vercel entirely. No ADR
  recorded this at the time - it existed only as an env var change.
- **Decision:** production coach-chat runs on OpenRouter, model `google/gemini-3.8-flash`, not
  direct Gemini `gemini-pro-latest`. This is the real production path going forward, not a dev
  testing workaround.
- **Why:** real production runtime data (`get_runtime_errors`/`get_runtime_logs`, 2026-09-15)
  shows this switch has not caused a failure spike - one isolated rate-limit cluster 2026-09-05
  through 2026-09-10, clean since, clean in the last 24h. A 2026-09-15 live coverage pass (#1067)
  exercised this exact model/provider against all 5 real athlete repos and closed the real bugs it
  found (#1070-#1072, #1075-#1076).
- **Rejected:** reverting to direct Gemini pro → `GEMINI_API_KEY` credit is depleted in this dev
  environment, so reverting production needs that restored first. #668's flash-capacity concern
  was about direct-Gemini Flash specifically. Flash-via-OpenRouter routes through a different path
  (Vertex, per `docs/eng-docs/chat-provider-bench.md`) with its own separate rate limit.
- **Enforces:** no agent may assume `gemini-pro-latest` direct is what a real athlete's coach-chat
  call actually hits - check `LLM_PROVIDER`'s real value in the environment being discussed, not
  the code's default.
- **How to apply:** `docs/eng-docs/llm-provider-current.md`'s Options table is priced against
  direct-Gemini Flash, not OpenRouter-routed Flash at real production volume - re-verify before
  using it to reason about cost. Revisit this ADR once `GEMINI_API_KEY` credit is restored and a
  real provider comparison (not projection) can be run again.
