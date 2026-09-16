# Golden dataset

> Status: Current · Owner: Tech Lead · Verified: 2026-09-16 · ADR: 0007

Sample data for local Home, `/gallery`, `/welcome` and SwiftUI previews. Two layers, split by whether the
consumer cares what "today" is. The decision and its rejected alternatives are ADR 0007; this
doc is the build detail behind it.

## Layers

| Layer | Path | Committed? | Read by |
|---|---|---|---|
| Static | `shared/golden-dataset/*.json` | yes | web `/gallery`, `/welcome`, iOS previews |
| Generated | `shared/golden-dataset/repo-data/*.json` | no, gitignored | `useRepoData.ts` in dev |

Static files are hand-authored in the real `WidgetSnapshotsFile` / `CurrentWeekContract` schemas,
so a schema change fails to typecheck rather than drifting quietly. Frozen dates are fine there —
those consumers never ask what today is.

**`CurrentWeekContract` is a stable widget contract, deliberately decoupled from the backend
schema - the static file's job is to mirror what the adapter actually produces, not to match the
backend one-to-one.** ADR 0042 dropped `planned_load` and root `coach_comments` from the real
`current_week.json` on disk, but `currentWeekAdapter.ts` still hardcodes `planned_load: null` and
`coach_comments: []` for every real athlete's data today rather than widening the widget
contract - a deliberate choice, not an oversight. So the static sample file should carry the same
values a real adapted week does. `planned_load: null` on every session is already correct in this
file. `coach_comments: []` at the root is fixed here - an earlier version fabricated three
realistic-looking comments, a shape no real athlete's data can produce anymore.

The generated layer is rebuilt by `generate-repo-data.mjs` on every `npm run dev` and
`npm run build`. Every date is relative to `Date.now()`, and the randomness is seeded from the
calendar date, so two people running dev on the same day get identical data.
It generates structured `match_history.json` alongside badminton activities, with matching
`history_file` keys. `ui/scripts/build-data.mjs` includes both in the local dashboard snapshot.

## The generator must produce bad weeks, not just good ones

An early version produced perfectly clean data — activity every day, nothing missed. A whole
class of UI states could then never be exercised locally: heatmap gaps, a foundation streak
reset, a stalled milestone, a calisthenics week under floor, an unstarted quest's empty state.

So the generator deliberately emits blackout blocks (one excused, e.g. travel), single-day
misses, a stalled `handstand_free` alongside a progressing `fl_single_leg`, thin calisthenics
weeks, and a `cold-plunge` quest that starts only a few weeks in.

Presence is rolled per week and per day, not slotted per weekday. A fixed weekly template read
as "trains every single day"; probabilities dropped active-day coverage over the 26-week window
from ~84% to ~60% and roughly tripled the heatmap gap count.

## Two constraints that will bite you

**Verify gitignored generated data against a simulated clean checkout.** `git check-ignore` misses
a directory-only pattern when the directory is absent, so a dev tree that already has the folder
passes and only CI fails.

**Route clustering needs a bit-for-bit repeated distance.** `runningLensModel.ts` buckets routes
with `Math.round((distance / 500) * 500)`, which is a no-op — it resolves to the exact distance in
metres, so "close enough" never clusters. The generator's recurring route is therefore a fixed
5120m, not a randomised range. The underlying bug is unfixed and out of scope for fixture work.

**The commitment cube's BELOW-floor styling cannot render on `/`.** It is gated on
`dataMode !== "live"` in `warmHomeSnapshots.ts`, and `Home.tsx` always passes `"live"`. No fixture
can reach it — it is an app-level constraint, not a data gap. It does render on `/gallery`.

## Not in either layer

Marketing copy is not data. It stays in `welcomeCopy.ts`.
