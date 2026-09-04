# D2 — Full validation audit — LLD

> Status: Current · Owner: Tech Lead · Verified: 2026-09-01

Execution detail for D2 in [`chat-commit-redesign.md`](chat-commit-redesign.md). Not deferred —
the athlete's call: validation for the whole repo gets rewritten to be correct, not just the fields
D1's self-correcting mechanism happens to cover. Stacked on D1 (reuses its enforcement machinery
where applicable).

## Scope — every user_data file, not just the ones this pass already touched

D1 fixed the mechanism (dynamic enums, corrective retry, partial commit) for the specific fields
#736 named and this pass's own bugs surfaced (`flag_id`, `quest_id`, the fields already
schema-enforced). This PR is the systematic sweep: every field, in every file under `user_data/`,
gets a real shape/enum check somewhere — CI, applier, or Gemini schema, whichever is the right
layer for that field.

Full file inventory to audit (`user_data/coach/` + `user_data/ledger/`):

| File | Known gaps to close | Coverage after this PR |
|---|---|---|
| `profile.json` | `dob`/`height_cm`/`weight_kg` type checks exist for the coach-chat path only (`applyProfileUpdate`) — **Claude/BYOB direct writes have zero enforcement**, out of D1's scope, in scope here. | CI: `engine/scripts/validate-data-shape.py` checks `dob` (date format), `height_cm`/`weight_kg` (numeric), `name`/`timezone` (string). Applier check unchanged (already existed). |
| `memory.json` | `notes.*` keys beyond `label` enum (already fixed in D1) — check every note's `text`/`updated_at`/`trace_id` shape, not just length. | CI: `validate-data-shape.py` checks each note's `text`/`updated_at`/`trace_id` are strings and `sports` is a string array. |
| `injuries.json` | Flag `id` format/uniqueness — genuinely unenforced anywhere today (the issue's own headline example). `status` enum already schema-enforced; add the applier-level double-check D1's pattern established for other fields. | CI: `validate-data-shape.py` checks `id` is a non-empty, unique string and `status` is a valid enum. Applier: `coachIntents.ts`'s `applyInjuryEvent` now throws on an invalid `status` (same pattern as `applyProfileUpdate`'s field guard). |
| `coach_log.json` | Row shape — depends on C2's resolution; don't duplicate work, coordinate with that LLD once it's finalized. | Deferred to C2, as planned — not touched here. |
| `quests.json` | `Quest.status`, `QuestType`, `polarity` — schema-enforced on the Gemini path only; no applier check, no CI check. `Season.status`'s new `archived`/`completed` values (from B3) need the same coverage once that PR lands. | CI: `validate-data-shape.py` checks `main_quest.type`, `quests[].status`/`.type`/`.polarity`/`.source`. Applier: `coachIntents.ts`'s `applyQuestEvent` now throws on an invalid `status`. B3's `archived` value not added — B3 hasn't landed yet. |
| `seasons.json` | `Season.status` enum (see above), `start_date`/`end_date` real-date-format checks. | CI: `validate-data-shape.py` checks `status` enum and `start_date`/`end_date` (`YYYY-MM-DD`). |
| `progress.json` | `ProgressRow.status`/`source` — `status` schema-enforced on the Gemini path; `source` is server-hardcoded so safe; **non-coach writers (pipeline, athlete-authored) are fully unchecked** — likely CI's job, not an applier's. | CI: `validate-data-shape.py` checks `rows[].status`/`.source` enums — catches non-coach writers. |
| `progressions.json` | Not audited yet in any prior pass — check shape from scratch. | CI: `validate-data-shape.py` checks `id`/`name`/`current`/`target`/`unit` types and `history[].date`/`.value`/`.trace_id` types. |
| `sync_state.json`, `sync_status.json` | Pipeline-owned, not coach-chat's — confirm CI already covers these (likely does, different owner) rather than duplicating. | Confirmed out of scope — no coach-chat check exists or is added; pipeline owns these. |

## Fix, per layer

1. **CI (`validate-data.yml`, both HQ and the carved athlete-repo copy)**: port the shape/enum
   checks that already exist for legacy `challenge_v2.json` (real per-field checks, never carried
   forward when the schema split) onto every file in the table above. This is the layer that also
   catches Claude/BYOB direct writes, since CI runs on the commit regardless of what produced it —
   the only layer that does.
2. **Appliers** (`coachIntents.ts`, `turnWrites/*.ts`): every enum already schema-enforced on the
   Gemini path gets the same applier-level double-check `applyProfileUpdate`/`applyQuestEvent`/
   `applyInjuryEvent` already model — defense in depth, same reasoning as D1.
3. **Gemini schema** (`coachReplySchema.ts`): any field this audit finds that's genuinely
   unconstrained and *should* be an enum (not already covered by D1's dynamic-id-enum work) gets
   one added, following the same pattern.

## Tests

- One test per file in the table above, confirming the new check actually rejects a malformed
  example and accepts a valid one — mirror whatever pattern D1's tests already established.
- CI: a deliberately malformed fixture per file, confirming `validate-data.yml` goes red on it
  (currently nothing in this repo tests the validator itself failing correctly — add that).

## Done when

Every file in the table has a real shape/enum check somewhere in the stack (CI, applier, or
schema), documented in this file's table with which layer covers it. `grep -c` a known-bad fixture
against each file and confirm CI catches it.
