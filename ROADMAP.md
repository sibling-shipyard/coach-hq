# Coach Phelps — Roadmap

Structure: **Epic → parent → task**. Epics are GitHub issues with linked sub-issues and live progress bars. Effort lives on the GitHub issue (Low / Medium / High), not as a label.

This file is the curated view; issues are the record. Flip a box here or tell Uno — it regenerates from issues, never drifts.

**Live athletes (4):** Akash · Skanda · Nats · Prateek. Nats and Prateek onboarded themselves in
August 2026 — signup is iOS-only and self-serve (ADR 0030). There is no operator step to plan around.

**Priority:** P0 unblocks Nats · P1 unblocks 10 users · P2 good to have (incl. M4)

> ⚠️ **P0's definition is spent.** Nats is onboarded, so "unblocks Nats" no longer sorts anything —
> and the one open p0 (#564) is dead-code cleanup, which would not qualify under any replacement
> like "breaks a live athlete". Needs a decision before the next triage; not silently redefined here.

## ✅ M2: Onboard Nats — and Prateek, unaided

### ✅ Epic: Chat reliability — THE GATE (#295) — CLOSED Aug 22

- [x] #296 MVP chat commit works
- [x] #297 Gemini end-to-end in coach chat — web + iOS (checklist: #280)
- [x] #298 First-session protocol
- [x] #280 Coach chat: consolidated manual test checklist
- [x] #347 Refactor coach-chat.ts
- [x] #424 validate-soul can't fail CI

### ✅ Epic: Onboard Nats (#299) — CLOSED Aug 22

Prateek followed through the same self-serve flow with no operator involvement. Gate record: `docs/eng-docs/user-3-onboarding-gate.md` (Historical).

- [x] #300 Remove sleep analytics (simplify onboarding)
- [x] #301 Remove PRE
- [x] #358 Carve ships no SOUL — a fresh repo cannot run BYOB
- [x] #292 bob: pre-populate vs_usual baseline — moved to M3, not blocking Nats

_Supporting:_ #292 now in M3

## 🎯 Now — M3: Scale to 10

### Epic: New-user magic (#302)

- [ ] #303 Setup flow becomes a beautiful journey — Medium
- [ ] #304 Empty activity history handling — Low
- [x] #305 First-session 1-year history — absorbed into #360
- [ ] #306 First-session chat works — Medium (exit test; real work)
- [x] #362 First-session predicate can never complete

### Epic: Homescreen UX (#307)

- [ ] #308 iOS home bug batch — Low (needs the list)
- [ ] #309 Redesign home page — High
- [ ] #311 Web visual tokens: reuse iOS colors — Low
	- [ ] #310 Better SVG activity icons — Low
- [ ] #312 Webapp bug batch (WhatsApp list) — Medium (needs the list)
- [ ] #354 Widget entitlements not referenced — Low

### Epic: Sport-agnostic core (#313)

- [ ] #460 Category sub-tags under each sport — Low
- [ ] #315 Badminton + calisthenics analytics — Medium
- [ ] #314 Home widgets not sport-hardcoded — Medium
- [ ] #365 Generic workout templates — Medium (blocked until #360 loads templates)
- [ ] #367 Quest / gamification audit — Medium
- [ ] #156 HealthKit enrichment — High (pick old PR vs day-grain proposal first)
	- [ ] #501 HealthKit day-grain recovery signals (resting HR, HRV, VO₂ Max, sleep) — Effort not set
	- [ ] #495 HR zones: one source of truth, derived from resting + max HR — Effort not set
- [x] #316 seasons/phases + quest_history — absorbed into #86/#378; leftover is #411

### Epic: Coach depth (#317)

- [x] #357 SOUL v5.8 trim
- [x] #318 SOUL split (post-trim)
- [ ] #360 Ordinary-turn context — Medium
	- [ ] #322 Shrink coach-notes — Low
- [ ] #323 Chat polish — Medium
	- [ ] #270 Stream Gemini replies — Medium
- [ ] #320 Comment widget powered properly — Medium
- [ ] #319 Coach patterns per user — High
- [ ] #321 First-week narrative / strength benchmark — High
- [ ] #324 Cycles, injuries, pregnancy, new sports — High

### Epic: Platform hardening (#325)

- [ ] #473 Coach-chat write path — Medium
	- [ ] #576 Can't write main_quest floor/weight or progressions._meta — Effort not set
	- [ ] #577 plan_edit can't touch week.guardrails[] or do free-form edits — Effort not set
	- [ ] #575 coach_log.json phase_close/week_close row folding decision — Effort not set
	- [ ] #565 progress.json / quests.json source enum: drop dead values — Effort not set
	- [ ] #411 Season recap ritual — Medium (later)
	- [ ] #359 Archive writes silently dropped — Low (**silent data loss; cheap to fix, worth pulling forward**)
	- [ ] #361 Validate week file before save — Low
- [ ] #462 Storage caps (free-text limits) — Low
	- [ ] #436 Rotate coach_log.json — Low
- [ ] #327 How updates reach athlete repos — High (hold: may die if we go backend)
	- [ ] #326 Plugin install flow — High
- [ ] #454 Athlete-repo leftovers — Medium
	- [ ] #419 Schema version-2 policy — Medium
- [ ] #329 Coach-chat eval + clean view — Medium
	- [ ] #573 Judge-model persona/voice scoring in the eval harness — Effort not set
- [ ] #585 Observability + iOS rage reports — Effort not set (plan open: PR #587)
- [ ] #566 Consolidate coach-chat's 3 routes behind a catch-all — Effort not set
- [ ] #572 Conversation compaction for coach-chat history window — Effort not set
- [ ] #574 Background-finish redesign for closing turns (async close) — Effort not set (`p3` label)
- [ ] #493 Sweep docs/plans/ — 10 files marked Current, several belong to closed epics — Effort not set
- [ ] #492 Revisit a dedicated coach-band agent when #317 starts — Effort not set
- [ ] #564 Delete provision-user.sh's dead --migrate mode — Effort not set (**`p0` label, see warning above**)
- [ ] #292 vs_usual baseline during sync — Low (PR open)
- [x] #328 Docs audit + agent framework (incl #130)
- [x] #130 Prune and separate eng vs coach docs
- [x] #363 Carve template drift
- [x] #366 validate-soul: lint SOUL against reality
- [x] #414 iOS Builder boot — spec/DESIGN conditional
- [x] #392 Delegation rule cold-boot cost
- [x] #416 Stale-doc header warn
- [x] #417 Path-check `.claude/hooks/`

### Epic: Stretch features — M3 (#330)

- [ ] #332 Product page polish — Low
	- [ ] #333 Animations — Low
- [ ] #331 Per-activity screens — High
- [x] #334 Remove dead code (parent)
- [x] #288 Split coach-chat.ts
- [x] #223 Unused web chat starters
- [x] #224 Unused iOS post-workout chips
- [x] #348 Opponent nickname map

### ✅ Epic: Coach data redesign (#378) — CLOSED Aug 22

Schema migration done. Season recap leftover moved to #473 / #411.
- [x] #406 Part 1 — profile/memory/injuries/sessions
- [x] #408 memory_update batch-job rework
- [x] #409/#412 Part 2 — seasons/quests/progress/progressions
- [x] #410 quest_event multi-quest fix

## 🚀 M4: Beyond 10+

### Epic: New features — M4 (#335)

- [ ] #336 Live Activity
- [ ] #337 Apple Watch app
- [ ] #338 Rich interactions for widgets (calendar, contextual empty states, motion)
- [ ] #339 Animations pass
- [ ] #340 Category tagging via rules
- [ ] #341 Sleep analytics (rebuild)

### Epic: Ready for strangers — M4 (#342)

- [ ] #343 Testing framework: LLM benchmarks + iOS UI tests
- [ ] #344 Product page dashboard check
- [ ] #345 Remove "Phelps" everywhere (rebrand)
- [ ] #346 Signup-as-runner/cyclist reality check

## 🧊 Backlog — P2

- #68 calories 12k hardcode · #21 Vercel KV races · #239 silent re-auth
- #247 bob: prune unwanted keys from old activities (Skanda & Akash repos)

## 🔀 Decisions to take

- [x] **Gemini vs Claude** — RESOLVED, Gemini e2e shipped (#297 closed Aug 22)
- [ ] **backend+DB** (P2) — repo-update path (#327 / #326) waits on this; do not start those
	- ⚠️ **Conflict:** PR #586 is #327's plan and is open now. Either this hold is dead or that PR is early.
- [ ] **HealthKit shape** — old richer-ingestion PR vs day-grain + sidecar; blocks #156, #501, #495. Two PRs rotting on it: #427 (Aug 18), #162 (**Jul 31**). One should be closed.
- [ ] **Season recap** — later (#411)

## ✅ Done

**Aug 25 — Onboarding gate cleared + board sync:** Nats and Prateek self-served (no operator); ADR 0030 records iOS-only signup; `user-3-onboarding-gate.md` → Historical; scaling-plan M4 corrected; 14 issues missing from this board added — **none of them has an Effort set on the issue**, so none carries one here.

**Aug 22 — M3 board sync:** nested parents, Effort on issues, shipped docs-checker / leftover-UI / iOS-boot / write-path grouping
**Aug 22 — M3 board hygiene:** #299 M2 epic closed (#292 lives in M3), #316 absorbed into #411, #318/#392 closed as shipped, #440/#441 iOS sync+Health Settings shipped
**Aug 22 2026 — M2 Chat gate closed:** #295 epic closed, #296 MVP chat, #297 Gemini e2e, #298 FSP, #424 validate-soul CI, #358 carve SOUL fix, #459 athlete_insights bucket fix
**Aug 22 — Auto-sync:** Auto-sync when new activity lands — already works (moved from Vision)
**Aug 16-21 — Schema + trim:** #300 sleep analytics removed, #301 PRE removed, #406 Part 1 schema, #408/#409/#412 Part 2 schema, #357 SOUL trim, #362 predicate, #363 carve drift, #366 validate-soul lint, #455 carve-skeleton + migration plan

## 🧭 Vision — north star, unscheduled

- lock-screen tracking · coach pre-reads + drops proactive comments · widgets inside chat · configurable widget sets · crazy narrative dashboards / unique insights
