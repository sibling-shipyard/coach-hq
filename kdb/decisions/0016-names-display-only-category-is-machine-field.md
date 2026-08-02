# 0016 — Names display only, category is machine field

- **Status:** Accepted · 2026-08-02 · Tech Lead
- **Area:** cross-cutting
- **Context:** Activity names (e.g. "Hit & Run #68: Ranked") serve double duty as display labels and machine identifiers. Quests regex-match on names, taxonomy parses names for sub-categories, and the UI runs a dozen name-regex checks. This coupling means naming rules must stay consistent across iOS, Python, and TypeScript — and baked into every athlete's binary. Doesn't scale.
- **Decision:** Add an optional `category` field to activity JSON. Names become display-only (`{Sport} #{N}`). Downstream consumers will read `category` instead of regex-parsing names. **Phase 1:** field is optional; iOS sync assigns generic names and leaves `category` nil; manual tagging only. Auto-assignment rules (`categories.json`, config-driven resolver) deferred to Phase 3.
- **Why:** Decouples display from machine identity. Names can be anything without breaking quests or analytics. Phased rollout keeps existing regex fallbacks working until category is populated.
- **Rejected:** (1) `naming_config.json` per athlete (issue #143 original proposal) — unnecessary once names aren't machine identifiers. (2) Big-bang auto-category in Phase 1 — too much surface area; manual field + generic naming ships first.
