import Foundation

/// Pure heart-rate maths: zone integration and curve decimation.
///
/// Deliberately free of HealthKit and of any I/O — everything here is a function from
/// timestamped samples to numbers, which is what makes it testable without a watch. Per
/// ADR 0027 and `docs/eng-docs/healthkit-richer-signals-lld.md` §2–3.
enum HRAnalysis {

    /// Apple Watch emits workout HR samples roughly every 5s. 60s is a generous multiple —
    /// anything longer is a real dropout, not jitter.
    static let gapThreshold: TimeInterval = 60

    /// Display budget for the sidecar curve. ADR 0020's payload discipline.
    /// Hard bound on the result is `max(streamBudget, 2 * segmentCount)` — see `decimate`.
    static let streamBudget = 200

    /// Coach summaries target five-minute blocks, widening them on long sessions to keep the
    /// payload bounded. Empty-coverage blocks are omitted rather than assigned invented BPM.
    static let effortBlockSeconds: TimeInterval = 5 * 60
    static let effortBlockLimit = 12

    private struct CoveredSlice {
        let start: Date
        let end: Date
        let bpm: Double
        let zone: Int
    }

    // MARK: - Zones

    /// Integrates zone seconds over the full sample set, gap-aware.
    ///
    /// Each sample owns the midpoint interval to its neighbours, clamped to `gapThreshold / 2`
    /// on either side. Elapsed time no sample owns is uncovered and enters no zone. The old
    /// implementation divided duration by sample count, which silently smeared dropouts across
    /// whatever zone the athlete happened to be in.
    ///
    /// Pass the **complete** sample set — never the decimated curve.
    static func integrateZones(
        samples: [(date: Date, bpm: Double)],
        config: HRZoneConfig,
        start: Date,
        end: Date
    ) -> HRZoneResult {
        let elapsed = max(0, end.timeIntervalSince(start))

        guard !samples.isEmpty else {
            return HRZoneResult(zones: zoneDict(config: config, seconds: [0, 0, 0, 0, 0]),
                                uncoveredSeconds: elapsed,
                                coveredSeconds: 0)
        }

        var seconds = [Double](repeating: 0, count: 5)
        var covered: Double = 0

        for slice in coveredSlices(samples: samples, config: config, start: start, end: end) {
            let owned = slice.end.timeIntervalSince(slice.start)
            seconds[slice.zone] += owned
            covered += owned
        }

        // Clamp before differencing: float drift on a long workout could otherwise produce a
        // negative uncovered value, which would break the invariant the tests assert.
        covered = min(covered, elapsed)

        return HRZoneResult(zones: zoneDict(config: config, seconds: seconds),
                            uncoveredSeconds: elapsed - covered,
                            coveredSeconds: covered)
    }

    // MARK: - Effort shape

    /// Summarizes the complete HR sample set into at most 12 elapsed-time blocks.
    ///
    /// The buckets cover workout elapsed time, not the display curve. Median and p90 use every
    /// raw sample whose owned coverage intersects the bucket. Dominant zone is weighted by that
    /// owned coverage, and a bucket with no coverage is left out so gaps stay visible.
    static func effortShape(
        samples: [(date: Date, bpm: Double)],
        config: HRZoneConfig,
        start: Date,
        end: Date
    ) -> [HREffortBlock] {
        let elapsedSeconds = max(0, Int(end.timeIntervalSince(start).rounded()))
        guard elapsedSeconds > 0, !samples.isEmpty else { return [] }

        let nominalCount = Int(ceil(Double(elapsedSeconds) / effortBlockSeconds))
        let blockCount = min(effortBlockLimit, max(1, nominalCount))
        let slices = coveredSlices(samples: samples, config: config, start: start, end: end)
        guard !slices.isEmpty else { return [] }

        var blocks: [HREffortBlock] = []
        for index in 0..<blockCount {
            let blockStart = index * elapsedSeconds / blockCount
            let blockEnd = (index + 1) * elapsedSeconds / blockCount
            var bpmValues: [Double] = []
            var zoneSeconds = [Double](repeating: 0, count: 5)

            for slice in slices {
                let sliceStart = slice.start.timeIntervalSince(start)
                let sliceEnd = slice.end.timeIntervalSince(start)
                let overlapStart = max(Double(blockStart), sliceStart)
                let overlapEnd = min(Double(blockEnd), sliceEnd)
                guard overlapEnd > overlapStart else { continue }

                bpmValues.append(slice.bpm)
                zoneSeconds[slice.zone] += overlapEnd - overlapStart
            }

            let covered = zoneSeconds.reduce(0, +)
            guard covered > 0, !bpmValues.isEmpty else { continue }

            var dominantZone = 0
            for zone in 1..<zoneSeconds.count where zoneSeconds[zone] > zoneSeconds[dominantZone] {
                dominantZone = zone
            }

            blocks.append(HREffortBlock(
                startSeconds: blockStart,
                endSeconds: blockEnd,
                medianBpm: median(bpmValues),
                p90Bpm: percentile90(bpmValues),
                dominantZone: "Zone \(dominantZone + 1)",
                coveredSeconds: Int(covered.rounded())
            ))
        }

        return blocks
    }

