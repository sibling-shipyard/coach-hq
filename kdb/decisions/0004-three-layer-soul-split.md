# 0004 — Split SOUL.md into three runtime-agnostic layers

- **Status:** Accepted · 2026-07-24 · Tech Lead
- **Area:** core
- **Context:** One ~385-line `SOUL.md` per repo entangled identity, engine, and athlete data; the engine assumed shell/git/python and `coach-chat.ts` re-encoded the rules — two engines drifting, guarded only by a JSON-parse check (scaling-plan §2.2, §8).
- **Decision:** Three source files under `soul/` — A (identity/voice), B (engine as capability contracts), C (athlete schema + generic intake). `SOUL.md` becomes a generated composition of them (read path unchanged). B is a generic interpreter over Layer C data (sports/conditions/signals), never branched per athlete. `scripts/validate-repo.py` enforces the file contracts as the shared safety net; `data/aggregate.json` `schema_version` frozen at v1. Detail: `docs/soul-split-m0.md`.
- **Why:** One source of truth per concern, executable identically on both runtimes, with a real regression net — and 10→1000 futures (cycle tracking, new sports, chronic conditions) land as additive Layer C data, not an engine rewrite.
- **Rejected:** Update every reader to read A/B/C separately → touches `coach-chat.ts`, which is M2, and risks breaking live sessions mid-rollout. · Leave B as scripts → not runtime-agnostic; the server agent can't execute it. · Keep athlete specifics in A/B → forks the shared engine per user.
