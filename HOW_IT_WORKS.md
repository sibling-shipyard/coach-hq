# How It Works

This explains the concepts and daily workflow behind Coach Phelps - not how to set your accounts up, but what actually happens once it's running: what a "season" is, what files exist and why, and how everything connects to what you see on the dashboard.

Read this once after setup, before your first session. You won't need to memorize it - the coach handles almost everything automatically - but it'll save you a lot of "wait, what does this mean?" moments.

---

## 1. The mental model: Season > Challenge > Quests

These three words get used a lot and it's easy to mix them up. They nest inside each other:

- **Season** - your ongoing coaching relationship. Indefinite, no end date. Has a name and moves through phases (Base, Build, Peak - see below). Lives in `training/coach/state.md`.
- **The Challenge** - a bounded sprint *inside* the season, typically 60 days. This is the gamified kickstart tool: a main goal plus a handful of side quests, all with a start and end date. Lives in `training/ledger/challenge_v2.json`. When a Challenge ends, the Season keeps going - you just start a new Challenge, or coast without one for a while.
- **Quests** - the individual trackable things *inside* a Challenge: one `main_quest` (the headline goal) plus several side `quests` (habits and smaller goals). Both live inside the same `challenge_v2.json` file.

So: Season (indefinite) contains Challenge (60-day sprint) contains Quests (main + side). If you only remember one thing from this doc, remember that the Challenge is a tool used *during* a season, not the whole relationship.

**Season phases** - the default framework the coach uses to think about where you are in a season:
- **Base** - building habits and consistency, not optimizing performance yet.
- **Build** - ramping up intensity and load.
- **Peak** - sharpening toward a specific event or goal.

These are just labels + date ranges the coach writes into `state.md` and references naturally in conversation ("we're in Build now, this is where we add load"). You don't set these directly - they come out of your goals and the coach's judgment.

---

## 2. What happens in your first session

The very first time you talk to your coach, it detects that `training/coach/state.md` is blank and runs an intake conversation automatically - you don't need to say anything special to trigger it. During this conversation the coach:

- Reviews your synced Strava history silently, if you did that step in setup
- Asks you conversationally about your goals, sport(s), schedule, coaching style preference, timezone, and any injuries
- Confirms your profile back to you
- Writes `training/coach/state.md` (your profile) and `training/ledger/challenge_v2.json` (your first Challenge - main goal + side quests, defaulting to a 60-day sprint)
- Commits both files to your repo

You don't need to hand-write either of these files before this conversation happens - just leave them as they ship (blank/example) and let the coach fill them in. After that, they update automatically every session.

---

## 3. A day in the life

Day-to-day, you don't run commands or edit files - you just talk to the coach normally, and it captures what matters:

- **Mention a workout, your sleep, how sore you are, anything about training** - the coach picks this up from normal conversation, no special format needed.
- **Sleep specifically** gets written to two places at once: the Sleep Log table inside `state.md` *and* `training/activities/sleep_log.json`. Both exist because one is for the coach's own memory, the other feeds the dashboard's sleep chart. You'll never need to touch either by hand.
- **Ending the conversation** ("goodnight," "that's it for today") triggers a lightweight closing check, then the **Commit Protocol**: the coach updates `state.md`, `challenge_v2.json`, and `coach_notes.md`, regenerates `training/activities/quest_log.md`, and pushes a commit straight to your repo's `main` branch. No pull request, no confirmation needed from you - this is pre-authorized as part of how the coach works.

That last point matters to understand: **every real conversation with your coach results in an actual commit to your GitHub repo.** If you check your repo's commit history, you'll see these show up as `coach: day-N - ...` commits.

---

## 4. The weekly rhythm

- **Weekly Kick-off Ritual** - triggered when you say something like "let's plan the week," or proactively by the coach on a Monday if no plan exists yet. Covers upcoming events/schedule changes and writes your plan for the week into `state.md`.
- **Sunday Weekly Session** - a separate, heavier ~30-minute ritual: reviewing the week against the plan, locking in next week, a mental-game check-in, and a bit of reflection. Distinct from the kick-off - kick-off sets the plan, the Sunday session reviews and adjusts it.
- **Deload weeks** - automatic, every 4th week of a season: sets get cut in half at the same intensity, with more room for mobility and recovery. You don't need to ask for this or track it - it's calendar-driven.

---

## 5. File map: what lives in `training/` and who writes it

| File | Written by | Read by | What it's for |
|---|---|---|---|
| `state.md` | Coach, every session | Coach, every boot | Living memory: your profile, current season/phase, a rolling summary of your last 3 sessions, active injury flags, and this week's plan. |
| `roadmap.md` | Coach | Coach | A season-level, week-by-week plan at a glance. Similar to `state.md`'s week plan but zoomed out to the whole season rather than just this week - the two stay in sync, they're not competing systems. |
| `quest_log.md` | **Script only** (`scripts/generate_quest_log.py`) - never hand-edited, and the coach never edits it either | Coach, every boot | The computed dashboard: challenge day count and percent complete, main quest pace vs. target, a streak/rate table per side quest, and weekly target progress. All the streak math lives here so nobody has to compute it by hand. |
| `coach_notes.md` | Coach, append-only | Coach, on request only (not read every boot) | A long-term journal of patterns and observations - separate from the short "last 3 sessions" summary that lives inside `state.md` (which *is* read every boot). |
| `challenge_v2.json` | Coach | Generator scripts | The single source of truth for your current Challenge and its quests - see section 6 below. |
| `sleep_log.json` | Coach | Sync pipeline / dashboard | Your nightly sleep hours, one entry per night. |

