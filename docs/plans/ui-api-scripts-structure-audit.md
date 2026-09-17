# ui/api and ui/scripts structure audit

> Status: Plan · Owner: Tech Lead · Created: 2026-09-17

## Context

`ui/api/` and `ui/scripts/` grew organically. Eval fixtures, manual live-LLM test drivers, real
API routes, and shared libs are mixed together with inconsistent naming, several very large
files, and patchy README coverage. I want this to read like a big company's codebase: everything
in its place, names that say what a thing is, and a README wherever a folder is non-trivial.

This doc depends on nothing. `docs/plans/ui-ci-vercel-trigger-scoping.md` depends on the new
`ui/eval/` folder below landing first — its exclude list assumes that folder exists.

## Decision

### 1. New top-level folder: `ui/eval/`

Consolidates everything eval / manual-live-LLM-testing related into one place, separate from both
`ui/api/` (deployed routes) and `ui/scripts/` (build/CI tooling). Move into it:

- `ui/scripts/eval-coach-chat.ts`, `ui/scripts/run-manual-coach-chat-test.ts`,
  `ui/scripts/run-manual-coach-message-test.ts`, `ui/scripts/run-simulation-suite.ts`, and
  `ui/scripts/prefix-cache-probe.ts`.
- `ui/scripts/examples/` (18 manual coach-chat turn fixtures) → `ui/eval/examples/`.
- `ui/api/coach-chat/_tests/coach-chat-eval/transcripts/` (21 scenario transcripts) →
  `ui/eval/transcripts/` — this is the one currently buried inside `ui/api/**`, which is why it
  also matters for the CI/Vercel trigger doc.
- Update every import path these scripts use (`ui/api/coach-chat/_lib/...`,
  `ui/scripts/lib/...`) and the `npm run eval:*` / manual-test script entries in `ui/package.json`.
- Standardize the manual-test-driver naming pattern while moving them:
  `run-manual-coach-chat-test.ts`, `run-manual-coach-message-test.ts`,
  `run-simulation-suite.ts` → pick one convention (proposed: `run-manual-<thing>.ts`,
  so the suite runner becomes `run-manual-simulation-suite.ts`).

**Ownership:** `ui/eval/` becomes vade-the-tester's (testing infrastructure, ADR 0044) rather than
Bob the Builder's — it's eval/testing tooling, not application code. Execution must update the
ownership table in `.github/agents/tech-lead.md` § The Team and `.github/agents/vade-the-tester.md`
§ Scope to add `ui/eval/`.

### 2. `ui/scripts/` reorganization (non-eval tooling)

Once eval material has moved out, group what's left by concern:

- `ui/scripts/build/` — `build-data.mjs`, `build-soul.mjs`, `generate-wi-tokens.mjs`,
  `generate-widget-snapshots.ts`, and the five `bundle-*-api.mjs` esbuild bundlers.
- `ui/scripts/checks/` — `check-coverage-reconciliation.ts`, `check-span-health.mjs`,
  `validate-current-week.mts`.
- `ui/scripts/dev/` — `local-api-server.mjs`.
- `ui/scripts/lib/` stays where it is — already a clear, correctly-scoped name; shared helpers
  plus their `.test.ts` siblings.

Update `ui/package.json` script entries and any cross-references (e.g. `bundle-*-api.mjs`
comments referencing paths) for the new locations.

### 3. Split candidates (production code, ranked by impact)

| File | Lines | Approach |
|---|---|---|
| `ui/api/coach-chat/_lib/coachTurn.ts` | 2682 | Orchestrates decide→apply→commit. `decide/`, `turnWrites/`, and `commit/` already exist as sibling concerns it stitches together — split the orchestration steps into named phase files under `_lib/` instead of one file owning the whole turn. |
| `ui/api/coach-message/_lib/coachMessage.ts` | 1035 | Split proactive-message generation from the write/commit path. |
| `ui/api/_lib/sentry.ts` | 689 | Split after `docs/plans/gemini-to-llm-rename.md` lands, to avoid rebasing both changes on the same file. |
| `ui/api/coach-chat/_lib/decide/coachIntents.ts` | 727 | Split intent-classification logic from decision-application logic. |

Leave `ui/api/auth/[...action].ts` (788 lines) as-is: ADR 0017 requires the catch-all shape to
stay under Vercel's function cap, so the *route* can't be split. Only extract non-routing logic
further into `_lib/` if a natural seam exists.

### 4. Missing READMEs

Add one to each: `ui/api/_lib/`, `ui/api/coach-chat/_lib/decide/`,
`ui/api/coach-chat/_lib/llm/` (renamed per the Gemini rename doc), `ui/api/coach-chat/_lib/commit/`,
`ui/api/coach-chat/_tests/layer2-fields/`, `ui/api/coach-message/`, `ui/scripts/` (describing the
new `build/`/`checks/`/`dev/`/`lib/` split), `ui/eval/`.

### 5. New ADR: script file-extension convention

`ui/scripts/` and `ui/eval/` mix `.ts`, `.mjs`, and `.mts` with no documented rule. This is a
durable, hard-to-reverse repo-wide convention (`kdb/decisions/README.md`'s own test: "a future
agent might re-argue it"), so it gets an ADR, not just a note in this doc. Add
`kdb/decisions/NNNN-script-file-extension-convention.md` codifying: `.mjs` for build-time /
no-type-checking scripts, `.ts`/`.mts` for anything importing typed code or needing
type-checking. Apply it across `ui/scripts/` and `ui/eval/` once written.

### 6. Isolate checked-in build artifacts

`*.bundle.js`/`.d.ts` files in `ui/api/auth/_lib/` and `ui/api/coach-chat/_lib/` sit next to
hand-written source with only a filename suffix telling them apart. Move each folder's bundles
into a `_generated/` subfolder, mirroring the top-level `ui/api/_generated/` pattern already in
place, so they can't be mistaken for source when skimming.

## Out of scope

- Relocating any of these folders outside `ui/` — see `docs/plans/ui-ci-vercel-trigger-scoping.md`.
- Any Gemini/LLM naming — see `docs/plans/gemini-to-llm-rename.md`.

## Verification

1. `bash platform/scripts/check.sh --quiet` passes after the moves.
2. Manual read-through confirming no import paths broke from file moves.
3. `npm run eval:coach-chat` and one manual test driver run successfully from their new
   `ui/eval/` location.