    private static func coveredSlices(
        samples: [(date: Date, bpm: Double)],
        config: HRZoneConfig,
        start: Date,
        end: Date
    ) -> [CoveredSlice] {
        let ordered = samples.sorted { $0.date < $1.date }
        let half = gapThreshold / 2

        return ordered.enumerated().compactMap { index, sample in
            let backBoundary: TimeInterval
            if index == 0 {
                backBoundary = min(half, sample.date.timeIntervalSince(start))
            } else {
                backBoundary = min(
                    half,
                    sample.date.timeIntervalSince(ordered[index - 1].date) / 2
                )
            }

            let forwardBoundary: TimeInterval
            if index == ordered.count - 1 {
                forwardBoundary = min(half, end.timeIntervalSince(sample.date))
            } else {
                forwardBoundary = min(
                    half,
                    ordered[index + 1].date.timeIntervalSince(sample.date) / 2
                )
            }

            let sliceStart = max(start, sample.date.addingTimeInterval(-max(0, backBoundary)))
            let sliceEnd = min(end, sample.date.addingTimeInterval(max(0, forwardBoundary)))
            guard sliceEnd > sliceStart else { return nil }

            return CoveredSlice(
                start: sliceStart,
                end: sliceEnd,
                bpm: sample.bpm,
                zone: zoneIndex(for: sample.bpm, config: config)
            )
        }
    }

    private static func median(_ values: [Double]) -> Int {
        let ordered = values.sorted()
        let middle = ordered.count / 2
        let value = ordered.count.isMultiple(of: 2)
            ? (ordered[middle - 1] + ordered[middle]) / 2
            : ordered[middle]
        return Int(value.rounded())
    }

    /// Nearest-rank p90: the smallest observed value at or above the 90th percentile.
    private static func percentile90(_ values: [Double]) -> Int {
        let ordered = values.sorted()
        let rank = max(1, Int(ceil(0.9 * Double(ordered.count))))
        return Int(ordered[rank - 1].rounded())
    }

    /// Zone bucket for one reading. Boundaries are inclusive uppers, matching `HRZoneConfig`.
    ///
    /// Note the boundaries themselves are a known weak point — they are hardcoded in three
    /// places across Swift, Python and TypeScript and only the iOS copy is athlete-editable.
    /// Tracked in #495; out of scope here, which governs integration only.
    private static func zoneIndex(for bpm: Double, config: HRZoneConfig) -> Int {
        let v = Int(bpm)
        if v <= config.zone1Upper { return 0 }
        if v <= config.zone2Upper { return 1 }
        if v <= config.zone3Upper { return 2 }
        if v <= config.zone4Upper { return 3 }
        return 4
    }

    // Built statement by statement rather than as one dictionary literal: a mixed literal of
    // this shape sends Swift's type checker exponential ("unable to type-check in reasonable
    // time"), and the explicit locals cost nothing.
    private static func zoneDict(config: HRZoneConfig, seconds: [Double]) -> [String: HRZoneEntry] {
        let z1 = HRZoneEntry(low: 0, high: config.zone1Upper, seconds: seconds[0])
        let z2 = HRZoneEntry(low: config.zone1Upper + 1, high: config.zone2Upper, seconds: seconds[1])
        let z3 = HRZoneEntry(low: config.zone2Upper + 1, high: config.zone3Upper, seconds: seconds[2])
        let z4 = HRZoneEntry(low: config.zone3Upper + 1, high: config.zone4Upper, seconds: seconds[3])
        let z5 = HRZoneEntry(low: config.zone4Upper + 1, high: nil, seconds: seconds[4])

        var out: [String: HRZoneEntry] = [:]
        out["Zone 1"] = z1
        out["Zone 2"] = z2
        out["Zone 3"] = z3
        out["Zone 4"] = z4
        out["Zone 5"] = z5
        return out
    }

    // MARK: - Gaps

    /// Splits the sample set wherever coverage lapses for longer than `gapThreshold`.
    /// Gaps are never bridged — an interpolated line across a dropout would be inventing data.
    static func segments(
        _ samples: [(date: Date, bpm: Double)]
    ) -> (segments: [[(date: Date, bpm: Double)]], gaps: [(from: Date, to: Date)]) {
        guard !samples.isEmpty else { return ([], []) }
        let ordered = samples.sorted { $0.date < $1.date }

        var segs: [[(date: Date, bpm: Double)]] = []
        var gaps: [(from: Date, to: Date)] = []
        var current: [(date: Date, bpm: Double)] = [ordered[0]]

        for i in 1..<ordered.count {
            let delta = ordered[i].date.timeIntervalSince(ordered[i - 1].date)
            if delta > gapThreshold {
                segs.append(current)
                gaps.append((from: ordered[i - 1].date, to: ordered[i].date))
                current = [ordered[i]]
            } else {
                current.append(ordered[i])
            }
        }
        segs.append(current)
        return (segs, gaps)
    }

