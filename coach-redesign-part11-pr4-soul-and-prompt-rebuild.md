# Part 11 / PR 4 — coachPrompt.ts trim + SOUL rebuild (last in the stack)

Stacked on `coach-redesign-part10-pr3-wire-insights.md`'s branch (or off PR #435's branch directly
if the insights chain hasn't merged yet — confirm actual branch topology when starting; SOUL
doesn't strictly need PR 2/3 merged first, it just needs to describe them accurately once they
exist, so branching off #435 and rebasing later is fine too). Last PR in the stack — everything
else lands first so SOUL and the prompt describe a settled system, not a moving one.

**This PR gets the most scrutiny of the whole stack — Akash reviews the wording explicitly, not
just the diff.** Get his sign-off on Part B's proposed section text before running
`compose-soul.mjs` for real.

## Part A — `coachPrompt.ts` line-by-line trim

### Context

`coachPrompt.ts` is 827 lines. Confirmed via research this session: the *output schema* is
already tight and well-designed (see the input/output audit below) — the file's size comes from
duplicated commentary and some avoidably-verbose per-mode instruction prose, not from a bloated
schema. Go through the file section by section — this needs to actually happen line by line, not
just apply the categories below in one pass. Keep every trim to exactly what's justified below —
the goal is a prompt with no more and no less than what Gemini actually needs.

### What to do, in order

1. **Dedupe `GeminiReply` interface comments against `responseSchema` comments** (roughly lines
   17-168 vs. 202-437) — confirmed near-verbatim duplication, e.g. `injury_event`'s "array not
   object, issue #410" rationale and `session_plan`'s `skip_phases` rationale are each written out
   twice. Keep the rationale in one place — put it on `responseSchema`, since that's closer to the
   wire format Gemini actually sees — and have the `GeminiReply` interface comment reference it
   (e.g. `// see responseSchema's injury_event for rationale`). Zero prompt-token cost either way
   (both are TS-only comments, never sent to Gemini) — pure maintenance-burden cleanup, do this
   first, it's free and has no behavioral risk at all.

2. **Consolidate repeated prompt text that's actually sent to Gemini** into shared string
   constants:
   - The "never say something is saved/logged/locked/committed unless..." warning — currently
     written twice with different wording (once in the FSP-closing branch around line 542-543,
     once with the full field list in the ordinary-closing branch around 678-681).
   - The `session_closed` framing sentence — repeated with small variations across all 5 mode
     branches (greeting, closing+FSP, closing-ordinary, FSP-ordinary, plain-ordinary — roughly
     lines 507, 544-546, 682-685, 690, 704).
   Real token savings since this content is actually sent to Gemini every relevant turn; low
   behavioral risk since the content itself doesn't change, it just stops repeating with slightly
   different wording each time.

3. **Field-by-field pass over the closing-turn branch** (roughly lines 548-686, the largest single
   block — it walks nearly every schema field on every closing turn). For each field's instruction
   text, check: is this restating something the schema's own `enum` already constrains (e.g.
   `coaching_style_update`'s three values spelled out in prose around 563-568), purely for *what
   values are legal*? If so, shorten it to a pointer at the enum plus only the *when to use this
   field* guidance that isn't already in the schema. Don't blanket-cut — some fields' prose
   carries judgment calls the schema can't express (e.g. when something belongs in
   `memory_update` vs. `coach_note`) and that judgment needs to survive. Go through every field in
   this branch: `coach_note`, `memory_update`, `coaching_style_update`, `sports_update`,
   `injury_event`, `quest_event`, `profile_update`, `template_edit`, `session_plan`, `week_plan`,
   `session_reconcile`, `plan_edit`, `season_start`, `quest_create`. For each one, note in the PR
   description what was cut and why — Akash should be able to review the *reasoning* per field
   from the PR body, not have to re-derive it from the diff.

4. **Check for `npm run eval:coach-chat`** (referenced in `docs/eng-docs/gemini-flow.md`) — if it
   exists and runs locally, use it as a baseline before touching anything, then re-run after each
   meaningful trim pass (not just once at the very end) so any behavioral drift shows up early,
   tied to the specific change that caused it. If it doesn't exist or won't run, say so plainly in
   the PR and rely on the live scratch-branch testing discipline below instead.

5. **Do not build in this PR** (a real idea, but bigger structural risk than "trim prose," and not
   asked for): `soulCache.ts` only caches `staticSystemText()` (persona + few-shot examples) — all
   ~200+ lines of mode-branch instruction text are uncached, paid for on every single turn, because
   they vary by mode, not by athlete. In principle the 5 mode variants could each be cached
   separately for real cost savings. Note this in the PR description as a follow-up idea worth an
   ADR later — don't implement it here.

