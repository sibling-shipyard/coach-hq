# Plan: coach-phelps-template repo

## Context
Sky wants to share the coaching system with his brother and friends as a cloneable template. The current repo is hardcoded to Sky (sports schedule, injury history, quest patterns, etc.). This plan creates a new `coach-phelps-template` repo that any athlete can clone, run the Strava OAuth setup, open a Claude session, and have Coach Phelps run an intake interview to get them started.

**v1 scope:** SOUL.md (generic Phelps + First Session Protocol) + state.md template + Strava sync scripts (as-is) + parameterized quest system. No UI (v2).

**GitHub repo:** `akash-suresh/coach-phelps-template` — already created by Sky. Push via git CLI.

---

## Repo structure

```
~/coach-phelps-template/
  SOUL.md                      ← Rewritten (generic Phelps + First Session Protocol)
  SETUP.md                     ← Getting started guide
  .env.example                 ← Strava env var template
  .gitignore                   ← Exclude .env, strava_tokens.json, __pycache__, history data
  training/
    state.md                   ← Blank template (headings only)
    coach_notes.md             ← Empty (header only)
    challenge_v2.json          ← Generic quest template (parameterized fields, example dates)
    history/.gitkeep           ← Placeholder so directory exists after clone
  sessions/.gitkeep            ← Placeholder for coach-adjusted workout snapshots
  strava/
    strava_api.py              ← Copy as-is (fully generic)
    fetch_strava.py            ← HR_ZONES comment added (customize for your zones)
    oauth_reauth.py            ← Copy as-is (fully generic)
    query_history.py           ← HR_ZONES comment added (customize for your zones)
  scripts/
    generate_quest_log.py      ← Parameterized version (no hardcoded patterns)
```

**Not included in v1:** analytics snapshot, match parsers, rename scripts, workout templates, sessions, history data, run_sync_pipeline.py, dashboard.

---

## Step 1 — Create directory and git init

```bash
mkdir ~/coach-phelps-template
cd ~/coach-phelps-template
git init
mkdir -p training strava scripts
```

---

## Step 2 — Write SOUL.md

The biggest piece of work. Keep the Phelps identity intact; strip Sky-specific content.

