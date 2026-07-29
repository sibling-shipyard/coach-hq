# Layer C Schema — Declarative Athlete Seam (MVP)

> **Status:** Design only — Tech Lead sign-off gate for S2  
> **Source:** [`engineering/soul-split-plan.md`](engineering/soul-split-plan.md) MVP shape + v5.7 runtime files  
> **Scope:** Schema definition only. `tracking_modules{}` is **reserved and empty** in MVP.

## Purpose

Layer C is the extensibility seam: new sports, conditions, and future tracking signals land as **data**, not engine edits. Layer B reads these fields generically.

```
soul/C_athlete.md     ← declarative schema (shared, composed into SOUL.md)
training/coach/state.md          ← durable athlete state (per-user data)
training/ledger/challenge_v2.json ← quests, season arc, milestones (per-user data)
training/ledger/current_week.json ← active week plan (per-user data, read by B)
```

## MVP schema shape

Minimal fields. Optional per entry where noted. No feature content ships in MVP beyond today's single athlete.

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

### Design rules

1. **`sports[]` is a list** — never a single hardcoded sport in B. B consults the list for weekly spine, template selection, and schedule-aware planning.
2. **`injury_flags[]` = acute/transient** — active/modified/cleared flags the Pre-Workout Check reads.
3. **`conditions[]` = chronic** — long-running constraints; all subfields optional per entry.
4. **`tracking_modules{}` = empty in MVP** — slot only. Do not populate with sleep/PRE/RPE in S2; those remain in `state.md` sections until a follow-up P2 lands them as modules.
5. **B never hardcodes** sport names, injury regions, or signal types — it reads these arrays/sections generically.

## What B reads from C (generic contract)

| Decision point | C source | B behavior |
|----------------|----------|------------|
| Boot: empty profile? | `state.md` Athlete Profile | Trigger First Session (§10) |
| Boot: timezone / week freshness | `state.md` Athlete Profile → `current_week.json` | Validate live week vs today |
| Pre-Workout Check | `injury_flags[]` / Active Injury Flags | Apply §9 fatigue auto-regulation patterns |
| Weekly Kick-off / plan generation | `sports[]`, `injury_flags[]`, `conditions[]`, phase context | Structure week; pre-apply modifications |
| Rules Engine week framework | `sports[]` | Adapt default day-type rules to athlete's mix |
| Quest tracking | `challenge_v2.json` | Update by type/polarity per §8 rules |
| PRE / mental state tone | `state.md` Pre-Session table *(until tracking_modules)* | Low/high PRE behavior |
| Season / phase awareness | `state.md` + `challenge_v2.json` season/phase blocks | Check dates, reference phase naturally |

B does **not** manually count quest streaks (reads `quest_log.md`), store day-by-day plans in `state.md`, or embed sport-specific scouting inline.

## Physical data locations (today)

| Concern | Primary file | Notes |
|---------|--------------|-------|
| Profile (name, sports, goal, timezone, coaching style) | `training/coach/state.md` → Athlete Profile | HQ template has headings; populated at First Session |
| Active injuries (acute/transient) | `state.md` → Active Injury Flags | Freeform bullets today; maps to `injury_flags[]` |
| Chronic constraints | `state.md` → Learned Patterns + flag notes | Maps to `conditions[]`; e.g. lower-back history, reactive glute pattern |
| Phase / block context | `state.md` → Current Season / Phase sections | Evolved athletes may use `Current Phase / Block Context` |
| Fitness baseline, RPE calibration | `state.md` dedicated sections | Athlete-specific snapshots |
| Sleep log (rolling table) | `state.md` → Sleep Log | Dual-written with `sleep_log.json` at commit |
| Pre-session mental state | `state.md` → Pre-Session Mental State | Strava `PRE:` field |
| Coaching priorities, learned patterns | `state.md` | Coach-derived institutional memory — stays in state.md (not MVP schema slots) |
| Recent session notes | `state.md` | Rolling last 3 — boot continuity |
| Season arc, phase, milestones, quests | `training/ledger/challenge_v2.json` | Structured JSON — single source of truth for gamification |
| Active week plan | `training/ledger/current_week.json` | Schema v1 per `docs/current-week-contract.md` |

### Schema version note

HQ ships a **v2 template** `challenge_v2.json` (60-day challenge + `count_target` main quest). Sky's live repo runs **v3** (season/phase + `weekly_sessions` main quest + milestones). S1 documents both; S2 must preserve Sky's live behavior via C data, not by hardcoding v3 logic in B. B rules in §8 cover the types SOUL.md names; extended v3 shapes are C evolution.

## Sky mapping example (today's single athlete)

Live data: `coach-phelps/training/` (sibling repo). HQ `main` holds generic templates only.

### `sports[]`

