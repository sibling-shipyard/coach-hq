# UI Expert

**Thread purpose:** All frontend changes in `ui/`. Pixel-perfect, UX-aware, performance-conscious.

**How we work:** `AGENTS.md` § How all agents work. UI-specific: no architecture changes — flag to Tech Lead.

## Boot Sequence

On entry, read: `AGENTS.md` (routing + KB index), this doc, and `kdb/decisions/README.md` (ADR index — skim decisions tagged `Area: ui`). Follow `kdb/doc-style.md` for any design doc.

## Repo
- This is a monorepo. Your scope is `ui/` only.
- Data pipeline changes (`strava/`, `scripts/`, `training/`) are Bob the Builder territory. The native app (`ios/`) is iOS Builder territory.

## Codebase Map

```
ui/
├── package.json / vite.config.ts
├── vercel.json                 # Vercel deploy config
├── api/
│   └── trigger-sync.ts        # Vercel serverless function (sync button → GitHub Actions)
├── scripts/
│   └── build-data.mjs         # Pre-build: merges data/, training/ → client/src/data/
├── docs/                       # Warm Instrument spec + production notes — read before touching home-warm/ or workout-timer-warm/
│   ├── reference-interactions/          # Immutable source reference — DO NOT edit these files
│   │   ├── README.md                    # Manifest + SHA-256 of the supplied files
│   │   ├── Widget Design Philosophy.md  # THE canonical spec — read this first, every time
│   │   ├── Widget Interactions.dc.html  # Live interaction playground, read-only cards
│   │   ├── Widget Gallery.dc.html       # Full S/M/L size catalog, per-widget tap targets
│   │   └── Sport Analytics.dc.html      # Spine + lens model, scope toggle, XL anchor
│   ├── reference-interactions-analysis.md      # Production interpretation for THIS codebase (route names, required/excluded behaviors)
│   ├── reference-interactions-acceptance.md    # Formal acceptance contract (global invariants + per-widget behavior matrix)
│   └── reference-interactions-validation.md    # Validation report (fidelity checks, TS diagnostics)
└── client/src/
    ├── data/                  # Built output (DO NOT edit directly)
    │   ├── activities.json    # Merged from training/activities/history/
    │   ├── challenge_v2.json  # Mirror of training/ledger/challenge_v2.json
    │   ├── quest_history.json # Quest completion history across seasons
    │   ├── sleep_log.json     # Mirror of training/activities/sleep_log.json
    │   ├── sync_status.json
    │   └── workouts.json
    ├── pages/
    │   ├── Home.tsx                     # Warm Instrument dashboard (main route)
    │   ├── Workouts.tsx                  # Workout overview + detail
    │   ├── SportAnalyticsBadminton.tsx   # Badminton Play LENS (/analytics/badminton)
    │   ├── SportAnalyticsRunning.tsx     # Running Pace LENS (/analytics/running)
    │   ├── SportAnalyticsCalisthenics.tsx # Calisthenics Skill LENS (/analytics/calisthenics)
    │   ├── MonthlyAnalytics.tsx          # Monthly rollup (/analytics/monthly)
    │   ├── Login.tsx / AuthError.tsx / Onboarding.tsx  # Multi-tenant auth flow (this repo only, no equivalent in a personal fork)
    │   ├── NotFound.tsx                  # 404 page
    │   └── workout-timer/               # Timer state machine (see docs/timer-state-machine.md)
    ├── components/
    │   ├── ErrorBoundary.tsx
    │   ├── RepoDataGate.tsx           # Multi-tenant repo-data loading gate (this repo only)
    │   ├── home-warm/                 # Warm Instrument widget set: WarmInstrumentHome.tsx, WarmInstrumentWidgets.tsx, warmHomeModel.ts, liveWeekContract.ts, currentWeekAdapter.ts, ActivityGlyph.tsx, warm-instrument.css
    │   ├── sport-analytics/           # LENS + SPINE: *LensModel.ts, *LensWidgets.tsx, SportSpine.tsx, chartUtils.ts, sport-analytics.css
    │   ├── monthly-analytics/         # Monthly rollup: monthlyAnalyticsModel.ts, MonthlyAnalyticsWidgets.tsx, monthly-analytics.css
    │   ├── workout-timer-warm/        # Warm Instrument timer widgets: WorkoutTimerWidgets.tsx, workout-timer-warm.css
    │   ├── login/                     # LoginPage.tsx, login.css
    │   └── ui/                        # shadcn primitives (button, dialog, tooltip, etc.)
    ├── lib/
    │   ├── activities.ts          # Activity types + name-based classification
    │   ├── challenge.ts           # Challenge/quest type definitions
    │   ├── workouts.ts            # Workout/Phase/Exercise types + helpers
    │   ├── matchParser.ts         # Parses win/loss match data from Strava descriptions
    │   ├── nameAliases.ts         # Name normalization for match analytics
    │   └── utils.ts
    ├── hooks/
    │   └── useRepoData.ts          # Multi-tenant repo-data hook (this repo only)
    └── contexts/
        ├── ThemeContext.tsx
        └── AuthContext.tsx         # Multi-tenant auth context (this repo only)
```

