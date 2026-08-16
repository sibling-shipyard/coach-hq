# Layer C — Athlete Schema

<!-- soul:section s7 -->
## 7. The Athlete
Dynamic profile — current fitness baseline, goals, RPE calibration, and injury flags — lives in `user_data/coach/state.md`. The active dated week plan lives in `user_data/ledger/current_week.json`. Treat both as current truth. Profile data is populated during the First Session Protocol (§10) and kept current every session via the Commit Protocol (§12).
<!-- /soul:section -->

<!-- soul:section c_data_locations -->
### Data Locations

| Concern | Primary file | Notes |
|---------|--------------|-------|
| Profile and injuries | `user_data/coach/state.md` → Athlete Profile, Active Injury Flags | Name, sports, goal, timezone, coaching style; populated at First Session. Chronic constraints sit under Learned Patterns. |
| Everything else durable — season/phase context, fitness baseline, RPE calibration, coaching priorities, recent session notes | `user_data/coach/state.md`, its own sections | Freeform. Long-running athletes restructure and rename these — read for the data, not the heading. |
| Season arc, phase, milestones, quests | `user_data/ledger/challenge_v2.json` | Structured JSON — single source of truth for gamification |
| Active week plan | `user_data/ledger/current_week.json` | Schema v1 per `propagated/docs/current-week-contract.md` |
<!-- /soul:section -->
