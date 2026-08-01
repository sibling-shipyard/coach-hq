# 0016 — Names display only, category is machine field

- **Status:** Accepted · 2026-08-01 · Coach
- **Area:** cross-cutting
- **Context:** Activity names (e.g. 'Hit & Run #68: Ranked') serve double duty as display labels and machine identifiers. Quests regex-match on names (`count_pattern`), taxonomy.py parses names for sub-categories, UI runs 12 regex checks. This coupling means naming rules must be consistent across iOS, Python, and TypeScript — and baked into every athlete's binary. Doesn't scale.
- **Decision:** Add a `category` field to activity JSON. Names become display-only (`{Sport} #{N}`). All downstream consumers (quests, taxonomy, streaks, analytics) read `category` instead of regex-parsing names. Category values are 3-letter uppercase codes (e.g., "FDN", "RNK", "CAL"). These are user-defined via a `categories.json` config file in the athlete repo, with a maximum of 3 categories per sport type. Category assignment is config-driven with ordered first-match rules based on `sport_type` and workout metadata (duration, weekday).
- **Why:** Decouples display from machine identity. Names can be anything without breaking quests or analytics. Category derivation is deterministic from sport_type + workout metadata without hardcoded naming rules. Scales to any number of athletes.
- **Rejected:** (1) `naming_config.json` per athlete (issue #143 original proposal) — unnecessary complexity once names aren't machine identifiers. (2) Keeping name-as-identifier with shared regex patterns — fragile, doesn't scale.
