# Coach Phelps: SOUL History

> Status: Historical · Owner: Tech Lead · Verified: 2026-08-22

How a generic motivational chatbot became Coach Phelps. Every version, what it gained, and what
it cost. Read top to bottom it's a character sheet.

**Entry format — hard cap 8 non-empty lines per version:**

1. **Superpower gained** — one line. What can Coach do now that it couldn't before?
2. **2–3 bullets** — what changed for the athlete / coaching. Not how it was implemented.
3. **Why it mattered** (or **What it cost**) — one honest closing line.

No "what was wrong" essay. No 5–7 bullet dumps. File paths, `§`, PR/issue numbers, script names,
and JSON field names belong in an eng-doc — link once in Why if needed. Trigger: only when Coach
behaves, talks, or decides differently.

---

## v5.14 — "The Catch-Up" · Aug 20, 2026
**Superpower gained:** one coaching brain that understands the files both runtimes actually use.
- Profile, memory, injuries, and continuity follow the live split records — not retired prose files.
- First Session uses one shared question list; hosted chat and BYOB save the same facts.
- Native setup's name, sports, and style are never re-asked.
**Why it mattered:** a new athlete no longer meets a Coach describing storage that no longer exists.

## v5.13 — "Back to the Trim" · Aug 20, 2026
**Superpower gained:** none — this is a revert, not a feature.
- First Session wording that slipped in without review rolled back to the last reviewed trim.
- Chat's new save behavior stayed; only the unreviewed brain text went back.
**What it cost:** SOUL and chat were briefly out of sync until the follow-up landed.

## v5.12 — "Write It While It's Fresh" · Aug 19, 2026
**Superpower gained:** First Session remembers each answer as soon as the athlete gives it.
- Native setup still records name, sports, and style before Coach greets.
- The goal moved back into chat as the main quest; each turn can save new facts.
**Why it mattered:** an interrupted intake loses a transcript at worst, not the facts already gathered.

## v5.11 — "First Session, For Real This Time" · Aug 19, 2026
**Superpower gained:** chat's First Session asks questions that actually go somewhere.
- Sports, a from-scratch season, and starting quests finally had somewhere to land.
- The coaching-style question maps cleanly to one of three real choices.
**Why it mattered:** a first session that can't finish isn't a first session — it's a form nobody can submit.

## v5.10 — "Seasons Without Ceremony" · Aug 18, 2026
**Superpower gained:** a season is just a name, a start, and an end.
- Phase math and block ceremony dropped — a season is referenced in conversation, not by date math.
- Closing a season no longer writes a long retrospective ritual.
**What it cost:** real season history and recaps only survive in git, not in the live tree.

## v5.9 — "New Files, Same Sections" · Aug 18, 2026
**Superpower gained:** memory keeps working across a full data-model rewrite underneath it.
- Coach still talks about profile, patterns, and injuries the same way — sections, not file paths.
- Profile-complete became a real field check instead of prose matching.
**Why it mattered:** a data-model rewrite this size should be invisible to the coaching relationship.

## v5.8 — "The Trim" · Aug 16, 2026
**Superpower gained:** knowing what it can't do, and shutting up about it.
- Hosted chat and BYOB each get a brain sized to what they can actually do.
- Dropped sleep-asking, PRE notes, and other signals athletes stop maintaining by hand.
- Rare workflows only load when needed instead of every turn.
**What it cost:** we cut hard on a file whose value is voice, with an eval that covers structure not voice.

## v5.7 (hq-adopted) — "Personal Brain on Main" · Jul 26, 2026
**Superpower gained:** the good brain became everyone's brain.
- HQ adopted the richer personal-repo brain instead of forking the thin one.
- Athlete-specific profile content stripped so every fork starts clean.
**Why it mattered:** shipping the thin brain would have baked a worse Coach into every athlete forever.

## v5.7 — "Canonical Layout" · Jul 25, 2026
**Superpower gained:** knowing where its own things are.
- Boot, guardrails, and rituals repointed after the repo reorg.
- Analytics stayed on-demand; challenge narrative archived rather than deleted.
**Why it mattered:** stale paths fail silently — Coach finds nothing and never says so.

## v5.6 — "Milestone Record Contract" · Jul 22, 2026
**Superpower gained:** milestones the dashboard could draw.
- Coach keeps milestone prose; a shared schema owns display fields and progress.
**Why it mattered:** Coach should not hand-compute UI percentages mid-conversation.

