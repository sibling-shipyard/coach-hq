# Agent kit — portable agent operating layer

> Status: Current · Owner: Tech Lead · Verified: 2026-09-02 · ADR: 0036

## Context

HQ's agent setup (routing gate, role docs, ADR discipline, `.githooks` + CI enforcement) works
across Claude Code, Codex, and Cursor, but only lived in this repo. `platform/agent-kit/` extracts
it into a tree installable in any repo, mechanism only — no roster, no routing table content.

## How it works

```mermaid
flowchart LR
  live["HQ's live files<br/>check.sh · boot-cost.mjs · validate_kdb.py<br/>AGENTS.md markers"]
  carve["carve-kit.mjs<br/>platform/agent-kit/carve-kit.mjs"]
  boot["bootstrap/update.sh<br/>platform/agent-kit/bootstrap/"]
  repo["sibling-shipyard/agent-kit<br/>(carve output + bootstrap/, assembled by the operator)"]
  consumer["consumer repo<br/>.agent-kit/"]
  live --> carve --> repo
  boot --> repo
  repo -->|"clone once"| consumer
  consumer -->|"update.sh / --check"| consumer
```

Three tiers (`platform/agent-kit/README.md`):
1. **Invariant** — `.githooks/`, `kdb/scripts/*.py` (minus the HQ-only soul-history guard, stripped
   by `AGENT-KIT:STRIP-START/END` sentinels). Copied once, referenced, never re-synced by marker.
2. **Managed text** — `AGENTS.md` §"How all agents work", `kdb/doc-style.md`, generic
   `.github/CONVENTIONS.md` rules — wrapped in `<!-- AGENT-KIT:START id="..." -->` markers.
   `bootstrap/update.sh` rewrites the marked block from `blocks/<id>.md`, local cache first, else
   `raw.githubusercontent.com/sibling-shipyard/agent-kit/refs/tags/v<VERSION>/blocks/<id>.md`.
3. **Local** — routing table, role docs, ADRs. Owned by the consumer repo, `carve-kit.mjs` never
   touches this tier.

`carve-kit.mjs` writes `../agent-kit` (sibling directory) with `blocks/`, `tools/kdb/`,
`tools/githooks/`, `templates/`. It does **not** copy `platform/agent-kit/bootstrap/` — that ships
straight from HQ's tree. Standing up the real `sibling-shipyard/agent-kit` repo means committing
both: carve output plus `platform/agent-kit/{bootstrap,VERSION,README.md}` verbatim.

## Done when

1. `carve-kit.mjs` produces a tree; `grep -riE 'claude|cursor|codex|antigravity'` over it is empty —
   **verified 2026-09-02**.
2. `bootstrap/update.sh --check` reports drift on a stale marked file, `update.sh` fixes it from the
   local `blocks/` cache, a second `--check` is clean (idempotent) — **verified 2026-09-02**, dogfogged
   into a scratch clone of `coach-skeleton` (a real second repo, local only, nothing pushed).
3. HQ's own `check.sh` and `validate_kdb.py` stayed green at every phase (P1–P6) — no parallel
   enforcement copy existed at any point (ADR 0036).

## Known gap

`update.sh` alone does not stamp a *working* KB in a bare repo. `kdb/scripts/validate_kdb.py` also
needs `kdb/decisions/README.md` (with `gen_adr_index.py`'s index markers) and the role docs it
cross-checks (`.github/agents/`, `kdb/doc-style.md` from the carved block, an issue template) —
none of which `carve-kit.mjs` or `update.sh` stamp today. Confirmed by dogfooding: `validate_kdb.py`
fails loudly (missing-file errors, not a crash) rather than silently passing, so a bare-repo install
is caught, not silently broken. A `carve-kit.mjs --init <target>` step that stamps those files from
`templates/` is the fix; out of scope here.

## Deferred

- Actually creating `sibling-shipyard/agent-kit` and pushing carve output — deliberate operator
  action, athlete's call on timing.
- `carve-kit.mjs --init` to stamp a bare repo's KB scaffold (see Known gap).
- Claude Code plugin + marketplace wrap for `bootstrap/update.sh`.
- Boundary-drift CI check (PR's changed files vs `CODEOWNERS`) — prove `CODEOWNERS` (#780) at HQ
  first.
