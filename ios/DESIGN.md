# Coach HQ iOS — Design Roadmap

Reference: [coach-phelps.netlify.app](https://coach-phelps.netlify.app) (specifically the `/v2` Warm Instrument surface — the legacy neo-brutalist `Home.tsx` is not the target anymore)
**Philosophy: This is not a fitness tracker. It is a personal coaching dashboard — every screen should deliver insights that drive action and bring out the best in the athlete.**

---

## Design Language — Warm Instrument

The website moved to **Warm Instrument** (canonical spec: `ui/docs/reference-interactions/Widget Design Philosophy.md`) — warm paper surfaces, one terracotta accent for load and primary action (ADR 0041), monospace figures, an italic serif for the coach's voice. This table replaces the old neo-brutalist token mapping.

| Token | Warm Instrument (web) | iOS target |
|---|---|---|
| Border radius | 26px card shell | 16–20pt cards (scale the same shell, don't reinvent it) |
| Borders | 1px warm border (`rgba(84,76,65,.16)`) + soft shadow (~0 10–20px, low alpha) | 1pt adaptive `Theme.cardBorder` + subtle shadow — drop the old flat/no-shadow neo-brutalist look |
| Palette | Paper `#fbf8f1` / desk `#e8e2d7` / ink `#2b2d29` / terracotta `#7f3728` (load + primary action, ADR 0041) / alarm `#e4e4ec`/`#4b5578` | Same hex values via `Theme.swift` tokens — terracotta stays reserved for load and primary action, never decorative or a status color |
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
- **Dividers** — inset to start after icon/bar elements

### Dark mode
- Every color uses adaptive tokens (`Theme.cardBackground`, `Theme.cardBorder`, `Theme.ink`). Never hardcode `.white` or `.black`.
- `Theme.cornerRadius` / `Theme.cardBackground` / `Theme.cardBorder` / `Theme.ink` are **shared app-wide** — retinting them changes every screen's card look, not just the new one. That is the cheap, low-risk way to roll a palette change across the whole app without touching each view file; it is also why an "only my screen" tweak must not go there.

---

## All Activity — Paper ledger

Home → All Activity is `AllActivitiesListView` hosting `ActivityLedgerView`: week groups, one pulled paper card, load sheet, tap → `ActivityDetailView`.

Coach chat's SESSION SYNCED slot embeds the same stack (`ActivityLedgerStyle.embed`) — compact metrics, kicker only, no title or load sheet. Home recent sessions stay on `RecentSessionsCard` / `SessionRow`.

Do not put `matchedTransitionSource` on stacked (negative-margin) cards — it merges the next slip into the pulled card.

Page riffle is UIKit-only. A custom recognizer on the All Activity `UIScrollView` shows a press (opacity 0.82, 2pt lift) after 80ms still, then arms at 180ms with 12pt slop. The armed card lifts 10pt; `.light` on arm, `.selection` on each new card; release pulls it. A flick still scrolls because the recognizer fails if the finger moves first. Embed does not riffle. Do not put a SwiftUI long-press plus drag on the stacked cards — that stole `ScrollView`.

---

## Wait language

Two waits, ink on desk, never terracotta (ADR 0041). Reduce Motion freezes both.

| Kind | Component | Use |
|---|---|---|
| Page | `WarmWaveLoader` | Stamp-sized wave on empty first paint: Home, Chat, Train, Ledger, Health Data |
| Inline | `WarmSignalLoader` | Busy control: save, load more, sync, import, sign in |
| Chat reply | thinking bubble + Signal | Keep cycling copy; Signal replaces the three dots |

Leave: pull-to-refresh, WidgetKit `.redacted`, onboarding `.skeleton()` (reveal, not wait).

Page Wave sits **screen-centered on the desk** (full-bleed overlay, never a `ScrollView` child) and stays up for **one hop** (~1.3s) even when cache is already warm, then eases out (~220ms). Pull-to-refresh, background `showSpinner: false`, and Signal (`WarmSignalLoader`, busy `WarmPrimary`) are not held.

## Buttons

One primary, one secondary. Signal in a fixed slot beside the label; the pair is centred. Never overlay a spinner on the words.

| Kind | Component | Use |
|---|---|---|
| Primary | `WarmPrimary` | Terracotta load/save (`fill` default). Ink fill for GitHub / setup. Compact capsule for Import. |
| Secondary | `WarmSecondary` | Paper, 54pt, hairline border |

Chip and empty stay for a later kit pass. Don't add a per-screen `ButtonStyle` for the same job.

## Tab chrome

Tab roots share `WarmPageHeader`: small mono wordmark left (`TRAIN` / `HOME` / `COACH` / `YOU`), quiet meta right, desk behind. No UIKit nav bar and no circular chips. Pushes use `‹` then the wordmark (same mono as Ledger's `‹ HQ`), never a paper circle.

The floating dock is the same four words (`HOME` `COACH` `TRAIN` `YOU`): paper capsule, ink fill hugging the selected word, no icons.

## Train

Day Card + Week Strip L + library. Day Card is the day's focused session (receipt, rest, protocol draft, match draft). Cubes are equal-width; ticks stack; logged / today / draft / rest strokes follow the four cube states. Pointer under today, ring 2pt outside any other selected day. Week header is `WK N` plus the chevron — no strip total, no band verdict. Load lives on the cube (day) and once on the Day Card footer (session). Duration uses `Format.duration` (`2h 47m`). Receipt footer is TIME · LOAD · KCAL under a hairline. No sport glyph on the Day Card. Pill row is one short-name chip per session — including a single activity (`KICKSTART`, `WT #163`); the focused chip is ink-filled. Rest keeps the empty 22pt slot so height does not jump.

Haptics: `.light` on cube select and pill swap. `.medium` on Day Card START. Silent chevron and swipe settle. Today's draft shows ink **START** (no clock) beside **DETAIL**, both `monoLabel(9)` tracked caps in the 36pt footer. Coach line is two italic lines, capped at `TrainLayout.maxCoachNoteChars` (80), signed `— PHELPS`. Cube select remounts the Day Card with a ≤180ms spring slide on the card only.

Terracotta is load figures and WarmPrimary only. Draft load is `—` until a real projected number exists. HR ribbon uses a stored stream, or the slot stays empty. The today cube is how you get back — no `TODAY ›` on other Day Cards.

## Engine

Home tile still lives in `EngineCard`. This is the **push**: `WarmPageHeader` (`‹` + `ENGINE` + `WK 38`) → terracotta load hero → `LEDGER`. Desk behind; tab bar hidden. Edge-swipe pops. Coach voice stays on Home and Train — Engine has no receipt and no REPLY.

LEDGER is the full ISO week from hist, not the snapshot's last-five `doseRows`. While hist is loading, the card shows inline Signal — never `0 SESSIONS` or the sliced fallback. Plot draws the band rect on all six weeks; this week also gets the 1px edge and a dashed cap to projected Sunday load when that figure exists. `HOW IT'S COUNTED` reuses `HowLoadIsCountedSheet` from Activity Ledger. Per-week plot bands are a snapshot gap (ADR 0005 trend is load-only) — do not fake them.

Hero is the only terracotta fill. Verdict is `Absorb.` / `In rhythm.` / `Ease off.` from load vs band. Six load bars on a 300–950 plot; this week's band rect only. No sport colour on the hero, no "ABOVE BAND" badge, no formula in the card.

Dose is one paper card, Mon→Sun groups, ink `+N`. Empty is the dashed "Nothing logged yet" shell, section `0 SESSIONS`. Omit HR, dashed cap, and `+N% VS 8W AGO` when those snapshot fields are missing.

Haptics: `.light` on back and sheet open; `.soft` on sheet close. Silent scroll and draw-in.

Craft of other live screens (care, not a ledger clone) is `docs/plans/ios-craft-pass.md`. Audit detail: `docs/plans/ios-craft-pass-lld.md`. Delete both on the last PR of #1159.

---

## Phases — Status

### ✅ Phase 1 — Activity Feed Polish
- All Activity is the paper ledger stack (`ActivityLedgerView`)
- Old day-grouped `ActivityFeedView` / `WeekSummaryWidget` / `ActivityLedgerRow` removed
- Coach chat SESSION SYNCED uses the same cards (`.embed`)

### ✅ Phase 2 — Activity Detail Upgrade
- Hero stats card: 3pt sport color stripe, 22pt bold name, 19pt monospace stat columns
- HR zone breakdown: animated fill bars with staggered entrance (8pt height)
- Mental state chip (PRE score + word, color-coded green/orange/red)

### ✅ Phase 3 — Sync Tab Chart
- `WeeklyVolumeChart`: 7-day sport-colored bar chart in Sync tab

### ⛔ Phase 4 — Training Heatmap (removed)
- `TrainingHeatmapView` was built but never wired into the app; deleted as dead code along with
  the abandoned Phase 5 screen below (#928)

---

## Phase 5 — Coaching Insights Dashboard (dropped)

`CoachingInsightsView.swift` was built but never wired into `MainTabView`, then marked DEPRECATED
and deleted as dead code. Every live Home widget now lives in `Views/Widgets/`, one file each
(ADR 0037), so a future dashboard reuses those instead of forking new copies (#928).

---

## Out of scope (for now)
- Quest/side-quest tracking (needs schema work)
- Map view (GPS data not in HealthKit sync)
- Strava deep-links on iOS
- Apple Watch companion (separate WatchKit target — future)
- **CI check for stray `Color(red:` outside `Theme.swift`, `WarmInstrumentTokens.generated.swift`,
  and `WorkoutTimerWarm.swift`** (that trio holds every legitimate color literal as of #928's W4).
  Without it, this decays the way `SportChip`'s "never redesign this per surface" comment did.
- **Sport → icon/colour lookup spans 3 keyspaces** (raw HealthKit strings, `WarmSportId`,
  `ActivityGlyphKind`) across `Theme.sportIcon`/`sportBadge`, `WarmInstrument.sportColor`/
  `sfSymbol`, and `OnboardingRevealFlow.sportDisplayInfo`. Picking one canonical keyspace is a
  design decision, not a mechanical fold (#928's W4).
- **`SessionRow` (`Views/Widgets/RecentSessionsCard.swift`) vs. `ActivityLedgerCard`**
  are still two rendering paths. Folding Home recent sessions onto the paper card needs
  the sport-keyspace decision above first (#928's W5).
- **`SportChip` (`WarmInstrumentAtoms.swift`) has zero call sites.** `WeeklyPlanCard.daySlot`
  redraws its icon-on-tint square inline instead, because `SportChip` is a fixed `size × size`
  square with no stretch-width mode or overridable corner radius — what `daySlot`'s 7-equal-
  column layout needs (#928's W3b).
- **`ActivityDetailView`'s `heroCard`/`ribbonCard`/`usualCard`/`richScoreCard`** stay as
  computed properties, not separate view-model-backed types. Two own animation state
  (`statsRevealed`/`statsProgress`, `hrStream`) with no established pattern yet for how much of
  that moves with an extracted view (#928's W5).
- **No code repainted off terracotta** — ADR 0041 rewrites the rule (load + primary action, not
  load-only); the 14 files already using it that way are unaffected. Repainting is a separate
  design pass nobody has asked for.
