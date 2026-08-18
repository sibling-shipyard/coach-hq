# Coach HQ iOS — Design Roadmap

Reference: [coach-phelps.netlify.app](https://coach-phelps.netlify.app) (specifically the `/v2` Warm Instrument surface — the legacy neo-brutalist `Home.tsx` is not the target anymore)
**Philosophy: This is not a fitness tracker. It is a personal coaching dashboard — every screen should deliver insights that drive action and bring out the best in the athlete.**

---

## Design Language — Warm Instrument

The website moved to **Warm Instrument** (canonical spec: `ui/docs/reference-interactions/Widget Design Philosophy.md`) — warm paper surfaces, one terracotta accent reserved for load, monospace figures, an italic serif for the coach's voice. This table replaces the old neo-brutalist token mapping.

| Token | Warm Instrument (web) | iOS target |
|---|---|---|
| Border radius | 26px card shell | 16–20pt cards (scale the same shell, don't reinvent it) |
| Borders | 1px warm border (`rgba(84,76,65,.16)`) + soft shadow (~0 10–20px, low alpha) | 1pt adaptive `Theme.cardBorder` + subtle shadow — drop the old flat/no-shadow neo-brutalist look |
| Palette | Paper `#fbf8f1` / desk `#e8e2d7` / ink `#2b2d29` / terracotta `#7f3728` (load only) / alarm `#e4e4ec`/`#4b5578` | Same hex values via `Theme.swift` tokens — terracotta stays reserved for load, never a generic accent |
| Typography — UI | Space Grotesk | SF Pro (unchanged — no equivalent geometric sans needed on iOS) |
| Typography — figures | Space Mono | SF Mono / `.design(.monospaced)` (unchanged) |
| Typography — coach voice | Newsreader italic | **Open decision:** bundle Newsreader or use a system serif italic (e.g. New York italic) for coach-voice text (mental state notes, coaching insights copy). Not yet decided — flag in the Phase 5 PR if this needs a call. |
| Metrics | Bold, tight letter-spacing, monospaced digits | `.monospacedDigit()`, bold — unchanged |
| Sport colors | Hex per sport (BDM `#315a4a` / CAL `#4f587a` / FDN `#6d7d4e` / RIDE `#a8702c`) | Already matched in `Theme.swift` — no change needed |
| HR zone colors | Z1 blue → Z2 green → Z3 yellow → Z4 orange → Z5 red | `Theme.hrZoneColors` (5-element array) — unchanged |

**The Premium UX Principles below (motion, haptics, press feedback) are compatible with Warm Instrument and are not being replaced** — they're the "how it moves" layer; the table above is the "what it looks like" layer. Warm Instrument's own motion guidance (3–4px lifts, 150–250ms ease, jiggle ±1.4° on long-press) is a subset of what's already specified here.

---

## Premium UX Principles

These apply to every screen. Every interaction should feel intentional and alive.

### Motion
- **Springs everywhere** — `spring(duration: 0.4, bounce: 0.2)` for state changes, `spring(duration: 0.2, bounce: 0)` for instant feedback (press states).
- **Staggered reveals** — zone bars and stat rows animate in with small cascading delays (≤60ms per item).
- **Numeric transitions** — any count or stat that can change uses `.contentTransition(.numericText())` so numbers roll rather than cut.
- **Zone bar entrance** — animate from zero width on scroll-into-view; reset on `.onDisappear` so it replays.
- **No over-animation** — hero moments only. Decorative items don't bounce; data items do.

### Press & Tap Feedback
- **Row press** — `RowPressButtonStyle`: background flashes to `Theme.mutedBackground`. Instant on/off. No scale (avoids edge clipping).
- **Card press** — `CardPressButtonStyle`: opacity 0.82 on press.
- **Haptics** — `.light` impact on navigation taps, `.success`/`.error` on sync outcomes. Never silent for meaningful events.

### Typography hierarchy (as built)

| Class | Size | Weight | Usage |
|---|---|---|---|
| hero-name | 22pt | bold | Activity name in detail view |
| hero-stat | 19pt | bold, monospaced | Primary stat columns (cal, HR, peak) |
| banner-stat | 26–28pt | black, monospaced | Week summary banner numbers |
| metric-md | 16pt | bold, monospaced | Row right-side stat (calories) |
| body | 14–15pt | semibold | Activity name in list rows |
| meta | 11pt | regular | Time, date, secondary info |
| label | 8–10pt | bold, kerning 1–2 | Uppercase section headers |

**Coach voice — resolved.** Newsreader vs. system serif was an open question here; the answer is
**system serif italic** (`.system(design: .serif).italic()`) for Warm Instrument Home — no bundled
font asset. Reopen only if the team decides shipping Newsreader is worth the bundle.

### Sport icons (SF Symbols)
Mapped in `Theme.sportIcon(for:)`:
- Badminton → `figure.badminton`
- Weights/Foundation → `dumbbell.fill`
- Ride → `figure.outdoor.cycle`
- Run → `figure.run`
- Other → `figure.mixed.cardio`

### Layout & Breathing Room
- **Circular sport icon** — 40×40pt, sport color tint background (opacity 0.1), sport color icon
- **Color bars** — 5pt wide, flush to card/row left edge, no padding
- **Zone bar** — `CompactZoneBar`: proportional 5-segment bar, `ClipShape(Capsule())` by default; `rounded: false` for flush-to-card-bottom usage
- **Zone dots** — `ZoneDots`: 5 × 6pt circles, full opacity if ≥8% time in zone, 18% opacity otherwise
- **Dividers** — inset to start after icon/bar elements

### Dark mode
- Every color uses adaptive tokens (`Theme.cardBackground`, `Theme.cardBorder`, `Theme.ink`). Never hardcode `.white` or `.black`.
- `Theme.cornerRadius` / `Theme.cardBackground` / `Theme.cardBorder` / `Theme.ink` are **shared app-wide** — retinting them changes every screen's card look, not just the new one. That is the cheap, low-risk way to roll a palette change across the whole app without touching each view file; it is also why an "only my screen" tweak must not go there.

---

## Activity Feed — Chosen Direction ✅

**Variant 1** is the selected layout (stored in `@AppStorage("feedVariant")`, default 0).

- Top: `WeekSummaryWidget` card — sessions · active time · days/7 + 7 sport-colored day dots
- Feed: day-grouped with sticky `DayGroupHeader`, each row uses `IconRow`:
  - 40pt circular sport icon (SF Symbol in sport color)
  - Activity name (14pt semibold) + time + `ZoneDots` (if HR data available)
  - Calories right-aligned (16pt bold monospace); falls back to duration if cal not backfilled
- Variant picker (1/2/3) in `BrandHeader` trailing — keep for A/B testing until fully decided

**Variants 2 and 3** remain in `ActivityFeedVariants.swift` for reference.

---

## Phases — Status

### ✅ Phase 1 — Activity Feed Polish
- Day-grouped feed with sticky headers
- Circular sport icon rows with zone dots + calorie stat
- WeekSummaryWidget (stats + dot strip)
- 3 feed variants built; Variant 1 chosen

### ✅ Phase 2 — Activity Detail Upgrade
- Hero stats card: 3pt sport color stripe, 22pt bold name, 19pt monospace stat columns
- HR zone breakdown: animated fill bars with staggered entrance (8pt height)
- Mental state chip (PRE score + word, color-coded green/orange/red)

### ✅ Phase 3 — Sync Tab Chart
- `WeeklyVolumeChart`: 7-day sport-colored bar chart in Sync tab

### ✅ Phase 4 — Training Heatmap
- `TrainingHeatmapView`: 8-week Mon–Sun grid, sport-colored cells, tap → `DayDetailSheet`
- Embedded at bottom of Activity feed (Variant 1)

---

## Phase 5 — Coaching Insights Dashboard 🔜 next priority

**File:** new `CoachingInsightsView.swift`  
**Tab:** new tab in `MainTabView.swift` (icon: `brain.head.profile` or `chart.xyaxis.line`)

This is the sports-scientist screen. Not "your stats" — "here's what your data is telling you."  
Each widget is a self-contained SwiftUI view taking `entries: [SyncCacheEntry]`.

**These are the first Warm Instrument widgets on iOS** — style them per the token table above, and give each one the interaction budget the Design Philosophy expects for "iOS app (Home)" (tap → detail/drill-down for anything with a trend or history), not a static re-skinned card. Reuse the card shell, sport colors, and monospace-figure convention rather than inventing per-widget styling.

### Widget backlog (build 6–8 of these, pick the best)

| Widget | Data needed | Insight delivered |
|---|---|---|
| **Training Load** | `elapsedTime` last 7d vs prev 7d | Are you doing more or less? Trend arrow |
| **Zone Distribution Ring** | `hrZones` all recent sessions | Aerobic base (Z1/Z2) vs intensity (Z3-5) balance |
| **Badminton Form Strip** | `hasDescription`, parsed scores | Last 5 match results as W/L dots + trend |
| **Streak & Consistency** | `startDateLocal` | Current consecutive days, longest this month |
| **Sport Balance** | `sportType` counts | % split across sports (last 30 days) |
| **Weekly Calorie Burn** | `calories` sum | Rolling 7-day total vs rough target |
| **Training Heatmap** | all entries | Reuse `TrainingHeatmapView` directly |
| **Intensity Trend** | avg `averageHeartrate` per session | Is effort going up or down week-over-week? |
| **Next Milestone** | session count | "3 more sessions to hit your monthly target" |

### Design rules for widgets
- Each widget uses `ThemedCard` wrapper
- Section header: `SectionHeader("WIDGET NAME")` from Theme
- Numbers use `contentTransition(.numericText())`
- Animate on appear (spring reveals, staggered where applicable)
- Empty state: muted placeholder, never crash on nil data
- Data source: `SyncCache.load()` — no new network calls in widgets (use cached `entry.activity` where available)
- Color: snapshot JSON items that carry their own hex `color` (`LoadMixSnapshot`, `QuestSideSnapshot`) **must use it** — never re-derive from a table. `WarmInstrument.sportColors` is the palette only for snapshot types that carry just a `sport` id (`RecentSessionSnapshot`, `DoseRowSnapshot`, heatmap cells)

---

## Out of scope (for now)
- Quest/side-quest tracking (needs schema work)
- Map view (GPS data not in HealthKit sync)
- Strava deep-links on iOS
- Apple Watch companion (separate WatchKit target — future)
