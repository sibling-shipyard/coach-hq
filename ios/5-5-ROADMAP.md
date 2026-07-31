# Coach HQ iOS — 5/5 Roadmap

**Vision:** Transform the app from a dashboard you consult into a destination you *want*
to open. The target experience: finish a workout (or a sport), get notified by Coach,
open the app, feel celebrated, see what changed, and talk to Coach — all in under 2 minutes.

---

## P0 — High impact, low/medium effort. Ship these first.

### Post-Workout Payoff (WorkoutCompleteView)
- [x] Full-bleed accent background per workout type (Foundation blue, Calisthenics terracotta — not beige)
- [x] Cascade stagger reveal: sport icon bounces in → time trophy → three stat cards one at a time
- [x] Three-beat haptic pattern on appear (da-da-DUM) instead of single `.success()`
- [x] Coach note as a proper serif card (WarmCard + coachVoice font, large) not a bare quote
- [x] CTA routing: "Talk to Coach →" (primary) + "Back to Home" (secondary) — NOT back to workout list

### Animation & Feel (apply existing system more fully)
- [x] Home widget column: apply `staggerReveal` to each card (modifier already exists, unused here)
- [x] `HairlineProgress`: animate from `fraction: 0` on appear — every quest/calorie/progress bar in the app
- [x] Card press style: add spring scale (0.97) alongside existing opacity dim across all list cards

### Typography
- [ ] `WarmInstrument.coachVoice()`: switch to New York serif (`Font.system(.body, design: .serif)`) — one token change, touches every coach text: chat bubbles, coaching notes, coach's read, build phase

### Chrome Polish
- [x] Timer back button: `Text("←")` → `Image(systemName: "chevron.left")` with semibold weight
- [x] Dock start CTA: `Text("▶ Start workout")` → `Image(systemName: "play.fill")` + `Text("Start workout")`
- [x] WorkoutListView: add page header (title + date, matches CompactInstrumentHeader pattern from Home)
- [ ] Chat tab icon: unread dot badge when a new morning-read thread exists

---

## P1 — High impact, medium lift.

### HealthKit Auto-Sync + Notification Flow (non-timer sports)
- [x] Background HealthKit delivery: wake the app when a new workout is written to HK — even when closed
- [x] Auto-trigger sync on HK workout detection (user plays badminton, app knows without them opening it)
- [x] Push notification: "Session logged — Coach is reviewing your workout"
- [x] Notification tap: deep link into Coach Chat via navigateToChat notification
- [ ] Home "session synced" banner: brief pill strip that auto-dismisses after sync completes

### First-Time Onboarding / Coach Introduction
- [ ] Welcome screen: Coach's voice intro — who they are, what this app does, what to expect
- [ ] "What sports are you training for?" multi-select (seeds commitment strip)
- [ ] "What's your main goal this season?" (seeds the quest with real context)
- [ ] HealthKit permission prompt with a human explanation (not system boilerplate)
- [ ] GitHub repo connection framed as "linking your training log" not a dev tool
- [x] First Coach Chat open: a waiting message — "I'm Coach Phelps. Tell me what you're working toward."
- [ ] First Engine widget: annotated overlay explaining what the number means ("This is your weekly load")
- [ ] First morning read: special "letter" format, not just a message bubble

### Home — Living Dashboard
- [x] Personalized time-of-day greeting ("Good morning, [name]" / "Rest day — recover well")
- [x] Today's scheduled workout shown in header: tap → WorkoutOverview inline
- [x] Skeleton shimmer loading: cards matching actual widget layout instead of centered ProgressView
- [ ] All progress bars: animate from 0 on first data load across Engine, Quest, Calories

### Coach Chat Feel
- [x] Contextual composer placeholder: "How did that feel?" post-workout / "What's on your mind?" default
- [x] Quick-react chips on new/empty thread: "How's my week looking?" / "Felt strong today" / "Struggling lately"
- [ ] Post-workout auto-chips: pre-seeded chip row after a completed workout or HK sync
- [x] Coach bubble: slightly elevated cream card feel vs. plain text on background

### Workout Tab
- [x] "Today" hero section at top: today's assigned workout prominent, clear Start button
- [x] Visual separation: "TODAY'S PLAN" vs "AVAILABLE WORKOUTS" sections

### Navbar Rethink
- [x] Add labels below tab icons (standard iOS pattern — removes ambiguity for new users)
- [x] Or: stronger selected state — larger filled icon + brief label on first tap (tooltip style)
- [ ] Context-aware CTA: dock adapts based on current surface (not just start-workout)
- [ ] Chat tab unread treatment: dot badge, not number

---

## P2 — Nice to have, longer term.

### Onboarding Depth
- [ ] Week-1 "getting to know you" prompts from Coach via Chat (3–4 days after setup)
- [ ] "Your first week summary" — synthesized Coach recap after 7 days
- [ ] Skip/come back later option on all onboarding steps (never block)

### Delight Moments
- [ ] Confetti or particle burst on milestone completions (quest complete, new personal best)
- [ ] Engine number: count up from previous value on data refresh (not just snap to new value)
- [ ] Weekly plan chip drag: live position shadow and snap animation during reorder
- [ ] Activity detail: stats count up from 0 on push transition

### Platform Expansion
- [ ] Dark mode audit: sweep static `Color(red:)` values without dark-adaptive variants
- [ ] Push notifications: morning read delivered at a user-configured time
- [ ] Live Activities: workout timer state on Lock Screen and Dynamic Island
- [ ] Siri Shortcuts: "Start Foundation workout" / "What's my engine load?"

### Settings → Profile
- [ ] Settings tab becomes a personal profile: current block, sport commitments, Coach context
- [ ] "About Your Coach" section with Phelps background
- [ ] Configurable: morning read time, notification preferences, dark mode toggle

### Performance
- [ ] Instruments scroll profiling on Home (LazyVStack with many widgets)
- [ ] Pre-fetch widget snapshots on app foreground to reduce time-to-data on open
- [ ] Reduce sync wait: optimistic UI while sync is in-flight

---

## Principles

- **Low effort + high visual win = P0.** Don't wait for the perfect version.
- **Every animation should use `PremiumMotion` presets.** No ad-hoc durations.
- **The post-workout arc is the product.** Finish sport → notification → app → Coach. Design every screen around this loop.
- **Coach's words deserve the best typography.** The coachVoice font is the soul of the brand.
- **Onboarding sets expectations.** The magic of the first few weeks should be designed, not accidental.
