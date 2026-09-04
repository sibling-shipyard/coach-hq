---
name: codebase-atlas
description: Regenerate the Coach Phelps HQ architecture atlas — docs/eng-docs/architecture-atlas.md plus the published interactive isometric HTML artifact — from a fresh scan of the repo. Tech-Lead-only (per AGENTS.md multi-agent routing — not for Coach Phelps, Bob the Builder, UI Expert, or iOS Builder). Use when the athlete asks to "regenerate the atlas", "update the codebase atlas", "refresh the architecture atlas", "rebuild the isometric map", or after a subsystem is added, removed, or a data flow changed meaningfully and the existing atlas would read as stale.
---

# Codebase Atlas

One fresh scan, two deliverables that must stay in sync with each other:

1. `docs/eng-docs/architecture-atlas.md` — short, greppable subsystem inventory + two Mermaid flow
   diagrams. This is what a future Tech Lead session actually reads for orientation — agents read
   files, not rendered HTML.
2. The published isometric HTML artifact — the human-facing visual, for walking someone through
   "how does this thing work."

Regenerate both together from the same scan so they never drift apart from each other, even as
the repo itself drifts from both over time.

## When to run this

On demand, Tech Lead's call only — there's no automation. Good triggers: a subsystem was added or
removed, a data flow changed shape (new API, new auth path), or it's been a while and the athlete
asks for a refresh. Not worth running for routine line-count churn; the atlas orients, it doesn't
track deltas precisely.

## Step 1 — Inventory the repo (facts, not guesses)

Spawn an Explore agent (very thorough). Ask it for:
- 15-35 real subsystems: name, a 2-char code (3 only if needed to stay unique or legible — see
  "code collisions" below), key directory/files, one-line what, rough size (`wc -l`, `find | wc -l`),
  and directed talks-to edges with a short payload description.
- 2-3 canonical end-to-end flows.
- Headline stats: total LOC by language, file/test counts, GitHub Actions workflow count, Vercel
  function count, and a deployed-services vs. code-level-roles split.
- External dependencies (LLM provider, GitHub API, HealthKit, etc).

Read the current `docs/eng-docs/architecture-atlas.md` first (if present) and have the agent flag
what's changed since, rather than assuming last time's grouping still fits. Every number in both
deliverables must come from this scan — never invent counts. The first build of this atlas had
several wrong assumptions until a real scan caught them (`user_data/`/`gen/` don't exist at HQ,
the coach backend runs on Gemini not Claude, the athlete's own GitHub repo is the actual database)
— that's the entire reason to rescan instead of hand-editing the old numbers.

## Step 2 — Group into colonies

Cluster subsystems into 5-8 groups by function, not by directory (e.g. "the API tier," not
"everything under `ui/api`"). Current groups: The Soul, The Dashboard, The Coach-Chat API, The
Engine, The iOS App, CI & Governance, The Data Store. Re-derive rather than assuming these still
fit — if the scan shows the shape changed, the grouping should too.

## Step 3 — Update the markdown doc

Follow `kdb/doc-style.md`: plain English, cite real file paths, quoted Mermaid labels
(`id["Label"]`), no semicolons in diagrams. Refresh the subsystem table, the two flow diagrams,
and the headline stats in `docs/eng-docs/architecture-atlas.md`. Bump "Last generated" at the
bottom.

## Step 4 — Rebuild the HTML atlas

Copy `references/atlas-template.html` into your scratchpad. It's a fully working, already-tuned
isometric engine — read it once. It has: hover tooltips showing full names, colony ground-plates
with always-legible top-layer labels (a background chip so a label never disappears behind a
taller neighboring block), arrowed + animated data-flow edges, click-to-pin side panel with
What-it-does/How-it's-built tabs, double-click go-inside drill-down, a forward/back tracer that
flies a one-shot dot from the previously-traced node to the next, and light/dark theming that
defaults to light regardless of system preference. Don't drop or simplify any of it — every piece
earned its place through real user feedback on the first build.

Replace **only**:
- The block between the `DATA` and `PROJECTION` comment markers near the top of the `<script>`
  tag — the `GROUPS`, `STRUCTURES`, `EXTERNALS`, `EDGES`, `TRACE`, `OVERVIEW_WHAT`, `OVERVIEW_HOW`,
  and `READ_IT` variables.
- The `STATS` array further down (topbar stat tiles).
- The `<title>`, the `<svg>` `aria-label`, and the `viewBox` attribute if the grid extents changed.

Leave every CSS rule and every rendering/interaction function untouched — the engine is already
correct and repo-agnostic; it handles 15 or 35 subsystems the same way.

**Layout rules that made the current version work (learned the hard way — don't relitigate):**
- Projection: `x = (gx-gy)*TILE_W`, `y = (gx+gy)*TILE_H - h*H_SCALE`.
- Give every colony at least 1 full grid unit of clearance from its neighbors in both `gx` and
  `gy`. Colony ground-plates are padded 0.28 units past their members' bounding box — two colonies
  whose boxes touch exactly will get a small overlapping corner.
- A tall block's rendered face is bounded by its own footprint in `x`, but by its full height in
  `y` — a short block placed nearby in grid terms can still land inside that region and render
  hidden, even with no literal grid overlap. Before finalizing positions, check any short block
  placed near a tall one, not just literal overlaps.
- Storage/data-store subsystems render as flat slabs (`slab:true`, height ~1.5) — size them
  generously; "there's no database, the repo IS the database" deserves to read as a foundation,
  not a footnote.
- The tallest block should be whatever has the most LOC — the eye should find it first.

## Step 5 — Verify headlessly before publishing

```
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npx --yes playwright screenshot \
  --browser=chromium --viewport-size=1800,1000 "file://<path>/atlas.html" default.png
```

Don't run `playwright install` — the browser is already there. Screenshot at minimum: the default
view, one `#inside=<id>` view, one `#trace=<n>` view, and one with `--color-scheme=dark` (should
still render **light** — that confirms the light-default init script survived the edit). Read each
screenshot back and check for: label collisions, a block hidden behind a taller neighbor's face,
clipped or overlapping colony labels, and orphaned blocks with no edges. Fix and reshoot before
publishing — budget for at least one fix-and-reshoot pass; getting the layout right the first time
is the exception, not the rule.

## Step 6 — Publish

Publish via the Artifact tool, favicon 🗺️. If an existing atlas artifact URL is known — ask the
athlete, or check `Artifact({action:"list"})` — pass it as `url` so this updates in place instead
of creating a new artifact. Update the link in `docs/eng-docs/architecture-atlas.md` if it changed.

## Report back

Short summary: what changed since the last generation (subsystems added/removed, flow changes),
and the two artifact locations (doc path + artifact URL).
