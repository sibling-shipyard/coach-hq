# Coach redesign review — Part 3: what's untouched, rollout, and open standards questions

> Working doc for review, not a final eng-doc. Source: `docs/plans/coach-schema-redesign.md` +
> `-lld.md` (merged, #380) + `docs/plans/backend-decision.md`.

## Files staying untouched for now

| File | Why it's fine | Change |
|---|---|---|
| `coach/chat_history.json` | ADR 0012, capped at 7 threads, merge race already fixed | `_meta`, drop `ageLabel`/`status`/`dayOffset` |
| `ledger/current_week.json` | already versioned, stable session ids, `updated_by` | `trace_id` added |
| `ledger/plugins.json` | two fields, doesn't grow | none |
| `activities/workout_plans/templates/*.json` | already id-shaped, Coach only reads | `_meta` only |
| `activities/workout_plans/sessions/*.json` | per-day override, already id-shaped | `_meta` only |

"Untouched" turned out to be an assumption worth checking, not a given — per your ask, actual
field-by-field below, same rigor as Parts 1/2.

### `ledger/plugins.json`

```jsonc
{ "enabled": [] }
```
Two fields worth of content, doesn't grow. Nothing to check — confirmed real, matches the table.

### `coach/chat_history.json` — `ChatThread` shape (`chatThreads.ts`)

Reviewed and trimmed — not actually staying untouched, despite the table above.

```jsonc
{
  "id": "th_...", "createdAt": 1723834200000,
  "title": "Morning check-in", "preview": "...",
  "messages": [ { "id": "...", "role": "user", "text": "..." } ]
}
```

- `id`, `title`, `preview`, `messages[]` — real, kept.
- `createdAt` — real, kept, the one field that's actually the source of truth (comment in the
  code: "set once at creation, never overwritten").
- **`ageLabel` — dropped.** Dead twice over: `coachDay.ts`'s `withComputedDayOffsets` overwrites
  it from `createdAt` on every read regardless of what's stored, and separately the UI already
  stopped using it as the primary display — a code comment in `coachChatModel.ts` says the
  relative "D-1"/"D-2" badge it produces "was reported as 'useless' in practice" (athlete feedback)
  and was replaced with a real calendar date. It now only survives as a last-resort fallback for a
  `createdAt` that "shouldn't happen" to be missing.
- **`status` — dropped, per your call.** Confirmed dead in storage: ADR 0012's own amendment says
  a deleted thread is filtered out of the array entirely on write, never soft-marked — so the
  persisted value only ever holds `"active"`. One possible value in storage, same dead pattern as
  `sessions.json`'s `actor` in Part 1.
- **`dayOffset` — dropped, per your question.** It's genuinely used at read time (the "NOW" vs.
  dated badge, `CoachChat.tsx`'s same-day-thread cleanup), but `coachDay.ts` unconditionally
  recomputes it from `createdAt` on every load (`return { ...t, dayOffset, ... }`) — nothing that
  gets written to disk for this field is ever trusted. `createdAt` is the only real source data;
  `dayOffset` becomes a pure derived value computed at serve time, never persisted.
- ADR 0012's own amendment already removed the archive tier entirely ("no archive option
  anywhere — direct instruction") — same instinct as dropping `seasons.json`'s archive folder,
  just already applied here previously.

### `ledger/current_week.json` — root + `week` + `day` + `session` (full contract:
`docs/ref-docs/current-week-contract.md`, Status: Accepted schema v1)

```jsonc
{
  "schema_version": 1, "data_status": "live", "timezone": "Asia/Kolkata",
  "week": {
    "id": "2026-W32", "start_date": "...", "end_date": "...",
    "phase_name": "Build", "block_name": "Capacity without noise",
    "focus": "...", "guardrails": ["..."]
  },
  "coach_read": { "headline": "...", "body": "...", "valid_from": "...", "valid_until": "..." },
  "days": [ { "date": "...", "intent": "train", "coach_note": null, "sessions": [ /* see below */ ] } ],
  "coach_comments": [],
  "updated_at": "...", "updated_by": "coach"
}
```
Session object: `id`, `origin`, `discipline`, `kind`, `title`, `priority`, `status`,
`planned_duration_min`, `planned_load`, `template_id`, `session_file`, `coach_note`,
`original_date`, `completion_activity_ids`.