    // MARK: - Decimation

    /// Reduces the curve to at most `budget` points using min/max decimation.
    ///
    /// Each time bucket contributes its minimum and maximum sample, emitted in timestamp order,
    /// so the global extremes always survive — on an interval session the peak *is* the signal.
    /// Uniform stride (what PR #162 used) silently drops peaks that fall between strides, and
    /// mean-per-bucket erases intervals outright.
    static func decimate(
        samples: [(date: Date, bpm: Double)],
        start: Date,
        budget: Int = streamBudget
    ) -> (points: [HRPoint], gaps: [HRGap]) {
        let (segs, rawGaps) = segments(samples)
        guard !segs.isEmpty else { return ([], []) }

        let gaps = rawGaps.map {
            HRGap(from: Int($0.from.timeIntervalSince(start).rounded()),
                  to: Int($0.to.timeIntervalSince(start).rounded()))
        }

        // Every segment must keep at least its two endpoints or a covered run vanishes from the
        // curve entirely. That floor is what can push the total past `budget`: with 38 segments
        // the floor alone is 76 points before any proportional share is handed out, and the
        // endpoint re-insertion below can add two more per segment. So the honest bound is
        // `max(budget, 2 * segments)`, and the proportional share is drawn from what is left
        // after the floor rather than from the whole budget — the previous version allocated
        // `max(2, budget * share)` per segment, which overshot to 297 points on a 38-gap workout
        // while the file and the LLD both promised 200.
        let floor = 2
        let reserved = floor * segs.count
        let spare = max(0, budget - reserved)

        let durations = segs.map { seg -> TimeInterval in
            guard let first = seg.first, let last = seg.last else { return 0 }
            return max(last.date.timeIntervalSince(first.date), 1)
        }
        let total = durations.reduce(0, +)

        var points: [HRPoint] = []
        for (i, seg) in segs.enumerated() {
            let share = total > 0 ? durations[i] / total : 1.0 / Double(segs.count)
            let segBudget = floor + Int((Double(spare) * share).rounded(.down))
            points.append(contentsOf: decimateSegment(seg, start: start, budget: segBudget))
        }

        return (points, gaps)
    }

    private static func decimateSegment(
        _ seg: [(date: Date, bpm: Double)],
        start: Date,
        budget: Int
    ) -> [HRPoint] {
        func point(_ s: (date: Date, bpm: Double)) -> HRPoint {
            HRPoint(t: Int(s.date.timeIntervalSince(start).rounded()), bpm: Int(s.bpm.rounded()))
        }

        guard seg.count > budget else { return seg.map(point) }
        guard let first = seg.first, let last = seg.last else { return [] }

        let buckets = max(1, budget / 2)
        let span = max(last.date.timeIntervalSince(first.date), 1)
        let bucketSpan = span / Double(buckets)

        var out: [HRPoint] = []
        var index = 0

        for b in 0..<buckets {
            let upper = first.date.addingTimeInterval(bucketSpan * Double(b + 1))
            var minSample: (date: Date, bpm: Double)?
            var maxSample: (date: Date, bpm: Double)?

            // Last bucket sweeps up any remainder so no sample is silently dropped.
            while index < seg.count, seg[index].date < upper || b == buckets - 1 {
                let s = seg[index]
                if minSample == nil || s.bpm < minSample!.bpm { minSample = s }
                if maxSample == nil || s.bpm > maxSample!.bpm { maxSample = s }
                index += 1
            }

            guard let lo = minSample, let hi = maxSample else { continue }
            if lo.date == hi.date {
                out.append(point(lo))
            } else if lo.date < hi.date {
                out.append(point(lo)); out.append(point(hi))
            } else {
                out.append(point(hi)); out.append(point(lo))
            }
        }

        // Endpoints are load-bearing — a run that does not start and end where it really did
        // misplaces the whole segment. Re-insert by *replacing* the neighbouring point rather
        // than appending, so a segment never exceeds the budget it was allocated.
        if let f = out.first, f.t != point(first).t {
            if out.count >= budget { out[0] = point(first) } else { out.insert(point(first), at: 0) }
        }
        if let l = out.last, l.t != point(last).t {
            if out.count >= budget { out[out.count - 1] = point(last) } else { out.append(point(last)) }
        }

        return out
    }
}
