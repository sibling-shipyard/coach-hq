# 0006 — One canonical challenge_v2 schema (version 4)

- **Status:** Accepted · 2026-07-26 · Tech Lead
- **Area:** cross-cutting
- **Context:** `user_data/ledger/challenge_v2.json` diverged into v2 (`challenge` + `count_target`) and v3 (`season` + `weekly_sessions`). Skeleton seeds v2; Akash runs v3; engine/UI had dual read paths. That does not scale — every new user and consumer would carry compatibility forever.
- **Decision:** **One canonical schema — version 4.** All user repos converge on it. Spec: [`docs/eng-docs/challenge-v2-schema.md`](../docs/eng-docs/challenge-v2-schema.md). Required: `season`, `main_quest`, `quests`. Optional: `phase`, `milestones`, `weekly_targets`, `graduated`. **No top-level `challenge` block** — the old 60-day kickstart is a `season` (short or nested under a longer arc via `phase`).
- **Why:** Single validator, single skeleton seed, single UI/engine contract. Sport mix and main-quest *style* vary per athlete in **data**, not in file shape. Akash's model (season/phase/milestones) becomes the structural baseline; Skanda's count-target + weekly sport quotas fit the same envelope.
- **Rejected:** Dual schemas + adapters forever (current state — tech debt). Force everyone back to v2 only (throws away live v3 coaching model). Per-user schema versions with no migration path (same problem, worse).

**Migration:** v2/v3 → v4 at provision, carve, and a one-shot script for live repos. `challenge_schema.py` reads legacy during transition; writes v4 only after cutover. `validate-data.yml` enforces v4.

**Supersedes:** informal "v2 template vs v3 live" split in `docs/eng-docs/soul-C-schema.md` § HQ template vs Sky live.

## Aggregate Data Schema & Projection

- **Aggregate Slimming:** The `gen/aggregate.json` file produced by `engine/scripts/build-aggregate.mjs` contains an `activities` array. 
- **Scalars vs. Time-Series Rule:** Activities injected into the aggregate payload are projected down to a strict allowlist of scalar fields (e.g., `id`, `name`, `distance`, `moving_time`, `average_heartrate`).
- **Why:** Time-series arrays (`best_efforts`, `average_cadence`, `average_speed`, `total_photo_count`, etc.) bloat the aggregate payload significantly. The UI loads the full aggregate on boot, so it must be slim. High-fidelity time-series data or heavy arrays remain in `hist/*.json` and should be fetched individually per activity when required (e.g., in a detail view).
