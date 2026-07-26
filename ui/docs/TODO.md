# UI — Follow-up TODOs

## Build-phase widget: milestone display + progression

**Status:** ✅ terse rows shipped · ✅ structured progress schema + progress bars
shipped · ⏳ pipeline-computed ETA (`projected_date`) is the one remaining piece.

### What shipped

The milestone schema (`training/ledger/challenge_v2.json`) now carries two additive,
non-destructive lanes alongside the canonical prose (prose stays — the quest-log
generator still reads it):

- **Display lane** — optional `short_name` / `short_current` / `short_target`
  strings. The widget prefers these, falling back to prose, so rows read as
  concise `short_name · current → target`.
- **Progress lane** — optional `progress` block for milestones that reduce to a
  single scalar: `{ unit, baseline_value, current_value, target_value,
  history[], projected_date? }`. When present the widget renders a progress bar
  + `% THERE` in the hover badge. Bilateral (Front lever, tracked on the
  limiting side) and set×rep (Bar dips, terse-only) goals opt out of the bar
  cleanly — no fabricated single number.

Types live in `ui/client/src/lib/challenge.ts` (`MilestoneProgress`); the widget
is `buildPhaseSnapshot` in
`ui/client/src/components/home-warm/WarmInstrumentHome.tsx` + `BuildPhaseCard`
in `WarmInstrumentWidgets.tsx`; the schema validator is in
`scripts/generate_quest_log.py`.

### Remaining: pipeline-computed ETA (`projected_date`)

The widget already renders a real per-goal ETA when a milestone's
`progress.projected_date` is set — but nothing computes it yet. Per the agreed
design, **Bob's pipeline** computes `projected_date` from `history` + plan
cadence and writes it into `challenge_v2.json`; `validate-data` CI guards it;
the UI just renders. This needs a few more history points per milestone before a
projection is trustworthy. Tracked as a separate pipeline issue.