6. **Confirmed not a bug, don't touch:** no mode-leakage was found anywhere — the
   mutually-exclusive ternary chain in `buildDynamicText` already correctly isolates each mode's
   instructions (no FSP-only or badminton-only text leaking into prompts where it doesn't apply).
   Preserve this branching structure exactly through the trim; the goal is fewer tokens per
   branch, not restructuring how branches are selected.

### Input/output audit (context for the trim, not new scope)

Confirmed this session: hosted chat's *input* is the 8 (soon 9, with PR 3's insights) GitHub file
fetches rendered into compact context sections, plus this file's mode-gated instruction text, plus
the cached persona/few-shot prefix. The *output* — the `GeminiReply` structured JSON — is already
a tight, deliberately-designed shape per `docs/eng-docs/gemini-flow.md`'s action-field design rule
(server owns bookkeeping like ids/timestamps, enums instead of free text, fields declared before
`reply`). Nothing in the schema itself needs restructuring — the trim opportunity here is entirely
in the *prose around* the schema (items 1-3 above), not the schema's shape.

### Verification for Part A

- `cd ui && npx tsc --noEmit`, `npm test -- --run` clean.
- `eval:coach-chat` before/after each pass, if it exists and runs.
- Live scratch-branch test: a first session, a few ordinary chat turns, and a closing turn,
  confirming Gemini's behavior reads the same or better despite the shorter prompt — check the
  real API responses and real committed files, not just that the code compiles.

---

## Part B — SOUL rewrite (`SOUL.chat.md` + `SOUL.claude.md`)

### Context

PR #435 reverted `platform/soul/B_engine.md` + `compose-soul.mjs` to Akash's last approved state
(`8d8cba8`, v5.8 "The Trim"). This PR brings it back up to describe the redesign accurately — the
ledger-file rename (#407/#413), the retired quest-log generator (PR 2 of this stack), and First
Session Protocol's reliability mechanism (originally #431/#432, redesigned here with lessons from
review). BYOB is assumed already migrated to the new ledger schema by the time this PR is written
(per explicit direction — migration is happening separately, outside this stack) — so every rename
below is a straight rename, no CLAUDE_ONLY/CHAT_ONLY target-split needed.

**Keep every section to exactly what's needed to describe the current system accurately.** No
restating mechanism the code already enforces correctly, no new content beyond reconciling SOUL to
what's actually shipped.

### Scope

