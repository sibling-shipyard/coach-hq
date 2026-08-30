# Coach-chat — full test pass, 2026-08-28

> Status: Current · Owner: Athlete (manual) + Tech Lead (tracking) · Verified: 2026-08-28

## Context

Skanda's call today: test everything in coach-chat, FSP included, end to end, before fixing
anything. Two venues: `coach-skanda` locally (real athlete data, established profile — daily
flow + regression) and a brand-new/wiped repo (FSP from zero). Builds on
[`coach-chat-redesign-testing.md`](coach-chat-redesign-testing.md), which already closed Daily
flow and FSP steps 1-4 on 2026-08-27 but left resumability and BYOB open — those, plus two known
bugs (#609, #616) and anything that just feels wrong, are today's actual target. Don't fix
anything found here mid-pass — log it, keep testing (same scope guard as the doc above).

## Before you start

1. `npm test` (or `npm run test:logged` to keep a record) — confirms the layered suite is green
   before you spend live Gemini calls chasing something that's actually a fixture problem.
2. Know your two tools:
   - `npm run test:coach-chat-manual` — real conversation, real repo, real Gemini + GitHub.
     `--branch` optional (auto-creates a scratch branch, refuses `main`). `--greet` /
     `--message "..."` for one turn, `--turns <file.json>` for a script — see
     `ui/scripts/examples/*.json` for ready ones (`manual-coach-chat-turns-fsp.json`,
     `-daily.json`, `-daily-2.json`, plus `.example.json` variants for plan-adjustment /
     quest-and-injury).
   - Real browser (web) or the iOS app — for anything about *feel*: does the reply read right,
     does the UI update, does resumability actually resume.
3. Every scripted run logs to `tests/2026-08-28/manual/` automatically — that's your evidence
   trail, not this doc. Note the filename next to each item below as you go, or just point Tech
   Lead at the folder after.

## A. FSP — new/wiped repo, from zero

Use a fresh scratch branch with `profile.json` wiped, or a genuinely new repo if you want to
exercise real iOS signup (ADR 0030 — signup is iOS-only).

- [ ] Greet turn: opener uses recorded native onboarding hints (name/sports) if present, doesn't
      re-ask for them.
- [ ] Answer profile facts one at a time (name, DOB, height, weight, city) — pull `profile.json`
      after **each** turn, confirm it lands incrementally, not batched at close.
- [ ] Give an ambiguous answer on purpose ("sometime in June I think") — confirm Coach asks a
      follow-up instead of committing a guess. No `profile.json` write should fire on that turn.
- [ ] State the 3-6 month goal — confirm `quest_create`'s `main_quest`, not a `memory_update`.
- [ ] State events/season timeline — confirm `season_start`, no `phase` field.
- [ ] Mention an injury — confirm `injury_event` commits.
- [ ] State a habit quest **on the same turn** the profile completes — confirm `quest_create`
      still fires (this is the exact bug #431/#432/#434 fixed; re-confirm it stays fixed).
- [ ] Close the session — confirm `coach_since` stamps exactly once, real diff shows
      `null → "<today's date>"`, in the same atomic commit as the other closing writes.
- [ ] **Resumability (needs real browser/iOS, not the manual script):** answer a few FSP
      questions, kill the tab/app before closing, relaunch. Confirm it resumes the *same*
      in-progress thread with what you already said — not a fresh greet, not lost answers.
- [ ] **BYOB, separately:** a first session via Claude Code against `platform/SOUL.claude.md`
      (terminal runtime, zero automated coverage today). Confirm the intake reads sane — this
      exercises `B_engine.md §10` directly, not the hosted-chat horcrux copy.

## B. Daily flow — `coach-skanda`, real data

- [ ] Greet turn — confirm no file writes fire (greeting shouldn't write anything).
- [ ] Ordinary turn, `profile_update` (e.g. "I'm 76kg now") — read the reply, then check
      `profile.json` actually changed. **This is issue #616**: today, once the profile is
      already complete, ordinary-turn writes are silently dropped until close. Confirm you can
      reproduce it (ack in the reply, no commit) — that's the expected-broken result right now,
      not a test failure on your end.
- [ ] Ordinary turn, `memory_update` (fitness baseline / training frequency change).
- [ ] Ordinary turn, `injury_event`.
- [ ] Closing turn — `coach_note` appends to `coach_log.json`, one atomic commit (not several).
- [ ] Closing turn where Gemini might emit a placeholder `template_edit` (e.g. close without
      naming a specific template change) — **issue #609**: a null-ish `template_id` (`"none"`,
      similar) currently crashes the *whole* closing commit, losing every other write in that
      turn too. Probabilistic — you may need a few closing turns to catch Gemini doing this. Log
      the run if it reproduces.
- [ ] Close-session detection, both directions: a message that should close ("wrap this
      session") actually does; a message that shouldn't ("what's my next session?") doesn't.
- [ ] Cross-device staleness: start a second scratch thread mid-conversation, confirm a stale
      `knownSha` on an ordinary turn comes back `stale: true`.
- [ ] Read the Fitness Snapshot context in a greet/ordinary reply against `coach-skanda`'s real
      activity mix — does it read sensibly, not just "did it write."

## C. Whatever's bugging you

You said you're not happy with specific things already. As you hit them in A/B, or separately,
note here rather than fixing inline:

- [ ] _(fill in as you find them — one line each, point at the log file if there is one)_
- [x] **#671**: FSP native onboarding name hint never reaches `profile.json` — reproduced twice
      on a genuinely fresh signup (uninstall/reinstall, fresh `skanda-testing/coach-skanda-testing`
      repo, real `PersonalizeView` name screen). No onboarding-hint commit lands before the greet,
      `profile.json.name` stays `""`, and Gemini's opener asks for the name instead of using it —
      contradicts `coach-chat-fsp.md` §1's documented handoff.

## Recording results

Point Tech Lead at `tests/2026-08-28/{manual,eval}/` when done, plus this file's checked boxes
and section C. Anything that's a real bug (not already #609/#616) gets filed as its own issue,
not fixed inline — same scope guard as `coach-chat-redesign-testing.md`. If A's resumability or
BYOB rows close today, they close the matching rows in that doc too (steps 5-6 under FSP there).

## Done when

Every box above is either checked, or has a filed issue number next to it. Two already-known
outcomes (#609, #616 reproducing) count as done, not blocked — the point of today is confirming
what's real, not fixing it yet.
