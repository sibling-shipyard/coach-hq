# 0013 — Canonical match history: iOS parses once, consumers read JSON

- **Status:** Accepted · 2026-07-31 · Tech Lead
- **Area:** cross-cutting
- **Context:** Badminton match data is written twice (formatted text in activity description + structured JSON in `training/ebadders_history.json`) and re-parsed from text by three consumers (Swift, Python, TypeScript). The Python fallback reads a different file than iOS writes to. Adding features (singles, categories) means changing three parsers.
- **Decision:** iOS `DescriptionParser.swift` is the single parser. It writes structured JSON to `user_data/activities/match_history.json`. All consumers (`analytics.py`, `matchParser.ts`) read that file directly — no text re-parsing. `parse_match_description.py` is deleted. `training/ebadders_history.json` and `platform/plugins/badminton/data/badminton_match_data.json` are retired after one-time migration.
- **Why:** One parser means one place to add features (singles, categories). Eliminates three-way drift, removes dead code, and fixes the path mismatch where analytics never read what iOS wrote.
- **Rejected:** Keep all three parsers + add `format`/`category` to each → triple maintenance cost, guaranteed drift · Move parsing to a server endpoint → adds infra for something the device already does