**Sections to KEEP (mostly unchanged):**
- §1 Boot Sequence — update to remove Sky-specific file refs (analytics_snapshot, opponent_notes, league_warmup)
- §2 Guardrails — keep, remove sport-specific lines
- §3 Identity & Voice — keep entirely (this is Phelps' persona, not Sky-specific)
- §4 Coaching Philosophy — keep entirely
- §5 Seasons & Arcs — keep structure, replace Sky's specific dates with placeholder
- §6 Situation Playbook — keep, replace "Sky" with athlete name variable `{ATHLETE_NAME}`
- §12 Commit Protocol — keep as-is (generic)

**Sections to REWRITE:**
- §7 "The Athlete: Sky" → **"First Session Protocol"** (see below)
- §8 Goals & Quests → Generic quest setup (populated during first session)
- §9 Rules Engine → Strip Sky-specific schedule/venues; keep auto-regulation concepts as a framework the coach fills in during first session
- §10 Workflows → Keep: Pre-Workout Check, Weekly Kick-off, Logging, Quest Tracking, Commit Protocol. Remove: eBadders, Apple Fitness, Visualization Audio, Opponent Notes (Sky-specific)
- §11 Tools → Simplify to: fetch_strava.py, query_history.py, generate_quest_log.py only

**Remove entirely:** Protein estimation reference, badminton schedule/venues, partner/opponent names, Guruji, equipment inventory, Inner Game of Tennis refs, Timer Physics fields, visualization audio format rules, voice profile reference.

### First Session Protocol (new §7)

Triggered when coach boots and detects `training/coach/state.md` contains only the template header (Athlete Profile section is empty).

**Step 1 — Warm intro:** Introduce as Coach Phelps. Short. One paragraph: who you are, what you've been through, why you're here. Not a capabilities pitch. Feel like meeting someone at a coffee shop.

**Step 2 — Intake (conversational, not a form). Questions to work through:**
- What's your name / what should I call you?
- What sport(s) or activities do you do?
- How often are you training right now?
- How would you honestly describe your current fitness level?
- What's the one thing you most want to change or achieve in the next 3-6 months?
- Any upcoming events or deadlines that matter? (race, tournament, season start)
- Any injuries or physical limitations I should know about?
- How do you respond to being pushed? (accountability vs encouragement vs analysis)

One or two questions at a time. Follow up naturally. Don't accept vague goals — probe.

**Step 3 — Confirm:** Summarize back in one line. Get confirmation.

**Step 4 — Write state.md:** Populate the Athlete Profile section and write an initial `Active Injury Flags` section.

**Step 5 — Set up quests:** Walk through a quick quest setup before closing:
- What's the one thing you want to track as your main challenge goal? (e.g., "20 strength sessions in 60 days")
- What do you want to call your daily habits? (e.g., morning routine, cold shower, nutrition target)
- How long do you want the challenge to run? (default: 60 days)
Then write `training/ledger/challenge_v2.json` with: challenge dates (start today), `count_pattern` matching their Strava activity naming, and their chosen side quests.

**Step 6 — Commit both files.** `state.md` + `challenge_v2.json` together in one commit.

**Step 7 — Transition:** Ask if they want to start with a week plan or just talk.

---

## Step 3 — Write training/coach/state.md (blank template)

```markdown
# Coach Phelps: state.md (Living Memory)
*Updated every session via the Commit Protocol.*
*For quest status, streaks, and progress — see quest_log.md (auto-generated, read-only).*

## Athlete Profile
*(Filled in during First Session)*
- **Name:**
- **Sport(s) / Activities:**
- **Goal:**
- **Timeline / Upcoming events:**
- **Coaching style preference:**

## Recent Session Notes *(rolling — last 3 sessions)*
*(Empty — first session will populate this)*

## Active Injury Flags
*(None — update if injuries arise)*

## Current Week Plan
*(Set during first weekly planning session)*

## Learned Patterns
*(Coach builds this over time — starts empty)*
```

---

## Step 4 — Write training/ledger/challenge_v2.json (parameterized template)

Key changes from the Sky version:
- `main_quest.count_pattern` — new field (was hardcoded in script as `^Calisthenics\s*#`)
- `weekly_targets` — restructured from `{key: int}` to `{label: {target, source, ...}}` so the script knows how to count each category

Dates use real example values so the validator doesn't crash. Coach updates them to actual start date during First Session.

```json
{
  "version": 2,
  "last_updated_by": "coach",
  "last_updated_at": "2026-01-01",
  "challenge": {
    "name": "My 60-Day Challenge",
    "start_date": "2026-01-01",
    "duration_days": 60,
    "end_date": "2026-03-01"
  },
  "weekly_targets": {
    "Morning Routine": {
      "target": 7,
      "source": "quest",
      "quest_id": "morning_routine"
    },
    "Strength Training": {
      "target": 2,
      "source": "strava_pattern",
      "pattern": "^Strength\\s*#"
    },
    "Sport": {
      "target": 2,
      "source": "strava_sport",
      "sport_type": "Badminton",
      "pattern": "^(Session|Training|Match)"
    }
  },
  "main_quest": {
    "id": "main",
    "name": "20 Strength Sessions",
    "type": "count_target",
    "target": 20,
    "count_from": "strava",
    "count_pattern": "^Strength\\s*#",
    "notes": "Regex matched against Strava activity names from challenge start date"
  },
  "quests": [
    {
      "id": "morning_routine",
      "name": "Morning Routine",
      "type": "daily_streak",
      "category": "side",
      "start_date": "2026-01-01",
      "status": "active",
      "polarity": "default_done",
      "tracking": "manual",
      "missed_dates": [],
      "excused_dates": [],
      "notes": "Daily morning routine — skips are excused on rest days"
    },
    {
      "id": "example_progress",
      "name": "Read a Book",
      "type": "progress",
      "category": "side",
      "start_date": "2026-01-01",
      "status": "active",
      "tracking": "manual",
      "current": 0,
      "target": 10,
      "unit": "chapters"
    }
  ]
}
```

---

## Step 5 — Parameterize scripts/generate_quest_log.py

Three functions need changes (count_main_quest, compute_weekly_counts, render_quest_log).

### `count_main_quest()` — line 219
**Before:**
```python
if act_date >= challenge_start and re.match(r"^Calisthenics\s*#", name):
```
**After:**
```python
pattern = main_quest.get("count_pattern", "")
if act_date >= challenge_start and pattern and re.match(pattern, name):
```

### `compute_weekly_counts()` — lines 314-350
**Before:** Hardcoded `{"foundation": 0, "calisthenics": 0, "badminton": 0}` dict with hardcoded quest ID lookup and regexes.

**After:** Read `weekly_targets` config from the data dict, build counts dynamically:
```python
def compute_weekly_counts(activities, data, today):
    week_start = iso_week_start(today)
    week_end = week_start + timedelta(days=6)
    weekly_targets = data.get("weekly_targets", {})
    quests = data.get("quests", [])
    counts = {label: 0 for label in weekly_targets}

    for label, cfg in weekly_targets.items():
        source = cfg.get("source", "")
        if source == "quest":
            # Derive from quest data (default_done daily streak)
            quest_id = cfg.get("quest_id")
            q = next((q for q in quests if q.get("id") == quest_id), None)
            if q and q.get("type") == "daily_streak":
                q_start = parse_date(q["start_date"])
                eff_start = max(q_start, week_start)
                eff_end = min(today, week_end)
                if eff_start <= eff_end:
                    missed = set(q.get("missed_dates", []))
                    excused = set(q.get("excused_dates", []))
                    all_missed = missed | excused
                    eligible = (eff_end - eff_start).days + 1
                    missed_wk = len([m for m in all_missed
                                     if eff_start <= parse_date(m) <= eff_end])
                    counts[label] = eligible - missed_wk

    for a in activities:
        act_date_str = a.get("start_date_local", "")[:10]
        if not act_date_str:
            continue
        try:
            act_date = parse_date(act_date_str)
        except ValueError:
            continue
        if not (week_start <= act_date <= week_end):
            continue
        name = a.get("name", "")
        sport = a.get("sport_type", "")
        for label, cfg in weekly_targets.items():
            source = cfg.get("source", "")
            if source == "strava_pattern":
                pattern = cfg.get("pattern", "")
                if pattern and re.match(pattern, name):
                    counts[label] += 1
            elif source == "strava_sport":
                sport_match = cfg.get("sport_type") and sport == cfg["sport_type"]
                pattern = cfg.get("pattern", "")
                name_match = pattern and re.match(pattern, name)
                if sport_match or name_match:
                    counts[label] += 1

    return counts
```

### `render_quest_log()` — lines 450 and 456-459

**Two fixes needed:**

1. Fix the `compute_weekly_counts` call (line 450) — currently passes `data.get("quests", [])`, must pass `data`:
```python
weekly_counts = compute_weekly_counts(activities, data, today)
```

2. Fix the weekly targets iteration (lines 456-459) — `target` is now a dict, not an int:
```python
for cat, cfg in weekly_targets.items():
    target = cfg["target"] if isinstance(cfg, dict) else cfg
    done = weekly_counts.get(cat, 0)
    bar = progress_bar(done, target)
    lines.append(f"| {cat.title()} | {done} | {target} | {bar} |")
```

---

## Step 6 — Copy and patch Strava scripts

Copy all four scripts. Then add a `# CUSTOMIZE` comment block above `HR_ZONES` in both `fetch_strava.py` and `query_history.py`:

```python
# ── CUSTOMIZE: HR zone boundaries ──────────────────────────────────────────
# Update these to match your personal HR zones.
# Simple estimate: Zone 2 upper = 70% of max HR (220 - age).
# Or use a lab test / Garmin/Polar zone calculator for accuracy.
HR_ZONES = [
    ("Zone 1", None, 131),   # Recovery
    ("Zone 2", 132, 145),    # Aerobic base
    ("Zone 3", 146, 158),    # Aerobic
    ("Zone 4", 159, 172),    # Threshold
    ("Zone 5", 173, None),   # Max effort
]
```

`strava_api.py` and `oauth_reauth.py` — copy as-is (fully generic).

---

## Step 7 — Write SETUP.md, .gitignore, and .env.example

### SETUP.md — contents:
1. **Clone:** `git clone https://github.com/akash-suresh/coach-phelps-template.git`
2. **Strava setup:**
   - Go to [strava.com/settings/api](https://www.strava.com/settings/api) and create an app (callback URL: `http://localhost`)
   - `cp .env.example .env` → fill in `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET`
   - Run `python strava/oauth_reauth.py` — it opens a browser, you authorize, tokens are saved
   - Test: `python strava/fetch_strava.py --last 3` — should print your last 3 activities
3. **Customize HR zones:** Open `strava/fetch_strava.py` and `strava/query_history.py` — update the `HR_ZONES` list to match your personal zones
4. **First session:**
   - Install [Claude Code CLI](https://claude.ai/code) or use Claude.ai
   - Open a Claude session in the cloned repo directory (Claude Code: `claude` command from repo root; Claude.ai: upload SOUL.md + state.md as attachments)
   - Coach Phelps will detect the blank `state.md` and run your intake automatically

### .gitignore:
```
.env
strava/strava_tokens.json
training/activities/history/
__pycache__/
*.pyc
*.pyo
.DS_Store
```

### .env.example:
```
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=
STRAVA_REFRESH_TOKEN=
STRAVA_ACCESS_TOKEN=
```

---

## Step 8 — Initial commit and push

```bash
cd ~/coach-phelps-template
git add -A
git commit -m "init: coach-phelps-template v1.0 — generic coaching system"
git remote add origin https://github.com/akash-suresh/coach-phelps-template.git
git push -u origin main
```

---

## Verification

1. Read the generated `SOUL.md` — confirm no Sky-specific references remain (no "Sky", no "badminton schedule", no Guruji, no protein benchmarks)
2. Validate `challenge_v2.json` with `python scripts/generate_quest_log.py --validate` (dry run against the template)
3. Confirm `generate_quest_log.py` runs without error on the template: `python scripts/generate_quest_log.py --dry-run`
4. Read the rendered `quest_log.md` output — confirm weekly targets and main quest are driven from JSON config, not hardcoded
5. Spot-check: change `count_pattern` in `challenge_v2.json` and confirm the script picks it up without code changes