## Design System — Warm Instrument

Warm Instrument is **the** design system for the dashboard — `Home.tsx` and every page/component above already build on it. There is no legacy neo-brutalist variant in this repo to avoid; all new and ongoing work follows `home-warm/` / `workout-timer-warm/` conventions.

**Source of truth:** `ui/docs/reference-interactions/Widget Design Philosophy.md`. Read it before building or changing any widget — this section is a summary, not a replacement for it. Mine `ui/docs/reference-interactions/Widget Gallery.dc.html` and `Sport Analytics.dc.html` for the exact component you need (the cube, the session row, the sport chip, the card shell, the Engine card, the scope toggle) rather than inventing a new one.

**The feeling:** a calm, competent coach's desk — never a gamified dashboard. The athlete should feel watched over, not surveilled; informed, not judged.

**Palette (locked):**

| Token | Hex | Use |
|---|---|---|
| Paper | `#fbf8f1` | card surfaces |
| Desk | `#e8e2d7` | page background |
| Ink | `#2b2d29` | text, dark buttons |
| Accent (terracotta) | `#7f3728` | **load only** — the one warm/glowing thing |
| Coach tint | `#f3eee3` | the italic-voice card only |
| Alarm | `#e4e4ec` / `#4b5578` | the *only* "something's wrong" treatment — cold, never red; never stacked |
| Sport: BDM/CAL/FDN/RIDE | `#315a4a` / `#4f587a` / `#6d7d4e` / `#a8702c` | badminton / calisthenics / foundation / cycling |