You'll basically never hand-edit any of these - the coach maintains them as part of every session. It's still worth knowing what each one is for, since you can always open them and read your own history.

---

## 6. Quests, explained simply

Inside `challenge_v2.json`, quests come in a few practical types:

- **`daily_streak`** - a habit tracked day by day (e.g. "Morning Routine"). Has a `polarity`:
  - `default_done` - assumed completed unless you tell the coach you missed it. Misses go in `missed_dates`; excused misses (e.g. a planned rest day) go in `excused_dates` and don't break your streak.
  - `default_not_done` - the opposite: assumed not done unless logged. Completions go in `completed_dates`.
- **`progress`** - a simple running number toward a target (e.g. "Read a Book" tracked in chapters, `current`/`target`/`unit`).
- **`count_target`** (used by `main_quest`) - counts how many of your Strava activities match a pattern.

**The trickiest part: `count_pattern`.** Your main quest's progress is driven by a regex matched against your Strava activity *names* (not the sport type), counted from the challenge's start date onward. For example `"^Strength\\s*#"` matches an activity literally named "Strength #12". If your activity names don't match the pattern - say you renamed a workout differently, or never set up the naming convention - your main quest will silently show 0 progress with no error. If your main quest ever looks stuck at 0, check that your Strava activity names actually match the `count_pattern` in `challenge_v2.json`.

**`weekly_targets`** power the weekly progress table on the dashboard and in `quest_log.md`. Each target has a `source`:
- `"quest"` - pulls from a `daily_streak` quest's completions (e.g. "Morning Routine" hit 6/7 days this week).
- `"strava_pattern"` - counts Strava activities whose name matches a regex.
- `"strava_sport"` - counts Strava activities matching a `sport_type` (optionally narrowed further by a name pattern too).

**One gotcha worth knowing:** if you set up a quest specifically for sleep, keep its `id` literally as `"sleep"`. The dashboard's Monthly Analytics page looks up a quest by that exact id to show a sleep-streak counter - nothing else about it is special, but naming it something else means that one widget won't find it.

---

## 7. Workout templates and sessions

- **`templates/`** - six generic starter workout templates ship with the repo (foundation, recovery, two calisthenics, two strength). These are ready to use as-is - you don't need to write your own before starting.
- **`sessions/`** - optional, day-specific overrides. If the coach needs to modify a template for one particular day (swap an exercise for an injury, halve the volume for a deload), it writes a session file here (`sessions/YYYY-MM-DD_<template-id>.json`) rather than editing the base template. On the day it's dated for, the dashboard's Workouts page shows that version instead of the plain template, with a `TODAY` badge. If nothing needs to change on a given day, no session file gets written - you just see the normal template.
- All of this compiles automatically: `ui/scripts/build-data.mjs` runs on every `npm run dev` or `npm run build` inside `ui/`, reads `templates/` and any recent `sessions/` files, and bundles them into what the dashboard actually displays. Nothing needs to be run by hand for this.

---

## 8. Dashboard pages, and what feeds them

| Page | What it shows | Data it reads |
|---|---|---|
| **Home** | Streak counters, main quest progress/pace, weekly target progress, a training volume chart, an activity heatmap, side quest progress bars, and a filterable feed of recent activities. | `activities.json` (your synced Strava history), `challenge_v2.json`, `sync_status.json` |
| **Workouts** | Your six workout templates, grouped by type, with any of today's session overrides applied (see section 7). | The compiled `workouts.json` (templates + sessions) |
| **Monthly Analytics** | A month-by-month view of training volume, this month's workout breakdown vs. last month, your sleep summary, and quest completion history. | `activities.json`, `sleep_log.json`, `quest_history.json` (a generated file, separate from the raw `challenge_v2.json`), `sync_status.json` |
| **Run / Badminton Analytics** | Sport-specific example dashboards (pace trends, HR zones, personal bests for running; load/session tracking for badminton). Provided as reference implementations - use, adapt, or delete whichever doesn't match your sport. | `activities.json`, filtered by sport |
| **Badminton Match Analytics** | A second badminton reference page focused on match results - win/loss record, partner/opponent stats, fatigue curve, HR vs. win rate. Parses structured match data out of Strava activity descriptions (see `docs/badminton-roster.md`). Coexists with the main Badminton Analytics page; delete if you don't need match-level detail. | `activities.json`, filtered by badminton category |

The common thread: everything you tell your coach eventually lands in one of the `training/` files, and the dashboard reads compiled versions of those files. "Thing I did" -> file the coach updates -> what shows up on the dashboard.

---

## 9. What's safe to touch by hand

A quick closing checklist:

- **Never hand-edit:** `training/activities/quest_log.md`, `ui/client/src/data/quest_history.json`, or anything inside `ui/client/src/data/` - these are all auto-generated and get overwritten on the next sync/build/session anyway.
- **Normally coach-written, but fine to read:** `training/coach/state.md`, `training/ledger/challenge_v2.json`, `training/coach/coach_notes.md`, `training/coach/roadmap.md`, `training/activities/sleep_log.json`. You can open and read any of these anytime to see exactly what your coach knows. Editing them by hand won't break anything technically, but it's usually better to just tell the coach what you want changed in conversation - it'll keep everything in sync (e.g. regenerating `quest_log.md` after a `challenge_v2.json` edit) in a way a manual edit won't.
- **Yours to edit freely:** `templates/*.json` if you want to change your base workouts (though see `.github/agents/` if you're using the multi-agent engineering setup - template changes go through Tech Lead review there), and anything in `sessions/` you want to clear out manually.
