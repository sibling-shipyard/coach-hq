# Coach redesign review — Part 1: state.md → profile.json + memory.json + sessions.json

> Working doc for review, not a final eng-doc. Source: `docs/plans/coach-schema-redesign-lld.md`
> (merged, #380). This is where you said you want to start.

## Why this file group first

`state.md` is read every turn and nothing writes to it (`coach-chat.ts`'s closing ask is
`coach_note` only — `validUpdates` starts empty). Three files already do the same "recent
continuity" job a different way — `coach_notes.md` (write-only), `rolling_state.json` (last 3,
just added), `state.md`'s own Recent Session Notes (nothing can write it). This step ends that
split for good: `profile.json` (settings), `memory.json` (Coach's free-text notes), `sessions.json`
(the merged log — absorbs all three of the above, plus `archive/phases.md`/`archive/week_plans.md`
if you decide to fold those in too, see open question below).

## `profile.json` — proposed shape

```jsonc
{
  "version": 1,
  "_meta": { "updated_at": "...", "updated_by": "model", "trace_id": "..." },
  "coach_since": "2026-03-14",
  "name": "Akash",
  "timezone": "Asia/Kolkata",
  "sports": ["badminton", "strength"],
  "goal": "string",
  "timeline": "string",
  "coaching_style": "string",
  "age": 33,
  "height_cm": 178,
  "weight_kg": 74,
  "equipment": ["skipping rope", "pilates band"]
}
```

**Input:** written once during First Session Protocol (`profile_update`, Part 2's action table),
rarely revised after. **Output:** read every turn, replaces `state.md`'s Athlete Profile +
Equipment sections + `coach_since` (currently in `challenge_v2.json`).

**Field-by-field necessity check** (per your ask — not accepting this verbatim):
- `coach_since`, `name`, `timezone`, `sports`, `goal`, `timeline`, `coaching_style` — all directly
  used today (state.md Athlete Profile), keep.
- `age`, `height_cm`, `weight_kg` — currently collected in First Session Protocol but I don't see
  them read anywhere in `coachPrompt.ts`'s dynamic text or SOUL's boot sequence beyond the profile
  section itself. Real question for you: are these load-bearing for coaching decisions today, or
  collected-but-unused? If unused, dropping them (or moving to an optional/deferred block) is a
  real simplification, not just less JSON.
- `equipment` — same check: confirm it's actually referenced in workout customization logic
  before keeping it as a top-level required-feeling field.
- Missing from the LLD but arguably belongs here: **the `#362` fix already merged** — the
  completion gate now only requires `name`/`sport`/`goal` (`REQUIRED_PROFILE_FIELDS` in
  `coachChatFiles.ts`), not every field. `profile.json`'s own "is this athlete onboarded" check
  should match that reduced set exactly, not silently re-require everything the LLD lists as
  fields — worth stating explicitly in the schema doc so this doesn't regress.

## `memory.json` — proposed shape

```jsonc
{
  "version": 1,
  "_meta": { "...": "" },
  "notes": {
    "fitness_baseline":           { "text": "...", "updated_at": "...", "trace_id": "..." },
    "coaching_priorities":        { "text": "...", "updated_at": "...", "trace_id": "..." },
    "learned_patterns.training":  { "text": "...", "updated_at": "...", "trace_id": "..." },
    "learned_patterns.nutrition": { "text": "...", "updated_at": "...", "trace_id": "..." },
    "learned_patterns.mental":    { "text": "...", "updated_at": "...", "trace_id": "..." },
    "injury_flags":               { "text": "...", "updated_at": "...", "trace_id": "..." }
  },
  "rpe_calibration": [ { "rpe": 7, "anchor": "..." } ]
}
```

**Input:** `memory_update {label, text}` — one new Gemini schema field, one action per report,
replaces exactly one labelled box. **Output:** read every turn (all of it, until Part 4's windowed-
read idea is scoped) or on close only, depending on what Part 4's size-tier research lands on.

**Field-by-field necessity check:**
- The six fixed labels map directly to `state.md`'s existing sections (Fitness Baseline, RPE,
  Priorities, Learned Patterns ×3, Injury Flags) — no invented structure, keep as-is.
- `injury_flags` living in this flat labelled-box list is the one I'd push back on hardest. The
  LLD's own Part 3 (main redesign doc) flags this too: injury flags aren't a fixed block of prose
  you replace wholesale, they're a set of individual items with **open/resolved/updated**
  semantics (an athlete can have 2 active flags, resolve 1, add 1 more — replacing the whole label
  text loses the ability to reason about them individually). Recommend NOT treating
  `injury_flags` as a `memory_update` label at all — give it its own small structured shape now
  (e.g. `[{id, text, status: "active"|"resolved", opened_at, resolved_at}]`) while the other five
  labels are still free text. Doing this now avoids a second migration once someone notices the
  free-text version can't answer "what injuries are currently active" without an LLM re-reading a
  paragraph.
- `rpe_calibration` staying a hand-edited list (not a `memory_update` target) — agree, it's a
  real small table, not prose. No action needed here now; flagged in the LLD as a "gets its own
  action if that stops being true" — fine to leave exactly as scoped.

## `sessions.json` — proposed shape

```jsonc
{
  "version": 1,
  "rows": [
    {
      "id": "sess_2026-08-16_a1b2",
      "date": "2026-08-16",
      "ts": "2026-08-16T18:42:03Z",
      "type": "chat",
      "text": "what Coach wrote, word for word",
      "actor": "model",
      "trace_id": "abc123",
      "thread_id": "th_..."
    }
  ]
}
```

**Input:** `coach_note` (already shipped, no new field — same principle `rolling_state.json`
already proved). **Output:** last-N window read every turn (see Part 4's windowed-read
recommendation — don't send the whole growing log).

**Field-by-field necessity check:**
- `id`, `date`, `ts`, `text`, `actor`, `trace_id` — all load-bearing (id for dedup/addressing,
  trace_id for the log-correlation the whole redesign is built around). Keep.
- `type: "chat" | "phase_close" | "week_close" | "manual"` — only `"chat"` has an actual writer
  today. Recommend shipping with just `"chat"` live and the other three values reserved-but-unused
  in the type, rather than building phase/week-close writers now — matches your "no rush, add
  fields as needed" instinct. The LLD already suggests checking this ("does `sessions/*.json` copy
  its whole template" is flagged similarly in Part 3) — same treatment here.
- `thread_id` — `null for anything that isn't a chat` per the LLD. Fine as specified.

## The translation layer

New function, `ui/api/coach-chat/_lib/`: `renderCoachContext(storage, tier) → string`. Step 1's
safety bar (per the redesign doc): the rebuilt prompt must come out **character-for-character
identical** to today's `buildDynamicText(stateMd, questLog, ...)` output, proven before any file
actually moves. This is the first real implementation task once you've annotated this doc — it's
pure text-building, testable in isolation via a snapshot diff against today's real prompt output,
no Gemini call needed to verify it.

## What needs to change in SOUL / coach-chat once this lands

- `platform/soul/B_engine.md` §1 step 4 (Boot Sequence: "Read `user_data/coach/state.md`... its
  Recent Session Notes rolling section...") and §12 (Commit Protocol: "Update
  `user_data/coach/state.md`... Update `user_data/coach/coach_notes.md`...") both name files that
  go away. SOUL keeps referring to sections by name Coach already knows ("Recent Session Notes",
  "Learned Patterns"), never by file path — per the redesign doc's own rule — so these sections
  need rewording, not restructuring: same instructions, new file names underneath.
- `platform/scripts/compose-soul.mjs`'s HORCRUXES mechanism (currently just the First Session
  Protocol, injected via `coach-chat.ts`'s `firstSessionContext()` when `isAthleteProfileComplete`
  is false) is the existing pattern for "per-athlete content that can't live in the shared cached
  prefix." Nothing here needs a *new* mechanism — confirms the architecture Akash and the earlier
  session work already built is the right shape for this.
- `coachChatFiles.ts`'s `isAthleteProfileComplete()` — the LLD says this becomes a simple field-
  presence check against `profile.json` once it exists, and the regex/section-matching (plus its
  two comment paragraphs explaining the `(?![\s\S])` flag trick) gets deleted outright. Confirmed
  reading the current code — straightforward, no hidden complexity to preserve.

## Changes I'm flagging for your review
1. **Question `age`/`height_cm`/`weight_kg`/`equipment`** in `profile.json` — confirm they're
   actually read somewhere before keeping them; drop or defer if not.
2. **Give `injury_flags` its own structured shape now**, not a `memory_update` free-text label —
   open/resolved semantics don't fit the "replace one labelled box" mechanic the other five labels
   use.
3. **Ship `sessions.json`'s `type` field with just `"chat"` live** — don't build phase/week-close
   writers as part of this step.
4. **Pull Part 4's windowed-read idea into this step** — don't send the whole `sessions.json` log
   every turn once it exists.

## Your annotations

(space for your changes — go file by file)