## v5.5 — "Live Weekly Plan" · Jul 20, 2026
**Superpower gained:** the plan Coach writes is the plan the athlete sees.
- The bounded week started rendering live on the home screen — plan, completion, commentary.
**Why it mattered:** an unreconciled session is now visibly wrong, not just untidy data.

## v5.4 — "The Bounded Week" · Jul 19, 2026
**Superpower gained:** a week with an expiry date.
- The active week became a dated Monday-to-Sunday contract with plan, outcomes, and short commentary.
- Closed weeks leave one summary; day-by-day plans no longer swell durable memory.
**Why it mattered:** Coach and the apps need one fresh week, not a forever-growing scrapbook.

## v5.3 — "One Source of Truth" · Jun 21, 2026
**Superpower gained:** one answer to "is he injured?"
- Live injury status lives in one place; SOUL keeps only permanent history.
- Closed phases get an archive instead of scrolling forever in notes.
**Why it mattered:** two files claiming injury status guarantees one of them is lying.

## v5.2 — "Build Phase" · Jun 21, 2026
**Superpower gained:** catching up before saying hello.
- Boot reviews recent activity before greeting — "saw you got that session in."
- Build Phase got a real model; automatic habits stopped cluttering every check-in.
**Why it mattered:** tracking foregone conclusions was bookkeeping, not coaching.

## v5.1 — "Drop Per-Game Notation" · Apr 11, 2026
**Superpower gained:** shutting up between games.
- Mental state is noted once before play, not between every game.
**Why it mattered:** writing between matches stole focus when the next point mattered more.

## v5.0 — "Lean Boot + Calibration" · Apr 6, 2026
**Superpower gained:** travelling light.
- Boot loads less; guardrails sit in one place; analytics stay on-demand.
- Calibration examples show the voice instead of only describing it.
**Why it mattered:** one file doing four jobs made every check-in brittle and noisy.

## v4.1 — "Protocol Tightening" · Apr 3, 2026
**Superpower gained:** a memory that fits in your pocket.
- Boot keeps the last few sessions close instead of rereading the whole archive.
- Weekly kick-off and the save ritual became named workflows with checklists.
**Why it mattered:** three live sessions kept hitting the same friction until the protocol got sharp.

## v4.0 — "The Phelps Rewrite" · Mar 29, 2026
**Superpower gained:** an actual personality.
- Generic coach retired; process-first Phelps voice took over — feeling before data.
- Situation playbook for showing up defeated; Validate → Share → Redirect under pressure.
**Why it mattered:** under stress the old coach became a status report, not a shoulder.

## v3.1 — "Pipeline Aware" · Mar 28, 2026
**Superpower gained:** understanding its own plumbing.
- Coach learned the sync pipeline and when to use each tool.
- Session files land adjusted before the timer opens.
**Why it mattered:** otherwise Coach fought automation or sent the athlete in with the wrong sets.

## v1.6–v3.0 — Undocumented · Mar 25–28, 2026
**Superpower gained:** none recorded.
**Why it mattered:** five version bumps in three days while the pipeline was born — no log survived.

## v1.5 — "Forward Sync" · Mar 25, 2026
**Superpower gained:** not losing yesterday.
- Sync looks forward for new work and backward for gaps in one run.
**Why it mattered:** new sessions after the last sync point were vanishing unless saved by hand.

## v1.4 — "History as Ground Truth" · Mar 24, 2026
**Superpower gained:** data it could actually query.
- Structured activity history became what Coach reasons from.
- The markdown log stayed for humans, not as the source of truth.
**Why it mattered:** markdown was lovely to read and miserable to query.

## v1.3 — "The Consolidation" · Mar 24, 2026
**Superpower gained:** the discipline to save before leaving.
- Five brain files became two: static SOUL plus living state.
- Every session ends by saving — the commit ritual went live.
**Why it mattered:** a coach built on memory only works if the memory is always written down.

## v1.0–v1.2 — "The Foundation" · Mar 17–24, 2026
**Superpower gained:** existing.
- Portable two-file coaching: one static brain, one living memory.
- Boot: read both, then coach. Still a generic "direct & no-nonsense" data-first coach.
**Why it mattered:** five scattered files meant every new thread started half-blind.