| `id` | Source | Sky data |
|------|--------|----------|
| `badminton` | Activity history, `current_week.json` disciplines, coaching priorities | Mon Hit & Run (ranked), Thu friendly, Sat league/social, Sun occasional league; PRE + visualization quest |
| `calisthenics` | Templates, milestones, session logs | Tue Workout A, Wed Workout B; Guruji-led human flag work |
| `conditioning` | Priorities #4, W30 plan | ~1×/wk sprint strides (400m track); leg-load periodization rules |
| `mobility` | W30 plan | Fri Workout C, Sun Workout D |
| `cycling` | Activity history | Commute/recovery — not in weekly spine |

```yaml
# Illustrative MVP entries (not prescriptive S2 YAML syntax)
sports:
  - id: badminton
    role: primary
  - id: calisthenics
    role: strength
  - id: conditioning
    role: conditioning
  - id: mobility
    role: recovery
```

Full schedule detail stays in C data / sport-pack files (e.g. `opponent_notes.md`) — not inlined in B.

### `injury_flags[]`

From Sky's `state.md` → Active Injury Flags (abbreviated):

| region | status | contraindicated_patterns (extract) |
|--------|--------|-------------------------------------|
| `left_hamstring` | cleared | heavy RDL progression until rebuild complete |
| `shoulder` | cleared | overhead pressing, ring dips (bar dips substitute) |
| `right_glute` | monitor | load through tightness; release before loading |
| `wrists` | monitor | false grip overload |
| `ankle` | cleared | — |
| `left_glute` | cleared | reactive — acupuncture over lacrosse when flared |
| `adductors` | cleared | — |
| `calf` | monitor | duration >2.5h |
| `illness` | cleared | inversions (lifted) |
| `cold_start_tolerance` | data_point | not a green light to skip warm-up |

### `conditions[]`

| id | region | notes |
|----|--------|-------|
| `lower_back_history` | lumbar / right chain | Inferred from coaching notes (~5yr history); source of chronic hip/glute tightness |
| `right_hip_tightness` | right_hip_glute | chronic; don't stack plyo + sprint + lower + 2 badminton nights |
| `reactive_glute_pattern` | bilateral_glutes | 24–48h rest + low-pressure release protocol |
| `nutrition_pattern` | dietary | chronically low protein on South Indian meal days |

### `tracking_modules{}`

```yaml
tracking_modules: {}   # MVP — empty. Sky's sleep/PRE/RPE live in state.md sections until P2.
```

Future modules (not MVP): `cycle`, `readiness`, `illness`, `hrv_deload` — per [`engineering/soul-split-plan.md`](engineering/soul-split-plan.md) follow-ups.

HQ ships a **v4 template** (see [`engineering/challenge-v2-schema.md`](engineering/challenge-v2-schema.md)). Legacy v2/v3 repos **migrate to v4** at provision — no parallel shapes in production.

| Block | Sky example (v4 data) |
|-------|-------------|
| `season` | "The Transformation" Mar 2026 → Jan 2027 |
| `phase` / `current_block` | Build Phase; Block 1 closed Jul 19 — current runtime is 20-day cut (Jul 16 → Aug 4) in `state.md` |
| `main_quest` | `weekly_sessions`: floor 2.5/wk, loaded 1.5, skill weight 0.5 cap 1.0 |
| `milestones[]` | FL single-leg, handstand, bar dips, win rate 73%, human flag, sprint |
| `quests[]` | visualization (default_not_done), Inner Game reading (progress) |
| `graduated[]` | foundation, cold shower, protein |

S2 parity must preserve this live shape even though MVP schema formalizes only `sports[]`, `injury_flags[]`, `conditions[]`, and empty `tracking_modules{}`.

## HQ template vs Sky live (onboarding path)

| File | HQ (`coach-phelps-hq/main`) | Sky (`coach-phelps`) |
|------|----------------------------|----------------------|
| `state.md` | Empty Athlete Profile template | Evolved runtime sections (no Athlete Profile heading — data migrated to structured sections) |
| `challenge_v2.json` | v4 template (see [`engineering/challenge-v2-schema.md`](engineering/challenge-v2-schema.md)) | v4 live — migrate from legacy v2/v3 at provision |
| `current_week.json` | Absent until first week plan | Live W30 with guardrails |

First Session Protocol (§10) populates the HQ template shape. Long-running athletes may evolve `state.md` beyond the template — C schema must tolerate both.

## Sign-off checklist

- [ ] MVP shape is minimal: four top-level keys, `tracking_modules{}` empty
- [ ] `sports[]` is a list, not one sport
- [ ] Sky maps cleanly onto injury_flags / conditions / sports
- [ ] B generic-read contract is clear
- [ ] v3 challenge evolution flagged (parity, not forced into MVP schema)
