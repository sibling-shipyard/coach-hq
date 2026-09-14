# Test-doc style

This governs `test-results/<date>.md`, not a design doc - `kdb/doc-style.md`'s section headings
don't fit an operational log, but the same brevity and plain-English bar applies.

## One skeleton per day

One file per day: `test-results/<YYYY-MM-DD>.md`. Every run that day appends a new `## Run N -
<time>, <what/why>` section to that same file - never a new file per run. Raw JSON keeps landing
under `test-results/raw/<date>/<eval|manual|unit>/` as before; the day-doc is the readable layer on
top of it, not a replacement.

## What every run section states

At minimum, for each test kind that ran (unit / eval / manual / simulation-suite):

- **What ran and why it was selected** - not "everything," name the cases and the reason (diff
  intersects `watched_paths`, no existing coverage, forced full run, etc.).
- **Model/provider**, for any paid section.
- **Pass/fail verdict per case.** A failure always gets a named root cause, `file:line` - never
  just "FAIL."
- **Cost**, on every paid section - call count and real dollar cost next to the model/provider,
  computed from real usage via `ui/scripts/lib/llmPricing.ts`, not an estimate.

The day-doc's last run of the day adds a **Day total** line summing every paid section's cost that
day.

## Template

```markdown
# Test results - <YYYY-MM-DD>

## Run <N> - <HH:MM>, <what this run verifies and why>

**Scope decided:** <cases selected> because <reason>. Skipped <cases> - <reason>.

### Unit suite
<N passed, M failed, Ns>. Raw: `test-results/raw/<date>/unit/vitest-results-<time>.json`

### Live eval - paid, model: <model>, <N> calls, $<cost>
| Transcript | Result | Notes |
|---|---|---|
| <name> | PASS/FAIL | <root cause file:line if FAIL> |

### Manual live-chat - athlete: <name>, repo: <repo>, branch: <branch>, model: <model>, <N> calls, $<cost>
<turn-by-turn or summary, PASS/FAIL each>

### Simulation suite - paid, model: <model>, <N> calls, $<cost>
| Scenario | Result | Notes |
|---|---|---|

**Run cost:** $<sum of this run's paid sections>. **Day total so far:** $<sum of every run today>.
```

Not every run touches every kind - include only the sections that actually ran. A run with no paid
section has no cost line to add.
