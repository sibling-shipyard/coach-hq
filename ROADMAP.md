# Coach Phelps — Roadmap

Structure: **Epic → Task** (two levels). Epics are GitHub issues with linked sub-issues and live progress bars; they span workstreams — the stream stays a label on each task.

This file is the curated view; issues are the record. Flip a box here or tell Uno — it regenerates from issues, never drifts.

**Priority:** P0 unblocks Nats · P1 unblocks 10 users · P2 good to have (incl. M4)

## 🎯 Now — M2: Onboard Nats

### 🟥 Epic: Chat reliability — THE GATE (#295)

- [ ] #296 MVP chat commit works
- [ ] #297 Gemini end-to-end in coach chat — web + iOS (checklist: #280)
	a. #424 validate-soul can't fail CI — Skanda
- [x] #298 First-session protocol

### 🟥 Epic: Onboard Nats (#299)

- [ ] #300 Remove sleep analytics (simplify onboarding)
- [ ] #301 Remove PRE
- [ ] #358 Carve ships no SOUL — a fresh repo cannot run BYOB

_Supporting:_ #292 bob sync baseline

## 🔜 Next — M3: Scale to 10

### Epic: New-user magic (#302)
_Users 4–10 get a great first hour._

- [ ] #303 Review: setup flow becomes a beautiful journey
- [ ] #304 Empty activity history handling
- [ ] #305 Coach uses 1-year history patterns in FSP
- [ ] #306 Coach chat works perfectly for FSP
- [x] #362 First-session predicate can never complete

### Epic: Homescreen UX (#307)

- [ ] #308 iOS bug batch: couldn't-load-home error, navbar moves lower
- [ ] #309 Redesign home page
- [ ] #310 Webapp: better SVG activity icons
- [ ] #311 Webapp: reuse color system from iOS
- [ ] #312 Webapp bug batch: items from Skanda's WhatsApp list

### Epic: Sport-agnostic core (#313)
_Any athlete, not just Akash's sports._

- [ ] #314 Generalize home widgets beyond current sports
- [ ] #315 Badminton + calisthenics analytics
- [ ] #316 challenge_v2 seasons/phases + quest_history (refs #86)
- [ ] #156 healthkit-enrichment
- [ ] #365 Workout templates aren't generic — Coach can't personalise them
- [ ] #367 Audit the quest/gamification system end to end

### Epic: Coach depth (#317)
_The coach feels wise, not generic._

- [ ] #357 SOUL v5.8 trim (509 → ~232 app / ~289 BYOB)
- [ ] #318 SOUL split (post-trim)
- [ ] #359 App silently drops archive writes
- [ ] #360 What does an ordinary turn need in context?
- [ ] #319 Coach patterns per user
- [ ] #320 Coach comment widget powered properly
- [ ] #321 Narrative to 5/5: first-week experience, strength benchmark
- [ ] #322 Coach memory: shrink coach-notes
- [ ] #323 Chat UI polish + layered prompts (incl #270)
- [ ] #324 Nuances: cycles, injuries, pregnancy, new sports, cross-sport load

### Epic: Platform hardening (#325)
_Scaling stops being hand-holding._

- [ ] #326 Plugin install flow
- [ ] #327 How updates reach athlete repos
- [ ] #328 Docs audit + agent framework: prune role files, clean docs (incl #130)
- [ ] #329 Testing framework shape (decision)
- [ ] #361 App writes current_week.json without validation
- [ ] #363 Carve template drift
- [x] #366 validate-soul: lint SOUL against reality

### Epic: Stretch features — M3 (#330)

- [ ] #331 Per-activity screens
- [ ] #332 Product page: web margins
- [ ] #333 Product page: animation improvements
- [ ] #334 Codebase refactor: remove dead code (#288 #223 #224)

## 🚀 M4: Beyond 10+

### Epic: New features — M4 (#335)

- [ ] #336 Live Activity
- [ ] #337 Apple Watch app
- [ ] #338 Rich interactions for widgets (calendar, contextual empty states, motion)
- [ ] #339 Animations pass
- [ ] #340 Category tagging via rules
- [ ] #341 Sleep analytics (rebuild)

### Epic: Ready for strangers — M4 (#342)
_Truth-checked before wider exposure._

- [ ] #343 Testing framework: LLM benchmarks + iOS UI tests
- [ ] #344 Product page dashboard check
- [ ] #345 Remove "Phelps" everywhere (rebrand)
- [ ] #346 Signup-as-runner/cyclist reality check

## 🧊 Backlog — P2

- #68 calories 12k hardcode · #21 Vercel KV races · #239 silent re-auth · #265 BYO-Claude cleanup
- #247 bob: prune unwanted keys from old activities (Skanda & Akash repos)
- #436 coach_log.json grows unbounded — cap/rotate storage

## 🔀 Decisions to take

- [ ] **Gemini vs Claude** — blocks M2 chat
- [ ] backend+DB (P2)

## ✅ Done

**Aug 2026 — M2 push:** chat persists across refresh · onboarding text + step clarity · 365-day review · workouts autopopulate from previous step · iOS-setup page redesign (#166)

**M1 + since:** unified UI, GitHub login, product page · skeleton trimmed · badminton plugin (singles) · dashboard_snapshot.json structure · iOS Testflight · activity renaming unified · monthly analytics fix

## 🧭 Vision — north star, unscheduled

- Auto-sync when new activity lands · lock-screen tracking · coach pre-reads + drops proactive comments · widgets inside chat · configurable widget sets · crazy narrative dashboards / unique insights
