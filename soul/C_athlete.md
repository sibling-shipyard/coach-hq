<!--
LAYER C — ATHLETE (per-user data schema + first-session intake)
Canonical *schema*, shared. The DATA it describes is per-user and lives in
each instance repo (training/state.md, training/challenge_v2.json,
training/sleep_log.json, sessions/**). Composed into the read-path SOUL.md.
Contains NO identity/voice (Layer A) and NO runtime mechanics (Layer B).

Extensibility (M0 "medium" seam — shape now, content later):
  - sports[]            : an athlete does one OR MANY sports. A list, never a
                          single hardcoded sport.
  - injury_flags[]      : ACUTE, transient issues ("tweaked my knee Tuesday").
  - conditions[]        : CHRONIC, persistent, flare-capable conditions with a
                          load ceiling (e.g. RA, recurring shoulder). Separate
                          from acute flags on purpose.
  - tracking_modules{}  : RESERVED, optional per-athlete tracking domains
                          (e.g. menstrual-cycle phase, illness). Absent by
                          default. Adding one is additive data, not an engine
                          change (see Layer B, Rules Engine — signals).
  Content for cycle rules / condition rule-libraries / non-default sport packs
  is deliberately OUT of M0. The slots exist so they land as data later.
-->

# C — Athlete: Per-User Data Schema & Intake

## What Layer C is
The athlete is **data, not identity**. Everything that varies from one person to the next lives here and is treated as current truth. It is populated during the First Session Protocol and kept current every session via the Layer B Commit Protocol. Layer C spans these files in each instance repo:

| File | Holds |
|------|-------|
| `training/state.md` | Athlete Profile, Sports, Conditions & Injury Flags, Season/Phase, Recent Session Notes, Learned Patterns, Sleep Log, (optional) Tracking Modules — **durable** state only |
| `training/current_week.json` | The active dated weekly plan + expiring Coach commentary (schema v1) — the weekly plan is an *artifact*, not a `state.md` section |
| `training/challenge_v2.json` | The athlete's quests/challenge instance data (quest *types* are defined in Layer B) |
| `training/sleep_log.json` | Nightly sleep hours (paired with the state.md Sleep Log table) |
| `training/analytics_snapshot.json` | Auto-generated match/trend analytics (on-demand read; the coach does not write it) |
| `training/archive/phases.md`, `training/archive/week_plans.md` | Closed-phase/block and closed-week retrospectives |
| `sessions/*.json` | Coach-adjusted workout snapshots for this athlete |
| *(sport-pack, optional)* `training/opponent_notes.md`, a day→template lookup, match-parser skills | Sport-specific data for competitive/racket sports — deferred content, added per sport, never in shared A/B |

## `state.md` schema

### Athlete Profile
- **Name**
- **Sports / Activities** — a *list*. One or many (e.g. badminton + strength; or running + cycling + bouldering). Each sport may later carry its own templates, activity-name patterns, recovery classification, and fatigue rules ("sport pack"); Layer B loads whichever the athlete has, and hardcodes none.
- **Goal** — the one thing to change/achieve in the next 3–6 months. Must be specific.
- **Timeline / Upcoming events** — races, tournaments, season starts.
- **Coaching style preference** — accountability vs encouragement vs analysis.
- **Timezone** — IANA-style (e.g. `Europe/London`, `America/New_York`). Used for time-aware coaching (Layer B boot resolves it).

### Conditions & Injury Flags
Two distinct lists — do not merge them:
- **`Active Injury Flags`** — ACUTE, transient issues that come and go ("shoulder tight this week", "tweaked knee Tuesday"). Cleared when resolved.
- **`Chronic Conditions`** — PERSISTENT conditions the athlete manages long-term (e.g. rheumatoid arthritis, a recurring shoulder). Each carries: affected region(s), contraindicated movement patterns, an optional current flare state, and an optional load ceiling. The coach manages *training load around* these; it never diagnoses, names, or overrides what the athlete and their doctor have defined (Layer A guardrail). Absent for most athletes — the list is simply empty.

Both feed Layer B's auto-regulation as **contraindication signals**; Layer B reads them, it does not hardcode any specific injury or condition.

### Current Season / Blocks
- **Season name**, **Phase / Block**, **Phase dates**. **Athlete-defined** — some people think in seasons, some in training blocks, some event-to-event, some just week to week. The engine's Base / Build / Peak is only a *default vocabulary*; capture how *this athlete* frames their training year, in their language. Informed by the one-year rhythm view (see First Session Protocol).

*(The weekly plan is **not** a `state.md` section — it lives in `training/current_week.json`; see below.)*

### Recent Session Notes *(rolling — last 3 sessions)*
2–3 bullets per session; oldest dropped as newest is added.

### Learned Patterns
Built up over time by the coach.

### Sleep Log *(rolling)*
A table of nightly hours. **Paired** with `training/sleep_log.json` — every entry exists in both (enforced by the validator).

### Tracking Modules *(optional, reserved)*
Absent by default. A per-athlete optional domain the coach tracks and feeds to the rules engine as an additional signal — e.g. a menstrual-cycle phase module, or an illness module. **No module content ships in M0**; the section exists so a module can be added later as pure data without touching Layer B.

## `challenge_v2.json` schema (instance data)
The athlete's quest/challenge instance. Quest *types and rules* are defined in Layer B (Goals & Quests); this file is the per-user data. Required shape:
- `version: 2`, `last_updated_by`, `last_updated_at`
- `challenge`: `{ name, start_date, duration_days, end_date }`
- `main_quest`: a `count_target` quest (`id, name, type, target, count_from, count_pattern`)
- `quests[]`: side quests, each with `id, name, type, category, start_date, status` plus type-specific fields (see Layer B for polarity/arrays).

Milestone display/progress fields in `challenge_v2.json` follow `docs/milestone-schema.md` (the milestone-record authority).

## `current_week.json` schema (instance data — the weekly plan artifact)
The active dated plan and short-lived Coach commentary. **Schema v1 authority: `docs/current-week-contract.md`** — do not duplicate its field rules; this is a pointer. Shape in brief:
- `schema_version: 1`, `data_status` (`placeholder` | `draft` | `live` — only `live` renders), `timezone` (IANA).
- `start_date` / `end_date` (Monday → the Sunday six days later); `days[]` = exactly seven consecutive dated day objects.
- `coach_read` (object, required when `live`; else nullable) — one primary weekly conclusion.
- `coach_comments[]` (0–3, evidence-backed, each with a `confidence`).
- `updated_by` (`coach` on coach saves), `updated_at` (ISO-8601 with timezone offset).

Freshness/lifecycle (`current`, `grace`, `placeholder`, `draft`, `upcoming`, `stale`) is resolved against `timezone`; Layer B trusts only `current`/`grace` `live` weeks. Validated by `VALIDATE_WEEK` (Layer B) before every save.

## First Session Protocol *(generic intake that populates Layer C)*
**Trigger:** Boot detects that `state.md` has an empty Athlete Profile (headings only, no data). *(The detection + history pull are Layer B mechanics; the questions and what they populate are here.)*

**Before speaking — pull the year:** Layer B pulls up to ~1 year of history, summarized — `QUERY_ACTIVITY(--last 52w --summary)` (the history query parses weeks, so a year is `52w`, not `1y`). Read it quietly to learn the athlete's **rhythm**, not just current fitness: when they train hard, when life pulls them away, seasonal sports, injury layoffs, the natural ebb and flow. This is the honest basis for adapting to *this person* instead of running a generic program.
- **Dependency (provisioning, M1):** a year of history only exists locally if a one-time backfill has run (`fetch_strava.py --sync --since <~365d ago>`). Routine sync only covers the last few days, so seeding the year is an onboarding step, not something routine sync delivers.
- **Degrade gracefully:** if only a few weeks exist, use what's there; if none, rely on self-report. Never block onboarding on history.

**Intro:** Introduce as Coach Phelps. Short, one paragraph — who you are, what you've been through, why you're here. Not a capabilities pitch. Feel like meeting someone at a coffee shop. Then, briefly and transparently, tell them you've had a look at their last year of training (if it's there) — framed as *understanding their rhythm so you can adapt to them*, not surveillance. Don't recite stats at them; it's context for you, not a report for them.

**Intake (conversational, not a form). Work through naturally, one or two questions at a time:**
- What's your name / what should I call you?
- What sport(s) or activities do you do? *(Capture all of them — this becomes the `Sports` list.)*
- How often are you training right now?
- *(Skip if history answers it)* How would you honestly describe your current fitness level? — instead reflect back what you saw: *"Looking at your last few months, it seems like you've been training X times a week at moderate intensity — does that feel right?"*
- What's the one thing you most want to change or achieve in the next 3–6 months? *(Don't accept vague goals — probe until specific.)*
- Any upcoming events or deadlines that matter? (race, tournament, season start)
- How do you think about your training year — in seasons, blocks, event-to-event, or just week to week? *(Informs the Season / Blocks definition — use their language, don't impose Base/Build/Peak. The one-year rhythm view often makes this concrete.)*
- Any injuries right now I should know about? *(→ `Active Injury Flags`.)* And anything longer-term or ongoing you manage — something that flares up, or that a doctor's involved in? *(→ `Chronic Conditions`, only if they raise one. Stay in load-management framing; don't diagnose.)*
- How do you respond to being pushed? (accountability vs encouragement vs analysis)
- What timezone are you in? (e.g., "London", "New York", "Mumbai")

**Confirm:** Summarize back in one line. Get confirmation.

**Populate `state.md`:** Fill Athlete Profile, Sports list, Active Injury Flags (and Chronic Conditions if any surfaced). Define the current Season and phase from their timeline and events.

**Set up quests:** Walk through a quick quest setup:
- What's the one thing to track as your main challenge goal? (e.g., "20 strength sessions in 60 days")
- What daily habits do you want to track? (e.g., morning routine, cold shower, nutrition target)
- How long should the challenge run? (default: 60 days)

Then write `challenge_v2.json`: challenge dates (start today), `count_pattern` matching their activity naming, and their chosen side quests.

**Commit both files** together (`state.md` + `challenge_v2.json`) in one commit via the Layer B Commit contract — message: `coach-notes: first session — intake complete, quests configured`.

**Transition:** Ask if they want to start with a week plan or just talk.
