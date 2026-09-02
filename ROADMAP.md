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

## 🎯 Now — M3: Scale to 10

### Epic: Give new athletes a great first hour (#302)

- [ ] #303 Define the setup journey improvements
- [ ] #306 Pass the first-session Coach-chat exit test
	- [ ] #772 Seed a real main-quest placeholder without fooling the completion gate

### Epic: Make Home earn its place as the daily surface (#307)

- [ ] #309 Define the concrete Home redesign delta
- [ ] #310 Improve activity icons at small sizes
- [ ] #312 Recover or replace the missing web bug list

### Epic: Make core coaching sport-agnostic (#313)

- [ ] #156 Enrich HealthKit data at the correct grain
	- [ ] #495 Unify heart-rate zone boundaries and colors
	- [ ] #501 Persist day-grain HealthKit recovery signals
- [ ] #314 Make Home widgets sport-agnostic
- [ ] #346 Verify signup journeys for runners and cyclists
- [ ] #727 Replace frozen templates with compiled season plans
- [ ] #766 Open activity description editing to every sport

### Epic: Make Coach guidance feel specific and earned (#317)

- [ ] #319 Distill durable athlete patterns from the Coach log
- [ ] #321 Define the first-week and strength-benchmark outcome
- [ ] #323 Improve Coach-chat flow and stream replies
	- [ ] #270 Stream Coach replies across web and iOS
	- [ ] #764 Reuse activity rows in Coach Chat and refine its composer
	- [ ] #765 Preserve chat sends when the app is minimized
- [ ] #324 Split advanced coaching scenarios into testable outcomes
- [ ] #486 Add activity rhythm and load patterns to Coach context

### Epic: Harden the platform for ten athletes (#325)

- [ ] #247 Size a safe projection of activity history files
- [ ] #327 Deliver authenticated updates to athlete repositories
	- [ ] #326 Install Coach plugins through the repository updater
	- [ ] #729 Detect drift in carved athlete-repository files
	- [ ] #755 Recover stale GitHub credentials across chat and iOS
- [ ] #329 Present a clean Coach-chat voice evaluation
	- [ ] #670 Make the Coach-chat evaluation gate reliably green
	- [ ] #714 Score model quality on real Coach turns
- [x] #473 Coach-chat write path — retained as parent for open work
	- [ ] #565 Remove unused source enum values from Coach data
	- [ ] #575 Fold phase and week closures out of the Coach log
	- [ ] #576 Write supported per-athlete schema extensions
	- [ ] #577 Support bounded edits to week guardrails
- [ ] #547 Install Prod, Dev, and Staging iOS apps side by side
- [ ] #595 Record and surface failed athlete sync runs
- [ ] #609 Ignore null template IDs during closing turns
- [ ] #616 Persist acknowledged updates during ordinary turns
- [ ] #630 Preserve chat turns through wrap and thread eviction
- [ ] #703 Batch athlete-repository schema and carve migrations
	- [ ] #762 Block BYOB Coach pushes when athlete data validation is red
- [ ] #713 Route Coach model calls through one OpenRouter client
	- [ ] #638 Send Gemini credentials in a request header
	- [ ] #668 Decide the production fallback for Gemini capacity failures
- [ ] #725 Standardize Sentry operation tags
- [ ] #736 Validate nested athlete-data shapes and enums
- [ ] #747 Enforce issue hygiene and Project 4 maintenance
- [ ] #756 Recover from malformed Gemini JSON and week plans

### Epic: Deliver the approved M3 stretch surfaces (#330)

- [ ] #331 Add a standalone activity detail page on the web
- [ ] #332 Polish product-page spacing and motion
	- [ ] #333 Improve product-page motion and reduced-motion behavior

### Epic: Make the agent operating layer portable and navigable (#795)

- [ ] #763 Add a reusable architecture atlas for agents

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

**Sep 2 — M3 hierarchy:** all 51 open M3 non-epics reach one of seven native epics. Project 4's
M3 By epic view groups that work by parent, and linked implementation PRs enforce the same path.

**Sep 1 — Issue hygiene + Project 4:** the frozen 91-issue backlog was classified and normalized;
all non-closure issues pass the enforced title/body/category/milestone contract. Project 4 keeps
status current and exposes focused triage views. Seven valid product questions use `needs-decision`.

**Aug 25 — Priority labels retired + sport-agnostic pulled forward:** the `p0`–`p3` issue labels are gone. Nothing automated read them, nobody sorted by them, and a second scale beside the review tiers only caused confusion — including one agent misreading a stale `p0` as current. Milestones and epics do the sorting. #313 moved ahead of #307 and #346 moved out of M4 — Prateek plays football and cycles, neither of which the product handles. HealthKit shape resolved by closing #162.

**Aug 25 — Onboarding gate cleared + board sync:** Nats and Prateek self-served (no operator); ADR 0030 records iOS-only signup; scaling-plan M4 corrected; 14 issues missing from this board added — **none of them has an Effort set on the issue**, so none carries one here.

**Aug 22 — M3 board sync:** nested parents, Effort on issues, shipped docs-checker / leftover-UI / iOS-boot / write-path grouping
**Aug 22 — M3 board hygiene:** #299 M2 epic closed (#292 lives in M3), #316 absorbed into #411, #318/#392 closed as shipped, #440/#441 iOS sync+Health Settings shipped
**Aug 22 2026 — M2 Chat gate closed:** #295 epic closed, #296 MVP chat, #297 Gemini e2e, #298 FSP, #424 validate-soul CI, #358 carve SOUL fix, #459 athlete_insights bucket fix
**Aug 22 — Auto-sync:** Auto-sync when new activity lands — already works (moved from Vision)
**Aug 16-21 — Schema + trim:** #300 sleep analytics removed, #301 PRE removed, #406 Part 1 schema, #408/#409/#412 Part 2 schema, #357 SOUL trim, #362 predicate, #363 carve drift, #366 validate-soul lint, #455 carve-skeleton + migration plan

## 🧭 Vision — north star, unscheduled

- lock-screen tracking · coach pre-reads + drops proactive comments · widgets inside chat · configurable widget sets · crazy narrative dashboards / unique insights
