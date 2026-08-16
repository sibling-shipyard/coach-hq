# Layer C — Athlete Schema

<!-- soul:section s7 -->
## 7. The Athlete
Dynamic profile — current fitness baseline, goals, RPE calibration, and injury flags — lives in `user_data/coach/state.md`. The active dated week plan lives in `user_data/ledger/current_week.json`. Treat both as current truth. Profile data is populated during the First Session Protocol (§10) and kept current every session via the Commit Protocol (§12).
<!-- /soul:section -->

<!-- soul:section c_data_locations -->
### Data Locations

| Concern | Primary file | Notes |
|---------|--------------|-------|
| Profile (name, sports, goal, timezone, coaching style) | `user_data/coach/state.md` → Athlete Profile | HQ template has headings; populated at First Session |
| Active injuries (acute/transient) | `state.md` → Active Injury Flags | Freeform bullets today; maps to `injury_flags[]` |
| Chronic constraints | `state.md` → Learned Patterns + flag notes | Maps to `conditions[]` |
| Phase / block context | `state.md` → Current Season / Phase sections | Evolved athletes may use `Current Phase / Block Context` |
| Fitness baseline, RPE calibration | `state.md` dedicated sections | Athlete-specific snapshots |
| Coaching priorities, learned patterns | `state.md` | Coach-derived institutional memory |
| Recent session notes | `state.md` | Rolling last 3 — boot continuity |
| Season arc, phase, milestones, quests | `user_data/ledger/challenge_v2.json` | Structured JSON — single source of truth for gamification |
| Active week plan | `user_data/ledger/current_week.json` | Schema v1 per `propagated/docs/current-week-contract.md` |
<!-- /soul:section -->