This was mostly an accepted, owned contract (Tech Lead) with a documented rationale for every
field — not a candidate for the same trim pass as `challenge_v2.json` was. Two real problems
turned up under review, though, not style choices:

**`coach_read.tone`/`confidence`/`evidence_refs` — dropped**, after checking a real live file
(`coach-skanda`, commit `a380c6e`). Not because they're unused — because they duplicate
something better. `tone`/`confidence` ask Coach for a categorical judgment about its own writing,
separate from the writing — but the prose itself (SOUL's whole voice design) already carries tone
and confidence naturally; a redundant structured label is a write cost for something already said.
`evidence_refs` is worse than redundant: it asks Coach to self-assert what backs its claim as a
list of topic strings, when "what's the evidence" should be *computed from real data* (load,
quest progress, activity history) — the current widget code already proves this instinct right,
building its own evidence array from live numbers rather than trusting `evidence_refs`. Evidence
should be derived, not declared.

`valid_from`/`valid_until` — **kept**, confirmed genuinely earning their place by the same real
file: the week ran Mon Aug 3 → Sun Aug 9, but `coach_read.valid_from` was `"2026-08-05"`
(Wednesday) — because Coach's read was written mid-week, after a reset ("first two days got
swallowed by work... reset starting today"). Not redundant with `week.start_date`/`end_date`;
records when *this specific read* became true, which can start partway through the week.

**Real-world usage gap, not a schema question:** that same live file has exactly one content
commit despite being 4 days into its week already (days already past were backfilled in that
one commit, not reconciled day by day). SOUL's Commit Protocol says update this file every
session; actual practice today is closer to "written once at kick-off." Per your direction, this
needs to become a genuine daily update going forward once this file is wired into coach-chat for
real — not just a schema decision, a behavior one. Tracked in Part 6 since it's implementation,
not review-doc scope.

**`week.phase_name` and `week.block_name` directly reference the `phase`/`current_block` concept
Part 2 just removed entirely from `seasons.json`.** This file wasn't touched by this redesign
(hence "staying untouched"), but it's not actually independent of it — once `seasons.json` has no
`phase` or `block`, there's nothing left to populate these two fields with. This is a real
cross-file break, not a hypothetical one: `current_week.json`'s own contract doc says "Known phase
only; do not infer" for `phase_name`, and there'd be no known phase left to reference. Needs
resolving alongside Part 2's phase removal, not treated as a separately untouched file.

### `activities/workout_plans/templates/*.json` / `sessions/*.json`

Deep, hand-authored exercise-physics schema (`phases[].exercises[]` — timing, rest, form cues,
weight progression), governed by its own doc (`propagated/docs/timer-state-machine.md` §7) and
already flagged in `AGENTS.md` as Tech-Lead-authorize-only. Real, but a different subsystem from
the coach-memory/ledger data this redesign is trimming — not going field-by-field here the way
`profile.json`/`quests.json` got trimmed. `_meta` addition per the LLD stands; nothing else to
flag from a necessity-check angle.

**Real open question, not assumed:** does a session file (`sessions/YYYY-MM-DD_<id>.json`) copy
its *whole* template on write, or only the fields that actually differ? If it's a full copy,
that's real duplication (every session file repeats everything unchanged in the template) worth
fixing — but as its own change, not folded into this redesign. This needs an actual look at real
session files in `coach-skanda`/`coach-akash`, not a guess from the schema doc. Flagging as a
concrete next research step, separate from Part 1/2's implementation.

## Rollout order (steps, from the main redesign doc)

```
1. translation layer (no data moves) → 2. Coach's memory writable again (Part 1)
→ 3. quests as rows (Part 2) → 4. send less, summarize more → 5. real database
```

One PR each, one migration script each, applied to both the skeleton (`coach-skeleton`) and
`coach-akash` — no dual-format supporting code, since with two athlete repos a single conversion
script per step is cheaper than maintaining backward compatibility. Confirmed reading the plan:
this is explicit and deliberate, not an oversight — don't build compatibility shims "just in
case."

**Step 4 (size limits, load-on-demand)** — partially pulled forward already, see Part 4's
recommendations #1 and #3 (per-athlete cache tier, windowed `sessions.json` reads land with Part
1 instead of waiting for step 4). What's left genuinely step-4-shaped: measuring the actual
`[coach-chat] Gemini usage: prompt=...` drop once Parts 1/2 are live, and deciding whether further
trimming is worth it based on real numbers rather than assumption.

