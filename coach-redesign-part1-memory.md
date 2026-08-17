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

Holds only values that change very rarely or never — Coach's read-only input about who the
athlete is. Filled entirely during First Session Protocol (see the new Part 5 doc for how FSP
itself changes).

```jsonc
{
  "coach_since": "2026-03-14",
  "name": "Akash",
  "dob": "1993-05-14",
  "timezone": "Asia/Kolkata"
}
```

**Input:** written once during First Session Protocol (`profile_update`, Part 2's action table),
rarely revised after. **Output:** read every turn, replaces `state.md`'s Athlete Profile +
Equipment sections + `coach_since` (currently in `challenge_v2.json`).

**Field-by-field necessity check** (per your ask — not accepting this verbatim):
- `version`, `_meta` — dropped. Not required on a file this static.
- `coach_since`, `name`, `timezone` — directly used today (state.md Athlete Profile), keep.
- `sports`, `goal`, `timeline`, `coaching_style` — moved to `memory.json` below. Don't fit
  "rarely changes" the way `name`/`timezone` do, and there's no better-fitting bucket yet.
- `age` → replaced with `dob`. Get the date of birth so age can be derived/incremented
  automatically in the backend — also opens the door to a "happy birthday" message (P2, not
  required now). Confirmed via grep: neither `age` nor `height_cm`/`weight_kg`/`equipment` are
  read anywhere in `coachPrompt.ts` or SOUL today.
- `height_cm`, `weight_kg` — dropped, unused (see grep above). Re-add if something actually needs
  them.
- `equipment` — dropped. Changes too often to be a settings-tier field; needs a home elsewhere
  once it's actually wired up to workout customization.
- Missing from the LLD but arguably belongs here: **the `#362` fix already merged** — the
  completion gate now only requires `name`/`sport`/`goal` (`REQUIRED_PROFILE_FIELDS` in
  `coachChatFiles.ts`), not every field. `profile.json`'s own "is this athlete onboarded" check
  should match that reduced set exactly, not silently re-require everything the LLD lists as
  fields — worth stating explicitly in the schema doc so this doesn't regress. Note `sport`/`goal`
  now live in `memory.json`, so this check needs to read across both files.

## `memory.json` — proposed shape

```jsonc
{
  "version": 1,
  "_meta": { "...": "" },
  "sports": ["badminton", "strength"],
  "goal": "string",
  "timeline": "string",
  "coaching_style": "string",
  "notes": {
    "fitness_baseline":           { "text": "...", "updated_at": "...", "trace_id": "..." },
    "coaching_priorities":        { "text": "...", "updated_at": "...", "trace_id": "..." },
    "learned_patterns.training":  { "text": "...", "updated_at": "...", "trace_id": "..." },
    "learned_patterns.nutrition": { "text": "...", "updated_at": "...", "trace_id": "..." },
    "learned_patterns.mental":    { "text": "...", "updated_at": "...", "trace_id": "..." }
  },
  "injury_flags": [
    { "id": "inj_...", "text": "...", "status": "active", "opened_at": "...", "resolved_at": null }
  ],
  "rpe_calibration": [ { "rpe": 7, "anchor": "..." } ]
}
```

- `sports`, `goal`, `timeline`, `coaching_style` — moved here from `profile.json` (see that
  section's annotation). Still written once at First Session Protocol, just not settings-tier.

**Input:** `memory_update {label, text}` — one new Gemini schema field, one action per report,
replaces exactly one labelled box. **Output:** read every turn (all of it, until Part 4's windowed-
read idea is scoped) or on close only, depending on what Part 4's size-tier research lands on.

**Field-by-field necessity check:**
- The five remaining fixed labels map directly to `state.md`'s existing sections (Fitness
  Baseline, RPE, Priorities, Learned Patterns ×3) — no invented structure, keep as-is.
- `injury_flags` pulled OUT of the flat labelled-box `notes` list into its own structured array
  above. The LLD's own Part 3 (main redesign doc) flags this too: injury flags aren't a fixed
  block of prose you replace wholesale, they're a set of individual items with
  **open/resolved/updated** semantics (an athlete can have 2 active flags, resolve 1, add 1 more —
  replacing the whole label text loses the ability to reason about them individually). Not a
  `memory_update` label at all now — its own `{id, text, status, opened_at, resolved_at}` shape.
  Doing this now avoids a second migration once someone notices the free-text version can't answer
  "what injuries are currently active" without an LLM re-reading a paragraph.
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
- `type: "chat" | "phase_close" | "week_close" | "manual"` — shipping with just `"chat"` live;
  the other three values stay reserved-but-unused in the type rather than building phase/week-close
  writers now. Only `"chat"` has an actual writer today.
- `thread_id` — `null` for anything that isn't a chat, per the LLD. Fine as specified.
- Reads should pull the last-N window, not the whole growing log — pulling Part 4's windowed-read
  idea into this step rather than deferring it.

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

## Open questions for the next pass
- `sports`/`goal`/`timeline`/`coaching_style` now live in `memory.json` but aren't really
  "notes" like the other five labels — revisit if a better-fitting bucket emerges.
- `equipment` has no home yet — dropped from `profile.json`, not yet placed anywhere. Revisit
  once it's wired to workout customization.
- See Part 5 (new doc) for how First Session Protocol changes to write these files in their new
  shape, plus Akash's SOUL changes.
