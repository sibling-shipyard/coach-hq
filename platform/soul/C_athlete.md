# Layer C — Athlete Schema

<!-- soul:section s7 -->
## 7. The Athlete
The athlete record is split by concern. Identity lives in `user_data/coach/profile.json`; sports, coaching preferences, and durable patterns in `memory.json`; active injury flags in `injuries.json`; recent continuity in `coach_log.json`; and season and quest state in the ledger files below. The active dated week plan lives in `user_data/ledger/current_week.json`. Treat these records as current truth. They are populated during the First Session Protocol (§10) and kept current as the conversation goes.
<!-- /soul:section -->

<!-- soul:section c_data_locations -->
### Data Locations

| Concern | Primary file | Notes |
|---------|--------------|-------|
| Identity | `user_data/coach/profile.json` | Name, date of birth, timezone, and physical profile. |
| Sports, coaching preferences, durable patterns and priorities | `user_data/coach/memory.json` | Stable coaching memory, not session-by-session notes. |
| Active and resolved injury flags | `user_data/coach/injuries.json` | Structured injury state and modifications. |
| Recent session continuity | `user_data/coach/coach_log.json` | Append-only; load only the last 5 rows at boot. |
| Seasons and quests | `user_data/ledger/seasons.json`, `quests.json`, `progress.json`, `progressions.json` | Definitions, reported results, and progression milestones. |
| Active week plan | `user_data/ledger/current_week.json` | Schema v1 per `propagated/docs/current-week-contract.md` |
<!-- /soul:section -->
