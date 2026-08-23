# HealthKit richer signals — LLD

> Status: Current · Owner: Tech Lead · Verified: 2026-08-23 · ADR: 0027

Drill-down for [`healthkit-richer-signals.md`](healthkit-richer-signals.md). Schemas, algorithms
and merge rules only — rationale lives in the main doc.

## 1. Constants

| Name | Value | Why |
|---|---|---|
| `GAP_THRESHOLD` | 60s | Apple Watch workout HR samples ~5s apart; 60s is a generous multiple |
| `STREAM_BUDGET` | 200 points | ADR 0020's payload discipline. Soft target: the hard bound is `max(200, 2 × segments)`, since every covered run keeps both endpoints or it vanishes from the curve |
| `MORNING_WINDOW` | local 00:00 → 11:00 | covers sleep + wake, excludes training load |
| `STREAM_SCHEMA` / `DAILY_SCHEMA` | 1 | bump forces backfill rewrite |

## 2. Zone integration (full samples, gap-aware)

Input is the complete `[(Date, Double)]` from `fetchHeartRateSamples`, never the decimated
curve. Midpoint integration as in PR #162, with three changes:

1. Each sample's owned interval is clamped to `GAP_THRESHOLD/2` on either side.
2. The last sample extends toward `workoutEnd` by at most `GAP_THRESHOLD/2`.
3. Any elapsed time not owned by a sample accrues to `uncovered_seconds` and enters no zone.

**Invariant:** `Σ zone_seconds + uncovered_seconds == elapsed_time` (±1s rounding). A workout
with a 10-minute sensor dropout reports 600s uncovered, not 600s smeared into Zone 2.

## 3. Stream sidecar — `user_data/activities/streams/<uuid>.json`

```json
{
  "schema_version": 1,
  "generator": "hk-stream/1",
  "activity_id": "8F3A-…",
  "start": "2026-08-14T18:02:11Z",
  "elapsed_seconds": 3600,
  "source_sample_count": 1834,
  "covered_seconds": 3480,
  "uncovered_seconds": 120,
  "gaps": [{ "from": 1420, "to": 1540 }],
  "points": [{ "t": 0, "bpm": 118 }]
}
```

`t` and `gaps` are integer seconds from `start` — an int per point instead of a 25-byte ISO
string is most of why the file stays small. `source_sample_count` and `covered_seconds` let a
reader judge fidelity without refetching HealthKit.

### Downsampling — min/max decimation

1. Split the series at every gap `> GAP_THRESHOLD`. Gaps are never bridged.
2. Reserve 2 points per segment first, then allocate what remains proportional to covered
   duration. Allocating `max(2, budget × share)` per segment instead overshoots — measured at
   297 points on a 38-gap workout against a stated cap of 200.
3. Per segment: divide into `⌊budget/2⌋ ` equal-time buckets; emit each bucket's min and max
   sample **in timestamp order**; collapse to one point when they are the same sample.
4. Always retain each segment's first and last sample.

**Guarantee:** global max and min HR always survive, so an interval session keeps its spikes.

**Rejected:** uniform stride (PR #162's current `downsample` — silently drops peaks between
strides); mean-per-bucket (erases intervals outright); LTTB (prettier curves, no extremum
guarantee — the peak is the signal here, not the aesthetic).

## 4. Daily ledger — `user_data/health/daily/YYYY-MM.json`

```json
{
  "schema_version": 1,
  "timezone": "Europe/London",
  "days": {
    "2026-08-14": {
      "resting_hr": 48,
      "hrv_sdnn_ms": 62,
      "hrv_sample_count": 7,
      "sleep_hours": 7.4,
      "vo2_max": 51.2,
      "generator": "hk-daily/1",
      "updated_at": "2026-08-14T19:40:02Z"
    }
  }
}
```

### Selection rules

| Field | Rule |
|---|---|
| Day key | Athlete-local calendar date (device tz at sync, recorded in `timezone`) |
| `resting_hr` | HealthKit's own daily `restingHeartRate` sample for that local day — **not** an average. Multiple ⇒ earliest in `MORNING_WINDOW` |
| `hrv_sdnn_ms` | **Median** of SDNN samples starting in `MORNING_WINDOW`. Median, not mean — SDNN is right-skewed and noisy. `hrv_sample_count` records n |
| `sleep_hours` | Asleep-state samples **overlapping** the 9pm–8am window, clipped to it. Interval overlap, not `.strictStartDate` |
| `vo2_max` | Samples dated within the local day only. **No backdating** — days without one omit the key |

Zero samples in a window ⇒ `null`, never a whole-day fallback.

### Merge semantics

The three-state distinction is load-bearing:

- **key missing** — this run did not query the signal.
- **`null`** — queried, HealthKit had nothing.
- **value** — queried, found.

A sync reads the existing month file, merges per date key, and writes back. It writes **only
keys it actually queried** and never deletes a key it did not query, so a stream-only or
partial run cannot erase yesterday's sleep. The month file rides the same `commitFiles` tree as
the activities, so a round is atomic.

## 5. Backfill discovery

Separate entry point — `backfillStreams(range:)`, not `syncNewWorkouts`:

1. Query HealthKit over an **explicit** range: oldest `hist/` filename date → now, ignoring
   `syncState.hkLastSynced` entirely.
2. Write `streams/` only. Never writes `hist/`, never advances `hkLastSynced`, never touches
   `ActivityNamer` counters.
3. Skip a workout when its sidecar already carries the current `schema_version` **and**
   `generator`. Version bump ⇒ rewrite. File existence alone is not the test.
4. Commit in chunks of ~50 files; resumable, since step 3 makes every pass idempotent.
5. Match hist file → `HKWorkout` by uuid (ADR 0014). Pre-0014 and Strava-sourced files fall
   back to start-time + duration within 60s, else are skipped and counted in the run summary.

Gated behind an explicit Settings action — never fires on the observer path.
