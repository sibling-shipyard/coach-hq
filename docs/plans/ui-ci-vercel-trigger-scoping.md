# Scope ui-tests.yml and Vercel preview triggers away from non-runtime paths

> Status: Plan · Owner: Tech Lead · Created: 2026-09-17

## Context

Every change under `ui/api/**` or `ui/scripts/**` currently fires both the `ui-tests.yml` GitHub
Actions workflow and a Vercel preview build — even for scripts that never run in CI and are never
deployed. **Depends on `docs/plans/ui-api-scripts-structure-audit.md` landing first**: that doc
moves eval fixtures and manual test drivers out of `ui/api/**` into a new top-level `ui/eval/`,
which is what makes the exclude list below possible to write cleanly.

**Constraint: the Vercel project root directory stays `ui/`.** No physical relocation of
`ui/api`, `ui/scripts`, or `ui/api/auth`. ADR 0011 already named this exact coupling: Vercel's
root directory is `ui/`, and there's no workspace tooling to link a moved folder back in. It
deferred narrowing it to "a future deploy rewire." This doc is that rewire, scoped to path globs
only — never the root directory.

## Decision

### Root cause

`ui-tests.yml` triggers on `paths: ['ui/**', 'engine/lib/**', ...]` — one broad glob with no
distinction between deployed code and non-deployed tooling. `ui/vercel.json`'s `ignoreCommand`
gates on the same broad `ui/**` glob.

### What should keep triggering both pipelines

Any path that changes deployed behavior: `ui/api/**` route handlers, `ui/api/_lib/**`,
`ui/api/auth/**`, `ui/client/**`.

### What should stop triggering a Vercel preview

`ui/scripts/**` (manual/CI-only tooling, never served) and the new `ui/eval/**` (manual/eval
drivers and fixtures, never served), plus doc-only changes within `ui/` (READMEs).

Before the eval-folder move, this couldn't be done cleanly. The eval transcripts sat at
`ui/api/coach-chat/_tests/coach-chat-eval/transcripts/`, nested inside `ui/api/**`. That path has
to stay fully included in both triggers since it's real deployed route code, and you can't
exclude a subfolder of `ui/api/**` without a fragile negative glob. Once those transcripts and
drivers move to `ui/eval/`, the exclude list is simple: two whole top-level folders
(`ui/scripts/**`, `ui/eval/**`) excluded, all of `ui/api/**` and `ui/client/**` included, no
partial-folder globs.

### Lighter check instead of full exclusion

`ui/scripts/lib/**` and `ui/eval/`'s own code have real `.test.ts` files. Split `ui-tests.yml`
into two jobs:

1. **client+api** — gated on `ui/api/**` + `ui/client/**`, full suite.
2. **scripts+eval unit tests** — gated on `ui/scripts/**` + `ui/eval/**`, running just their own
   `.test.ts` files, not the full client build.

### Concrete changes

- `.github/workflows/ui-tests.yml`: split into the two path-scoped jobs above, replacing the
  single broad `ui/**` trigger.
- `ui/vercel.json`'s `ignoreCommand`: add path excludes for `ui/scripts/**` and `ui/eval/**` —
  neither is served, so no preview is needed for changes confined to them.

## Risk

Any future PR that adds a new deployed file under an excluded path silently stops getting
CI/preview coverage. Revisit the exclude list whenever a new top-level folder appears under `ui/`.

## Verification

1. Open a throwaway PR touching only `ui/eval/examples/*.json` — confirm neither the full
   `ui-tests.yml` run nor a Vercel preview fires.
2. Open a second throwaway PR touching `ui/api/coach-chat.ts` — confirm both still fire.
