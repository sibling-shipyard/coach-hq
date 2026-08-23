# Warm Instrument — Widget Design Philosophy & Interaction Spec

For the implementing agent. Pairs with the live demos in `Widget Interactions.dc.html` (stations 00–11) and the size variants in `Widget Gallery.dc.html`.

---

## The system in one paragraph

Warm Instrument treats training data like a well-loved analog instrument panel: warm paper surfaces (#fbf8f1 on #e8e2d7), one terracotta accent (#7f3728) reserved for the thing that matters most (load), monospace figures (Space Mono) for anything counted, and an italic serif (Newsreader) for the coach's human voice. Numbers are never decoration — every figure is earned from logged sessions. The feeling we want: *a calm, competent coach's desk*, not a gamified dashboard. The athlete should feel watched over, not surveilled; informed, not judged.

## Global interaction principles (v1 — final)

1. **Hover reveals, tap usually does nothing.** Cards are read-only glances unless they are one of the named exceptions below. All hover affordances (scrubs, tooltips) are web-only enrichments; iOS gets the same visual state without them. Do not infer new tap targets from the proactive Coach exception.
2. **The exceptions are deliberate:** the Home-only proactive Coach message deep-links to its exact local chat seed, long-press → jiggle/size-swap (iOS home), drag plan chips between days, swipe session row → Edit (never Delete — deletion lives in session detail only), heatmap month paging arrows.
3. **Data states are always live.** A widget never shows placeholder numbers; with no data it collapses to its opt-in/empty state.
4. **One alarm color.** The cold indigo-grey (#e4e4ec / #4b5578) flood is the only "something's wrong" treatment. It should feel like a cold barbell, not a red alert. Never stack alarms.
5. **Motion is physical and brief.** Lifts of 3–4px on hover, 150–250ms ease, jiggle at ±1.4°. Nothing loops for attention.

---

## Widget-by-widget

### 00/01 · Engine (hero + card)
- **Meaning:** the athlete's weekly load vs their own 8-week rhythm band (447–671). Not a score to maximize — a band to *stay inside*. "549 — in the band" should read like a steady heartbeat.
- **Feeling:** pride without pressure. The terracotta panel is the one warm, glowing thing on the page — the engine is literally warm.
- **Interaction:** hover-scrub the 6-week trend for per-week values (web). Box plot, badge, sport split: read-only.
- **Reuse:** web hero (820px, full math footer) → web/app card M (trend only) → iOS home widget S (number + band strip only). The number and the italic verdict survive every size; the first things dropped are axis labels, then the box plot.

### 02 · Sport commitment cubes
- **Meaning:** one cube per promise (badminton, calisthenics, cycling, foundation). The `1/2` denominator is the week's floor. The hairline progress underline is deliberately quiet — commitments are kept, not celebrated.
- **Feeling:** a row of kept promises. The alarm cube ("The bar is cold.") should sting gently — disappointment in the athlete's own voice, not the app's.
- **Interaction:** none in v1. Static glances.
- **Reuse:** identical cube anatomy at every scale: icon top-left, count top-right, underline + caption bottom. Web quartet row = 4 cubes; iOS home S = single sport; M = quartet strip. The cube is the atom — never redesign it per platform.

### 03 · Widget editing (jiggle)
- **Meaning:** the home surface belongs to the athlete.
- **Interaction:** long-press (~550ms) → jiggle + S/M/L picker → Done. Swap in place, never reflow other widgets mid-edit. *Proposed:* light haptic tick on jiggle-enter and size change.
- **Reuse:** jiggle is iOS-home native; web uses an edit-mode drag from the gallery instead. Same S/M/L size grammar everywhere (S 2×2, M 4×2, L 4×4).

### 04 · Weekly plan
- **Meaning:** the coach's draft week, held with a dashed border because it is *provisional* — nothing here has been earned yet. Projected load (`≈640 — upper band`) is the plan's consequence, always visible.
- **Feeling:** a pencil sketch on the desk, movable and negotiable.
- **Interaction:** drag a sport chip between days (web drag / iOS long-press-drag); empty days accept, occupied days swap; projection recomputes instantly and turns terracotta when it leaves the band. *Proposed:* tap COACH DRAFT chip → accept/edit; haptic on chip drop.
- **Reuse:** M = icon chip row; L = list with per-day loads; iOS S = "Next up" single session. The chip (sport icon in sport color on 10% tint) is shared with the heatmap legend and cubes.

### 05 · Recent sessions
- **Meaning:** the ledger. "Every entry earns its load — nothing invented." Rows are receipts, not feed items.
- **Interaction:** swipe left → **Edit only** (72px, amber, 14px gap from content). Delete is intentionally absent from Home. Web shows no swipe; rows are static in v1.
- **Reuse:** the row (date · sport tick · title · +load) is one component everywhere; platforms only change row count and density.

### 06 · Training activity heatmap
- **Meaning:** consistency made visible — sport-colored days, not intensity gradients, because *showing up* is the metric. Gaps are information ("gaps follow big match days"), not shame.
- **Interaction:** hover a cell → day tooltip (sport + load). ‹ › arrows page the month window back through the block. Cells don't deep-link in v1.
- **Reuse:** web L = 4-month spread + stats; app/iOS M = single month + legend. Cell size may shrink; the sport-color language may not.

### 07 · Monthly calories
- **Meaning:** a pace, not a quota. The black tick is "where the month is"; the terracotta fill is "where you are." `558/DAY NEEDED` converts the gap into one actionable number.
- **Interaction:** hover the bar → the on-pace math in words. No tap.
- **Reuse:** the bar+tick is the whole widget; S drops the footer, L adds daily bars. Same on all platforms.

### 08 · Main & side quests
- **Meaning:** direction, not gamification. The main quest is the coach's single priority this block; side quests are the athlete's own (books, visualization). Deliberately no XP, no streᴀk-guilt — quiet bars.
- **Interaction:** none in v1. Progress renders from logged sessions only; logging lives in the quest pages.
- **Reuse:** main quest survives to iOS S (title + fraction + bar); side quests appear only at M+.

### 09 · VO2 max
- **Meaning:** the long game — proof the boring easy volume works. The percentile badge situates without competing (top 15%, age 30–39).
- **Interaction:** hover-scrub the 12-month trend for per-month values. Badge and card: read-only.
- **Reuse:** number + ▲ delta survive to S; trend at M; percentile context at M+.

### 10 · Coach's read
- **Meaning:** the human voice of the system — the only widget in italic serif throughout, on the flat paper tint (#f3eee3), signed. It interprets the day's numbers so no other widget has to editorialize.
- **Interaction:** none in v1. The thread lives in the coach tab.
- **Reuse:** never truncate mid-sentence; at small sizes show fewer sentences, always signed.

### Proactive Coach message · Home delivery card
- **Meaning:** the durable post-session note, shown before the dashboard so the athlete sees Coach's read before the numbers.
- **Interaction:** the entire card is one accessible link to the message's `conversation_seed_id` in Coach Chat. This is the explicit deep-link exception; it does not make other widgets tappable.
- **Reuse:** render the snapshot body exactly and never truncate it mid-sentence. Missing or invalid message data removes the card without replacing it with an empty state.

### 11 · Build phase
- **Meaning:** where the athlete is in the block, and what lands *if the plan holds*. Milestone dates are honest projections — "every missed bar day slides them right" is the widget's whole ethic.
- **Interaction:** hover a milestone row → its projection math (assumptions + last test). No taps; dates recompute automatically after every logged session.
- **Reuse:** the phase track (build/deload/build/test) is the identity at every size; milestones appear at M+, math tooltips are web-only.

---

## Platform mapping

| Surface | What it is | Interaction budget |
|---|---|---|
| **Web app (HQ)** | full dashboard, all widgets at M/L | hover scrubs + tooltips, drag chips, edit-mode drag from gallery |
| **iOS app (Home)** | scrolling column of M widgets | long-press jiggle + S/M/L, chip drag, swipe→Edit, month paging |
| **iOS home screen widgets** | S/M/L WidgetKit snapshots | glance-only: no scrubs, no tooltips; long-press uses the native widget editor; every widget must be legible with zero interaction |

**Shared atoms** (build once, reuse everywhere): sport icon set (shuttlecock / parallettes / sun-salutation / bicycle) with fixed sport colors (BDM --wi-badminton · CAL --wi-calisthenics · FDN --wi-foundation · RIDE --wi-cycling; from `shared/warm-instrument/tokens.json`), the mono-label style (9–11px Space Mono, .1em+ tracking), the session row, the sport chip, the hairline progress underline, and the card shell (26px radius, 1px warm border, soft 8/20 shadow).

**Type + palette:** Space Grotesk (UI), Space Mono (figures/labels), Newsreader italic (voice). Paper #fbf8f1, desk #e8e2d7, ink #2b2d29, accent #7f3728, alarm #e4e4ec/#4b5578.