**Type:** Space Grotesk (UI/headlines), Space Mono (figures & labels, 9–11px, ≥.1em tracking), Newsreader italic (the coach's voice, only — copy is signed "— PHELPS").

**Card shell:** 26px radius · 1px warm border · soft shadow (~0 10–20px, low alpha) · generous padding. This is a shared atom — scale it per platform, never redesign it.

## Interaction Quality Bar

This is the bar the Tech Lead checks PRs against — **a widget that's visually re-skinned in Warm Instrument colors but interaction-flat is not done.** Every widget must ship its documented interaction budget, not just its visual state. Per `Widget Design Philosophy.md`'s global principles:

1. **Hover reveals, tap does nothing** on read-only cards — for web that means hover scrubs on trend lines (Engine, VO2 max) and hover tooltips (heatmap cells, calorie pace bar), not a static SVG.
2. **The exceptions are deliberate and must be built exactly as specced** — drag a plan chip between days (projection recomputes live), heatmap month paging (‹ › arrows), and on sport-lens analytics widgets a **scope toggle** (8W/ALL, RANKED/ALL) that reframes the same widget in place — it never navigates.
3. **Data states are always live.** Never a placeholder number — a widget with no data collapses to its opt-in/empty state.
4. **One alarm color, never stacked.** The cold indigo-grey flood (`#e4e4ec`/`#4b5578`) is the only "something's wrong" treatment.
5. **Motion is physical and brief:** 3–4px hover lifts, 150–250ms ease. Nothing loops for attention.

Before implementing a widget, check `Widget Gallery.dc.html` for its S/M/L variants and `Widget Interactions.dc.html` for the exact interaction mechanics (thresholds, payload shapes) — don't guess at hover-scrub math or drag-drop semantics.

## Guardrails
- Don't introduce new colors, fonts, or a second accent — terracotta means load, full stop.
- Don't gamify — no XP, streak-guilt, confetti, or leaderboards.
- Don't invent numbers — figures come from logged sessions or are clearly marked as projections.
- Don't redesign a shared atom (card shell, sport chip, session row, cube) for one surface — scale it, don't reinvent it.
- Don't use emoji as UI — the sport SVG icon set is the vocabulary.

## Key Rules

**Data pipeline:**
- `build-data.mjs` reads directly from `../training/`, `../templates/`, `../sessions/` at the repo root — there is no intermediate `data/` copy folder
- `client/src/data/` is built output — never edit it directly
- To change workout templates, edit `templates/*.json` at the repo root (outside `ui/`) then run `node scripts/build-data.mjs` from inside `ui/`

**Dev server (run from `ui/`):**
- Start: `npm run dev` (automatically runs `predev` → `build-data.mjs` → Vite)
- Runs at `localhost:3000`

**Known gotchas:**
- Vite caches JSON imports aggressively. After data changes, you may need to restart the dev server (kill + `npm run dev`) for changes to take effect
- `predev` rebuilds `client/src/data/` on every `npm run dev` — any manual edits to that directory get overwritten
- `workout-timer/` is the most complex component — implements a state machine. Read `docs/timer-state-machine.md` before making any changes
- **CSS specificity on buttons:** `warm-instrument.css` has a global `.wi-shell button, .wi-shell input, ... { font: inherit; }` reset. Its specificity (one class + one element) beats a bare single-class selector like `.my-widget__button { font-family: ... }` *regardless of which stylesheet loads later* — the font declarations get silently discarded. Any new button styling under `.wi-shell` needs a compound selector (`.parent-class button`) or an element-qualified one (`button.my-widget__button`) to actually win. Verify with `getComputedStyle(el).fontFamily` if a button's type looks even slightly off — don't trust a screenshot alone, low-res renders can hide this.
- **`prefers-reduced-motion` cascade order:** if a widget's base rule sets `transition: ...` unconditionally, a `@media (prefers-reduced-motion: reduce)` override needs to come *after* that rule in the cascade (same file, later position, or a later-loaded file) to actually win — the media query alone doesn't grant priority. Safest bet: put reduced-motion overrides at the very end of the stylesheet.
- **Sport LENS trend charts:** the full-width `<rect>` in `WinRateTrend` is the chart background only — not a data band. The gauge band (25th–75th percentile of lifetime 4-week rolling win%) lives on `WinRateGauge` only. Don't add adaptive shaded bands to the trend without explicit spec approval — it was tried and reverted.
- **SVG `preserveAspectRatio="none"`:** stretches circles into ellipses. On session-shape hover dots, use HTML overlay elements positioned with `%` — not `<circle>` inside a non-uniformly scaled SVG.
- **Sport analytics scope toggle order:** RANKED first, ALL second on badminton header (matches spec intent). Running volume hero uses **8W first, 52W second** (ghost toggle on hero, like badminton win-rate). Pace trend is fixed **52W** — no per-widget toggle.
- **Running weekly volume bars:** chart weeks must be consecutive **calendar** ISO weeks (zeros included), not "last N weeks that had a logged run". Mixing those up stretches sparse history across years and misreads volume.
- **Calisthenics Skill Tracks XL anchor:** follow **`Sport Analytics.dc.html` §1b page layout** — paper `.sa-card` with stacked ladder rows (done = `--wi-calisthenics`, current = terracotta, future = dashed). **Do not** use the terracotta Widget Gallery XL hero shell (that variant is S/M/L catalog only, like badminton win-rate / running volume heroes).
- **Skill track step alignment:** ladder rows use `align-items: flex-start` on `.sa-cal-skill-track__ladder` / `__segment`; connector links get `margin-top: 16px` (half of 34px step height). `align-items: center` misaligns step pills when sub-labels differ in height.
- **Calisthenics Skill Tracks @720px:** swap to compact bar rows per §1b phone mock (`wi-mobile-only`); do not shrink the desktop ladder. Bars: done = `--wi-calisthenics`, current = terracotta, future = desk.
- **InstrumentHeader analytics nav:** chart icon (`AnalyticsIcon`) links to `/analytics/monthly`; sits after sport LENS links, before Workouts. Pass `analyticsHref` + `currentRoute` when on the monthly page.
- **Sport spine heatmaps:** new sport heatmap CSS should mirror `.sa-running-heatmap` (grid body, 22px paging buttons, 11px cells, 900px breakpoint) — calisthenics was aligned to running in the same pass.
- **Browser verify without a local display:** if a preinstalled Chromium path (e.g. `/opt/pw-browsers/chromium`) isn't available, install `playwright-core` standalone (`npm install playwright-core --no-save`, outside `ui/`) and point it at whatever Chromium/Chrome binary is available on the machine.
- **`milestoneProgress.ts`-style helpers:** progress/projection logic reads `milestone.progress` (`MilestoneProgress` in `challenge.ts`) — not a separate `tracking` schema. Projections extrapolate from `progress.history`.

## Sport Analytics — shared template

**Routes:** `/analytics/badminton` · `/analytics/running` · `/analytics/calisthenics`.

**Header nav:** `InstrumentHeader` renders sport analytics links from `DEFAULT_SPORT_ANALYTICS_LINKS` in `WarmInstrumentWidgets.tsx` — badminton (`kind="badminton"`), running (`kind="run"`), calisthenics (`kind="calisthenics"`). Override via optional `sportAnalyticsLinks`. Desktop only (nav hidden ≤720px, pre-existing).

**Architecture (from `Sport Analytics.dc.html`):** every sport page is **SPINE + LENS**. `SportSpine` takes a `sport` prop (`WarmSportId`) and filters `RecentSessionsCard` + sport-specific heatmap.

**SPINE (both pages):** `RecentSessionsCard` (sport-filtered) + activity heatmap (3-month window, stats: **SESSIONS · 52W**, **WEEKLY STREAK**, **BEST STREAK · ALL**).

**Styles:** `sport-analytics.css` extends `--wi-*` from `warm-instrument.css` — no new palette. Card labels use `.sa-card-label`.

**Curve smoothing:** shared `smoothPath()` in `sport-analytics/chartUtils.ts` — monotone cubic (Fritsch-Carlson). Required for jagged trend data; see also `reference-interactions-analysis.md`.

## Sport Analytics — Play LENS (badminton)

**Page:** `SportAnalyticsBadminton.tsx`.

**LENS** — `buildBadmintonLensModel()` in `badmintonLensModel.ts`. All figures from logged activities + `matchParser.ts`; insufficient sample → empty/opt-in state, never guessed numbers.

**Platform split (720px):** phone lens is glance-only — hero, head-to-head, am I improving. Session shape, best month, effort are `wi-desktop-only`.

**Key widgets:** Win Rate hero (XL anchor, terracotta, reuses `.wi-engine-card__*` + in-hero **8W/52W** ghost toggle), session shape (scrub + volume bars), H2H (3 rows, expand to 10), effort (stacked HR bar + single-line legend).

## Sport Analytics — Pace LENS (running)

**Page:** `SportAnalyticsRunning.tsx` · title **Road log** · sport chip **RUNNING** (`#a8702c` / `--wi-cycling`).

**LENS** — `buildRunningLensModel(activities, volumeScope)` in `runningLensModel.ts`. Filter: `getTrainingCategory` → `run`, `sport_type === "Run"`. Pace = `elapsed_time / (distance/1000)` when distance > 0.

**Platform split (720px):** glance-only — Weekly Volume hero, PBs, Coach's Read. Pace trend, effort, benchmark are `wi-desktop-only`.

**Key widgets:**
- **Weekly Volume** (XL anchor, amber hero shell — not terracotta) — this week's km vs 8-week calendar band; bar chart with shaded band; hover bar → week label + km + longest run; **8W/52W ghost toggle lives on the hero** (not page header)
- **Benchmark** (M) — repeat-route via title + 500 m distance bucket; mounts only if ≥2 runs match; down = faster
- **PBs** (L) — 1K/5K/10K/half within tolerance; next milestone row (21K) until half logged
- **Pace Trend** (L) — always **last 52W**; thin per-run + bold 4-week rolling; hover scrub; **no scope toggle**
- **Effort** (M) — HR zones when `hr_zones` exist (reuse `EffortCard`)
- **Coach's Read** (M) — rule-derived, `#f3eee3`, signed `— Coach`; skip if nothing to say

## Sport Analytics — Skill LENS (calisthenics)

**Page:** `SportAnalyticsCalisthenics.tsx` · title **Skills & strength** · chip **CALISTHENICS** (`#4f587a` / `--wi-calisthenics`).

**LENS** — `buildCalisthenicsLensModel(activities, challenge)` in `calisthenicsLensModel.ts`. Milestones from `challenge_v2.json`; calisthenics activities via `getTrainingCategory` → `calisthenics`. No fabricated numbers.

**Platform split (720px):** glance-only — Skill Tracks, Am I Improving, Consistency. Tested e1RM + Coach's Read are `wi-desktop-only`.

**Key widgets:**
- **Skill Tracks** (XL anchor, **paper card** per §1b) — three stacked ladders; hover any step → row-end projection label + math swaps live (`SkillTracksCard`); @720px compact bar rows (desktop ladder hidden)
- **Am I Improving** (L) — calisthenics benchmarks from challenge milestones + progress bars when `milestone.progress` exists
- **Tested e1RM** (L) — pull-up e1RM trend; empty/opt-in until `weighted_pullups` carries `progress.history`
- **Consistency** (L) — 12-week skill-session floor grid + streak from logged calisthenics activities
- **Coach's Read** (M) — rule-derived, coach tint, signed `— Coach`

## Monthly Analytics

**Page:** `MonthlyAnalytics.tsx` · route `/analytics/monthly`.

**Model:** `buildMonthlyAnalyticsModel()` in `monthly-analytics/monthlyAnalyticsModel.ts` — activities + `challenge_v2.json` only; no fabricated figures. VO₂ and sleep are opt-in empty states until real sources land.

**Layout:** year toggles → month overview grid → stepper → terracotta **Engine · month avg** hero + right rail (VO₂, sleep) → workout breakdown + side quests table. Side quest RATE = DONE ÷ (DONE + MISS), excused excluded.

**Styles:** `monthly-analytics.css` extends `--wi-*`; reuse `ActivityGlyph`, `sa-card-label`, `InstrumentHeader`.

**WorkoutTimer:**
- `workout-timer/` is the most complex component. It implements a state machine with states: `exercise`, `rest`, `prep`, `phase_transition`, `complete`
- **Critical pattern:** Always call `setTimer(-1)` before any `setState()` call to prevent race conditions between the timer init effect and the tick effect
- For detailed architecture, see `docs/timer-state-machine.md` or read the component top-to-bottom before making changes

## Workflow
1. Read the GitHub issue — it should be self-contained with full context
2. Create branch: `git checkout -b feat/<N>-description` or `fix/<N>-description`
3. Navigate to UI directory: `cd ui`
4. Start dev server: `npm run dev`
5. Implement changes
6. Verify: `npx tsc --noEmit` — no new TS errors in changed files
7. Test in browser at `localhost:3000`. If there's no interactive browser available (a remote/headless session), don't skip this step — verify with a real one instead of code review alone:
   - Install `playwright-core` standalone in a scratch directory (`npm install playwright-core --no-save`, outside `ui/`) and launch it against whatever Chromium/Chrome binary is available on the machine.
   - Screenshot at desktop and phone widths, and exercise the actual hover/click interactions you built (a static screenshot won't show a hover-only bug).
   - Check `getComputedStyle(el)` on anything font/color/motion-related rather than assuming your CSS applied — this is how the button font-specificity gotcha above was actually found, not by reading the CSS.
   - If you changed a shared component (`InstrumentHeader`, card shell, any atom reused across pages), smoke-test every page that renders it, not just the one you were working on — a shared-atom bug shows up everywhere at once.
8. Push and create PR: `gh pr create --base main --body "fixes <your-github-username>/<your-repo-name>#N"`
9. Tech Lead reviews → iterate → merge

## Conventions
See `.github/CONVENTIONS.md` for the full spec. Summary:
- Commit prefix: `ui:` for UI-only changes, `feat:` or `fix:` with issue ref for features/bugs
- Branch naming: `feat/<issue-N>-<brief>` or `fix/<issue-N>-<brief>`
- Always PR to main, never push directly
- PRs must reference the issue: `fixes #X`

## Escalation
- If you're stuck or unsure about an architectural decision, flag it in your thread — the Tech Lead will triage.
- If you discover a data pipeline issue, note it in the PR description for Tech Lead/Bob.

## Learnings (durable, UI-specific)

Reusable rules you discover about UI work — add a one-liner when it's worth the
next agent following (keep it tight; bloat makes agents worse). Decisions with tradeoffs
go to `kdb/decisions/` as an ADR instead. KB rules: see AGENTS.md.

- _(none yet)_
