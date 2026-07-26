# Layer C — Athlete Schema

<!-- soul:section c_schema -->
### Athlete Schema (MVP)

Layer C is the extensibility seam: new sports, conditions, and future tracking signals land as **data**, not engine edits. Layer B reads these fields generically.

```yaml
# soul/C_athlete.md — MVP declarative schema

sports:
  - id: string              # e.g. "badminton", "calisthenics", "conditioning"
    role: string            # optional — e.g. "primary", "strength", "commute"
    schedule: []            # optional — day/venue/intensity entries; shape TBD per sport pack
    notes: string           # optional — freeform; sport-pack prose stays out of B

injury_flags:
  - region: string          # e.g. "left_hamstring", "shoulder", "right_glute"
    status: string          # e.g. "active", "monitor", "cleared", "recovering"
    contraindicated_patterns: []   # optional — movement patterns to avoid/modify
    notes: string           # optional — test results, clearance dates, substitute movements
    cleared_date: string    # optional — ISO date when flag closed

conditions:
  - id: string              # optional — stable key for chronic entries
    region: string          # e.g. "lumbar", "right_hip_glute"
    chronic: true           # implied for this array
    contraindicated_patterns: []   # optional
    load_ceiling: string    # optional — e.g. "stop_and_release_not_push_through"
    notes: string           # optional — all fields optional per condition

tracking_modules: {}        # RESERVED — empty in MVP. Future signals (cycle, readiness,
                            # illness, HRV-deload) drop here without B changes.
```

**Schema design rules:**
1. **`sports[]` is a list** — never a single hardcoded sport in B. B consults the list for weekly spine, template selection, and schedule-aware planning.
2. **`injury_flags[]` = acute/transient** — active/modified/cleared flags the Pre-Workout Check reads.
3. **`conditions[]` = chronic** — long-running constraints; all subfields optional per entry.
4. **`tracking_modules{}` = empty in MVP** — slot only. Do not populate with sleep/PRE/RPE in S2; those remain in `state.md` sections until a follow-up P2 lands them as modules.
5. **B never hardcodes** sport names, injury regions, or signal types — it reads these arrays/sections generically.

**Template vs runtime:** HQ ships a v2 template `state.md` with Athlete Profile headings populated at First Session. Long-running athletes may evolve `state.md` beyond the template (structured sections without Athlete Profile headings). This schema tolerates both shapes — B reads the generic contract regardless of section layout.
<!-- /soul:section -->

<!-- soul:section s7 -->
## 7. The Athlete
Dynamic profile — current fitness baseline, goals, RPE calibration, sleep log, and injury flags — lives in `training/coach/state.md`. The active dated week plan lives in `training/ledger/current_week.json`. Treat both as current truth. Profile data is populated during the First Session Protocol (§10) and kept current every session via the Commit Protocol (§12).
<!-- /soul:section -->

<!-- soul:section c_data_locations -->
### Data Locations

| Concern | Primary file | Notes |
|---------|--------------|-------|
| Profile (name, sports, goal, timezone, coaching style) | `training/coach/state.md` → Athlete Profile | HQ template has headings; populated at First Session |
| Active injuries (acute/transient) | `state.md` → Active Injury Flags | Freeform bullets today; maps to `injury_flags[]` |
| Chronic constraints | `state.md` → Learned Patterns + flag notes | Maps to `conditions[]` |
| Phase / block context | `state.md` → Current Season / Phase sections | Evolved athletes may use `Current Phase / Block Context` |
| Fitness baseline, RPE calibration | `state.md` dedicated sections | Athlete-specific snapshots |
| Sleep log (rolling table) | `state.md` → Sleep Log | Dual-written with `sleep_log.json` at commit |
| Pre-session mental state | `state.md` → Pre-Session Mental State | Strava `PRE:` field |
| Coaching priorities, learned patterns | `state.md` | Coach-derived institutional memory |
| Recent session notes | `state.md` | Rolling last 3 — boot continuity |
| Season arc, phase, milestones, quests | `training/ledger/challenge_v2.json` | Structured JSON — single source of truth for gamification |
| Active week plan | `training/ledger/current_week.json` | Schema v1 per `docs/current-week-contract.md` |

---
<!-- /soul:section -->
