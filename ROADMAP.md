# Coach Phelps — Roadmap

Structure: **Epic → parent → task**. Epics are GitHub issues with linked sub-issues and live progress bars. Effort lives on the GitHub issue (Low / Medium / High), not as a label.

This file is the curated view; issues are the record. Flip a box here or tell Uno — it regenerates from issues, never drifts.

**Live athletes (4, holding at 5):** Akash · Skanda · Nats (running, strength) · Prateek (football,
cycling, strength). Nats and Prateek onboarded themselves in August 2026 — signup is iOS-only and
self-serve (ADR 0030). There is no operator step to plan around.

> ⚠️ **Two of Prateek's three sports have no analytics.** The product handles running, badminton and
> calisthenics; football and cycling are not built. This is a live athlete today, not a future
> persona — it moves #313 ahead of the homescreen work and makes #346 current, not M4.

**Priority:** milestones and epics, below. Every open issue has one area, one work type, and an M3,
M4, or Later horizon. The `p0`–`p3` labels are retired and removed; `needs-decision` marks a valid
issue whose one product question must be answered before implementation.

## ✅ M2: Onboard Nats — and Prateek, unaided

### ✅ Epic: Chat reliability — THE GATE (#295) — CLOSED Aug 22

- [x] #296 MVP chat commit works
- [x] #297 Gemini end-to-end in coach chat — web + iOS (checklist: #280)
- [x] #298 First-session protocol
- [x] #280 Coach chat: consolidated manual test checklist
- [x] #347 Refactor coach-chat.ts
- [x] #424 validate-soul can't fail CI

### ✅ Epic: Onboard Nats (#299) — CLOSED Aug 22

Prateek followed through the same self-serve flow with no operator involvement. The gate doc, the M1 plan and the provisioning runbook are deleted — ADR 0030 carries what was durable.

- [x] #300 Remove sleep analytics (simplify onboarding)
- [x] #301 Remove PRE
- [x] #358 Carve ships no SOUL — a fresh repo cannot run BYOB
- [x] #292 bob: pre-populate vs_usual baseline — moved to M3, not blocking Nats

_Supporting:_ #292 now in M3

## 🎯 Now — M3: Scale to 10

### Epic: New-user magic (#302)

- [ ] #303 Define the setup journey improvements — Medium (`needs-decision`)
- [ ] #304 Empty activity history handling — Low
- [x] #305 First-session 1-year history — absorbed into #360
- [ ] #306 Pass the first-session Coach-chat exit test — Medium
- [x] #362 First-session predicate can never complete

### Epic: Sport-agnostic core (#313)

- [ ] #346 Verify signup journeys for runners and cyclists — Effort not set (**moved from M4** — Prateek is that athlete)
- [ ] #460 Category sub-tags under each sport — Low
- [ ] #315 Badminton + calisthenics analytics — Medium
- [ ] #314 Make Home widgets sport-agnostic — Medium
- [ ] #365 Generic workout templates — Medium (blocked until #360 loads templates)
- [ ] #367 Quest / gamification audit — Medium
- [ ] #156 HealthKit enrichment — High (pick old PR vs day-grain proposal first)
	- [ ] #501 Persist day-grain HealthKit recovery signals — Effort not set
	- [ ] #495 Unify heart-rate zone boundaries and colors — Effort not set
- [x] #316 seasons/phases + quest_history — absorbed into #86/#378; leftover is #411

### Epic: Homescreen UX (#307)

- [ ] #308 iOS home bug batch — Low (needs the list)
- [ ] #309 Define the concrete Home redesign delta — High (`needs-decision`)
- [ ] #311 Web visual tokens: reuse iOS colors — Low
	- [ ] #310 Better SVG activity icons — Low
- [ ] #312 Recover or replace the missing web bug list — Medium (`needs-decision`)
- [ ] #354 Widget entitlements not referenced — Low

### Epic: Coach depth (#317)

- [x] #357 SOUL v5.8 trim
- [x] #318 SOUL split (post-trim)
- [ ] #360 Ordinary-turn context — Medium
	- [ ] #322 Shrink coach-notes — Low
- [ ] #323 Improve Coach-chat flow and stream replies — Medium
	- [ ] #270 Stream Coach replies across web and iOS — Medium
- [ ] #320 Comment widget powered properly — Medium
- [ ] #319 Distill durable athlete patterns from the Coach log — High
- [ ] #321 Define the first-week and strength-benchmark outcome — High (`needs-decision`)
- [ ] #324 Split advanced coaching scenarios into testable outcomes — High (`needs-decision`)

### Epic: Platform hardening (#325)

- [x] #473 Coach-chat write path — closed Sep 1; recaps stay absent by decision and week writes validate
	- [ ] #576 Write supported per-athlete schema extensions — Effort not set
	- [ ] #577 Support bounded edits to week guardrails — Effort not set
	- [ ] #575 Fold phase and week closures out of the Coach log — Effort not set
	- [ ] #565 Remove unused source enum values from Coach data — Effort not set
	- [ ] #411 Decide whether season-closing recaps should return — Medium (later)
	- [x] #359 Archive writes stay dropped by decision
	- [x] #361 Validate week file before save
- [ ] #462 Storage caps (free-text limits) — Low
- [ ] #436 Bound Coach-log storage without losing continuity — Low
- [ ] #327 Deliver authenticated updates to athlete repositories — High
	- [ ] #326 Install Coach plugins through the repository updater — High