## Step 5 and `backend-decision.md`

Separate, much bigger research doc — replacing GitHub-as-datastore entirely (one `coach-<user>`
repo per athlete → rows in a shared Postgres/Supabase database). Read it in full: the core
argument is that one-GitHub-repo-per-user isn't how any production app is actually built (it's a
byproduct of the coach originally being a BYO-Claude-Code file-editing agent), and the standard
shape — managed relational DB + dedicated auth provider + object storage for actual binaries, none
of which this app currently needs — is what step 5 would move toward.

**How this redesign relates to that decision:** every file this redesign creates
(`profile.json`/`memory.json`/`sessions.json`/the four ledger files) is explicitly designed to
become one database table later — that's the entire point of sorting by "how often it changes"
instead of by topic. So Parts 1/2 aren't just a data-shape cleanup, they're the concrete
prerequisite that makes `backend-decision.md`'s Supabase move mechanical instead of requiring a
second redesign. Worth internalizing this framing before annotating Parts 1/2 — a field you keep
or cut there is a column you'll live with post-migration too.

## Open industry-standard-comparison questions

Real questions, not settled — flagging for your call since you specifically asked what could be
improved relative to how an app like this is normally built:

1. **Schema versioning.** Every file gets a `version: 1` field per the LLD, but there's no stated
   policy for what happens when it bumps (migrate-on-read? one-time batch migration script per
   version? both?). Standard practice for a system explicitly staging toward a real database is
   migrate-on-read with a fallback batch script — worth deciding now, before there's a `version: 2`
   to actually handle.
2. **`_meta` / audit-trail shape.** `{updated_at, updated_by, trace_id}` on settings/notes files,
   full per-row provenance on history files — this is a reasonable minimal audit trail, roughly
   matching what a real DB migration would want (created_by/updated_by columns, a correlation id).
   One gap: no `created_at` distinct from `updated_at` on the settings files (`profile.json`,
   `quests.json`, etc.) — if "when was this athlete's profile first created" ever matters (analytics,
   support), that's unrecoverable once `updated_at` has been overwritten a few times. Cheap to add
   now, expensive to reconstruct later.
3. **Id generation strategy.** Current LLD examples use human-readable string concatenation
   (`sess_2026-08-16_a1b2`, `pr_morning_routine_2026-08-16`) rather than UUIDs. Fine for a git-
   backed JSON store where readability in a diff matters; worth an explicit note that this changes
   at step 5 (real DB) rather than assuming today's id shape survives the migration unchanged —
   avoids someone building step 5 tooling around ids that were never meant to be permanent keys.
4. **JSON vs. JSONL for history files** — LLD already answers this (plain JSON, not JSONL) with a
   solid rationale (every consumer already parses JSON, JSONL means a new parser per language, git-
   diff niceness stops mattering once git isn't the store). No pushback — this is the right call,
   noted here just so it's visible in the same review pass as everything else.

## Changes I'm flagging for your review
1. Investigate the session-file-template-copy question for real before assuming either answer.
2. Decide a schema-version migration policy before `version: 2` ever happens.
3. Add `created_at` distinct from `updated_at` on settings files now — cheap now, expensive later.
4. Note explicitly (in the LLD or a follow-up ADR) that today's id shape is a git-store convenience,
   not a permanent key format, so step 5 doesn't inherit an assumption nobody meant to make
   permanent.

## Your annotations

(space for your changes)