1. **File/schema renames**, confirmed against actual current schemas (not the pre-revert diff,
   verified independently this session):
   - §1 boot, §12 closing: `state.md` → `profile.json`/`memory.json`; `coach_notes.md` → the
     unified `coach_log.json` append-only row log, windowed to the last 5 rows at render time (per
     PR 1 of this stack). This is a bigger change than a filename swap — `coach_notes.md` and
     `state.md`'s old "Recent Session Notes" rolling section used to be two separate things; both
     are now one `coach_log.json` model. Describe the actual current behavior, don't just
     find-and-replace the old file name into the old sentence structure.
   - §5b1 (Current Season) / §5b3 (closing a season): `state.md` → `seasons.json`. Confirmed via
     `coachQuestFiles.ts`'s `Season` type: no phase/block field, `status: active | completed |
     retired`, no archive-on-close step. The pre-revert simplification here (no phase awareness,
     no season-close archive ritual) was accurate — safe to reintroduce close to as-is.
   - §8 (Goals & Quests): `challenge_v2.json` → `quests.json` + `progress.json`. Confirmed quest
     types are `daily_streak | progress | count_target | weekly_frequency` (yes,
     `weekly_frequency` is real — confirmed in `coachQuestFiles.ts`), and logging is one reported
     `status` (`completed | missed | excused`) per day via `ProgressRow`, not two separate arrays.
     The pre-revert model here was accurate — reintroduce it.

2. **Retire the `gen/quest_log.md` reference.** §1 boot step 3, and pointers in §2/§8/§9, describe
   `gen/quest_log.md` as a "pre-computed quest dashboard, read-only, auto-generated" — this is now
   stale: PR 2 of this stack deleted the generator (`generate_quest_log.py`) because it was broken
   against the new schema, and hosted chat's real replacement (`renderQuestContext()`) only exists
   in the TypeScript runtime — BYOB has no equivalent to fall back on. **This is the one part of
   this PR that isn't a pure rename — it needs Akash's actual call, not just his sign-off on
   wording.** Options to bring to him: (a) BYOB computes quest streaks/progress itself by reading
   `quests.json`/`progress.json` directly and reasoning about them inline, described in prose
   since BYOB has no code to run the equivalent of `questProgressCounts()`, or (b) something else
   he prefers. Don't pick unilaterally — this is a real behavior gap for BYOB, not a wording
   question.

3. **First Session Protocol, chat runtime.** Cut the old per-question → action-field mapping table
   (confirmed redundant with `coachPrompt.ts`'s own FSP-mode instructions, ~lines 510-547/687-700
   pre-trim, now further trimmed by Part A of this same PR — the mapping is specified there, SOUL
   restating it a third time is exactly the kind of bulk Akash flagged before). Keep only what's
   genuinely SOUL-only content:
   - The actual question wording to ask the athlete (coachPrompt.ts tells Gemini which field to
     fill, not what to say out loud — that's SOUL's job).
   - Coaching judgment not expressible as a schema constraint: ask for the actual birth date, not
     a computed age; infer timezone from city/country and never ask for it directly; the
     fabrication guardrail (an athlete who only said "I run and lift" should not become "runner
     training for a marathon" in Coach's summary) with its worked example.
   - The instruction that native-onboarding-collected facts (name, sports, coaching style —
     confirmed via `onboardingWrites.ts` as exactly these three, nothing else) are already
     recorded before the conversation starts, so Coach references them warmly but never re-asks or
     re-confirms them as new information.
   - Step ordering and tone: warm intro, conversational intake (not a form), confirm back in one
     line, quest setup near the end, transition to plan-or-just-talk.
   - Update the "if history exists, reflect it back instead of asking cold" instruction: this
     becomes real for hosted chat for the first time via PR 3's insights context (previously
     BYOB-only, since hosted chat had no activity-history read path at all before this stack).
     Reference the new Fitness Snapshot section from PR 3, not the old BYOB-only
     `query_history.py` framing, for the chat-runtime version of this instruction.
   - **Open design question, not decided here** (carried over from the earlier draft): does the
     chat runtime need its own fully separate question-script section, or can it share the
     question list with the terminal-mode section, with only a short "how this gets recorded"
     delta (terminal: write files via git; chat: facts commit as you go, already-recorded native
     fields don't get re-asked)? Bring this to Akash as an explicit choice — it changes how §10 is
     structured, not just how it reads. Whichever shape he picks, don't reintroduce the old
     67-line duplicate-question-script version — that's the specific thing that prompted this
     whole revert.

4. **What NOT to add:** no End Conversation button description (that's a UI affordance, not a
   coaching behavior — Coach doesn't need to know the button exists, it just makes `closeIntent`
   true the same way a typed close phrase does). No restating of the Gemini schema's enum values
   anywhere in SOUL — that's `coachPrompt.ts`'s job (Part A of this PR already trims it there). No
   new sections beyond what's needed to make existing sections accurate again.

5. **Move the validator and its baseline together with the SOUL text.** Found during PR 2/3
   review: `platform/validate-soul-baseline.json` still records `generate_quest_log.py` and
   `gen/quest_log.md`, and `platform/scripts/validate-soul.mjs` still has quest-log-specific
   rules/comments (e.g. the "Never edit `gen/quest_log.md`" pattern-match exception). Both must be
   updated in this same PR, alongside item 2's SOUL text change — if the baseline or validator
   lags the SOUL edit even by one PR, `validate-soul` either false-flags the new text or keeps
   silently checking for content that's no longer there. Source (`B_engine.md`), composed builds,
   and baseline change together, one commit. Note: `validate-soul` is currently blocked entirely
   by a separate pre-existing issue (#424 — `coachWrites.ts` no longer exports the `*_PATH`
   constants the validator's reader expects) — that's not this PR's problem to fix, but don't let
   it hide a baseline/rule mismatch this PR introduces; check the validator's logic by reading it,
   not by trusting a green run.

### Process

1. Write the actual proposed section text (all of the above) as a diff or side-by-side against the
   current `platform/soul/B_engine.md`, in the PR description — not committed to `platform/soul/`
   yet.
2. Get Akash's explicit sign-off on: the §10 shape question (item 3's open question) and the
   `gen/quest_log.md` replacement approach (item 2) — these are the two real judgment calls in
   this PR, not wording nits.
3. Once approved: edit `platform/soul/B_engine.md` only (confirmed the only layer file that needs
   to change — `A_identity.md`/`C_athlete.md` are untouched by any of this), run
   `node platform/scripts/compose-soul.mjs`, verify with `--check`.
4. Add a `docs/eng-docs/SOUL_HISTORY.md` entry (next version after whatever #435's revert entry
   ended up as) describing what caught up, and honestly, that the chat FSP section shrank because
   most of its old content was redundant with `coachPrompt.ts`.

### Verification for Part B

- `node platform/scripts/compose-soul.mjs --check` clean.
- `cd ui && npx tsc --noEmit` clean — this PR's Part B is SOUL-only, no code change expected here
  beyond what Part A already made.
- Live scratch-branch test: a full first session and a few days of ordinary chat, on **both** BYOB
  and hosted chat, confirming both runtimes ask the right questions, record facts correctly, and
  (BYOB specifically) handle quest streaks correctly under whatever replacement item 2 settled on.

---

## PR

Branch off PR 3's tip (or #435's, per the topology note at the top). Title something like `core:
trim coachPrompt.ts and rebuild SOUL for the ledger + FSP redesign`. Body: Part A's per-field trim
log, Part B's proposed section text with the two open design questions called out explicitly for
Akash. Leave open — do not merge without his review, same as every PR in this stack.

## After this merges

The whole stack (`#435` → part 8 → part 9 → part 10 → this PR) should leave both BYOB and hosted
chat working correctly for a brand-new athlete's first session and an existing athlete's ordinary
chat, and the webapp dashboard rendering correctly against a migrated repo (part 9's fix). Confirm
all of that end to end before considering the stack done.