- [ ] #454 Decide the fate of athlete-repository leftovers — Medium
	- [ ] #419 Define migration policy before Coach data reaches version 2 — Medium
- [ ] #329 Present a clean Coach-chat voice evaluation — Medium
	- [ ] #573 Score Coach persona and voice in the evaluation harness — Effort not set
- [ ] #585 Observability + iOS rage reports — Effort not set (plan open: PR #587)
- [ ] #566 Consolidate Coach-chat routes behind one handler — Effort not set
- [ ] #572 Compact Coach-chat history without losing context — Effort not set
- [ ] #574 Finish Coach-chat closing turns asynchronously — Effort not set
- [ ] #493 Sweep stale plans and preserve only durable guidance — Effort not set
- [ ] #492 Reconsider a dedicated Coach-band agent when churn grows — Effort not set
- [x] #564 Delete provision-user.sh's dead --migrate mode — overtaken: the whole script is deleted (ADR 0030/0031)
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

- [ ] #332 Polish product-page spacing and motion — Low
	- [ ] #333 Improve product-page motion and reduced-motion behavior — Low
- [ ] #331 Add a standalone activity detail page on the web — High
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

- [ ] #336 Show an active coaching state with Live Activities
- [ ] #337 Define and build the Apple Watch companion
- [ ] #338 Add calendar and contextual interactions to widgets
- [ ] #339 Complete the approved product motion pass
- [ ] #340 Assign activity categories with deterministic rules
- [ ] #341 Rebuild sleep analytics from HealthKit data

### Epic: Ready for strangers — M4 (#342)

- [ ] #343 Add Coach benchmarks and iOS UI tests
- [ ] #344 Define the product-page dashboard check (`needs-decision`)
- [ ] #345 Replace the Phelps product name
- [ ] #487 Define the no-watch coaching outcome (`needs-decision`)

## 🧊 Later / standalone backlog

- M4: #68 fabricated calorie target · #21 session revocation/user registry · #239 GitHub re-auth
- Later: #43 half-marathon GPS over-distance tolerance
- M3 Backlog: #247 size a safe projection of activity history files

## 🔀 Decisions to take

- [x] **Gemini vs Claude** — RESOLVED, Gemini e2e shipped (#297 closed Aug 22)
- [x] **backend+DB** — **DEFERRED, not rejected** (2026-08-25). Revisit once the product is proven at
  5 users and the open bugs are cleared. Long-term shape still stands in `scaling-plan.md` §9.
	- ⚠️ **This releases #327 / #326 rather than blocking them.** The old hold read "do not start those
	  — may die if we go backend." If the backend is that far out, athlete repos drift for months with
	  no way to receive a fix. The hold's reason is gone, so PR #586 proceeds — judged on its scope,
	  not on this decision.
- [x] **HealthKit shape** — RESOLVED by closing #162: day-grain + sidecar (#427) is the direction. ADR deferred until #427 is picked up — see the note on #156. Unblocks #156, #501, #495.
- [ ] **Season recap** — later (#411)

## ✅ Done

**Sep 1 — Issue hygiene + Project 4:** the frozen 91-issue backlog was classified and normalized;
all non-closure issues pass the enforced title/body/category/milestone contract. Project 4 now has
maintained status automation plus Needs triage, Now, Later, and By area views. Seven valid product
questions use `needs-decision`; #247 and #670 were corrected from open-and-Done to Backlog.

**Aug 25 — Priority labels retired + sport-agnostic pulled forward:** the `p0`–`p3` issue labels are gone. Nothing automated read them, nobody sorted by them, and a second scale beside the review tiers only caused confusion — including one agent misreading a stale `p0` as current. Milestones and epics do the sorting. #313 moved ahead of #307 and #346 moved out of M4 — Prateek plays football and cycles, neither of which the product handles. HealthKit shape resolved by closing #162.

**Aug 25 — Onboarding gate cleared + board sync:** Nats and Prateek self-served (no operator); ADR 0030 records iOS-only signup; scaling-plan M4 corrected; 14 issues missing from this board added — **none of them has an Effort set on the issue**, so none carries one here.

**Aug 22 — M3 board sync:** nested parents, Effort on issues, shipped docs-checker / leftover-UI / iOS-boot / write-path grouping
**Aug 22 — M3 board hygiene:** #299 M2 epic closed (#292 lives in M3), #316 absorbed into #411, #318/#392 closed as shipped, #440/#441 iOS sync+Health Settings shipped
**Aug 22 2026 — M2 Chat gate closed:** #295 epic closed, #296 MVP chat, #297 Gemini e2e, #298 FSP, #424 validate-soul CI, #358 carve SOUL fix, #459 athlete_insights bucket fix
**Aug 22 — Auto-sync:** Auto-sync when new activity lands — already works (moved from Vision)
**Aug 16-21 — Schema + trim:** #300 sleep analytics removed, #301 PRE removed, #406 Part 1 schema, #408/#409/#412 Part 2 schema, #357 SOUL trim, #362 predicate, #363 carve drift, #366 validate-soul lint, #455 carve-skeleton + migration plan

## 🧭 Vision — north star, unscheduled

- lock-screen tracking · coach pre-reads + drops proactive comments · widgets inside chat · configurable widget sets · crazy narrative dashboards / unique insights
