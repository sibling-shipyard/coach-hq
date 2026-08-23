import XCTest
@testable import CoachHQ

/// The repo's first unit tests.
///
/// `HRAnalysis` is deliberately pure — no HealthKit, no I/O — so the maths that decides zone
/// seconds and the display curve can be checked without a watch or a device. Everything below
/// runs on synthetic samples.
final class HRAnalysisTests: XCTestCase {

    private let config = HRZoneConfig.default
    private let start = Date(timeIntervalSince1970: 1_700_000_000)

    /// Samples every `every` seconds over `seconds`, at a fixed bpm.
    private func samples(
        from offset: TimeInterval,
        seconds: TimeInterval,
        bpm: Double,
        every: TimeInterval = 5
    ) -> [(date: Date, bpm: Double)] {
        stride(from: offset, to: offset + seconds, by: every).map {
            (date: start.addingTimeInterval($0), bpm: bpm)
        }
    }

    // MARK: - The invariant

    /// Σ zone_seconds + uncovered_seconds == elapsed_time. This is the whole reason the
    /// integration is gap-aware, so it is checked against a deliberate dropout rather than
    /// against the easy full-coverage case.
    func testZonesPlusUncoveredEqualsElapsedWithDropout() {
        let elapsed: TimeInterval = 1800
        let end = start.addingTimeInterval(elapsed)

        // 0–600s covered, 600–1200s sensor dropout, 1200–1800s covered.
        var s = samples(from: 0, seconds: 600, bpm: 140)
        s += samples(from: 1200, seconds: 600, bpm: 150)

        let result = HRAnalysis.integrateZones(samples: s, config: config, start: start, end: end)
        let total = result.zones.values.reduce(0) { $0 + $1.seconds } + result.uncoveredSeconds

        XCTAssertEqual(total, elapsed, accuracy: 1.0,
                       "zone seconds plus uncovered must account for every second of the workout")
    }

    /// A ten-minute dropout must report as uncovered, not accrue to whichever zone the athlete
    /// was in when the sensor cut out. That smearing is the bug this replaces.
    func testDropoutIsUncoveredNotSmearedIntoAZone() {
        let elapsed: TimeInterval = 1800
        let end = start.addingTimeInterval(elapsed)

        var s = samples(from: 0, seconds: 600, bpm: 140)
        s += samples(from: 1200, seconds: 600, bpm: 140)

        let result = HRAnalysis.integrateZones(samples: s, config: config, start: start, end: end)

        // The 600s hole, minus the half-threshold each neighbouring sample reaches into it.
        XCTAssertEqual(result.uncoveredSeconds, 540, accuracy: 5.0)
        XCTAssertLessThan(result.coveredSeconds, elapsed)
    }

    func testFullCoverageLeavesAlmostNothingUncovered() {
        let elapsed: TimeInterval = 600
        let end = start.addingTimeInterval(elapsed)
        let s = samples(from: 0, seconds: elapsed, bpm: 150)

        let result = HRAnalysis.integrateZones(samples: s, config: config, start: start, end: end)

        XCTAssertEqual(result.uncoveredSeconds, 0, accuracy: 5.0)
        XCTAssertEqual(result.zones["Zone 3"]?.seconds ?? 0, elapsed, accuracy: 10.0,
                       "150bpm sits in Zone 3 for the default boundaries")
    }

    func testNoSamplesMeansWhollyUncovered() {
        let elapsed: TimeInterval = 900
        let result = HRAnalysis.integrateZones(
            samples: [], config: config, start: start, end: start.addingTimeInterval(elapsed)
        )

        XCTAssertEqual(result.uncoveredSeconds, elapsed, accuracy: 0.001)
        XCTAssertEqual(result.coveredSeconds, 0, accuracy: 0.001)
        XCTAssertEqual(result.zones.values.reduce(0) { $0 + $1.seconds }, 0, accuracy: 0.001)
    }

    /// Uncovered must never go negative on a long workout — float drift across thousands of
    /// samples is exactly where that would show up.
    func testUncoveredNeverGoesNegativeOnALongWorkout() {
        let elapsed: TimeInterval = 14_400  // 4 hours
        let end = start.addingTimeInterval(elapsed)
        let s = samples(from: 0, seconds: elapsed, bpm: 135, every: 1)

        let result = HRAnalysis.integrateZones(samples: s, config: config, start: start, end: end)

        XCTAssertGreaterThanOrEqual(result.uncoveredSeconds, 0)
        XCTAssertLessThanOrEqual(result.coveredSeconds, elapsed)
    }

    // MARK: - Decimation

    /// The peak is the signal on an interval session. A single spike buried in otherwise flat
    /// data must survive the reduction to 200 points — this is what uniform stride loses.
    func testGlobalMaxAndMinSurviveDecimation() {
        var s = samples(from: 0, seconds: 3600, bpm: 140, every: 2)
        s[900] = (date: s[900].date, bpm: 191)   // lone spike
        s[1400] = (date: s[1400].date, bpm: 71)  // lone trough

        let out = HRAnalysis.decimate(samples: s, start: start, budget: 200)

        XCTAssertLessThanOrEqual(out.points.count, 220, "budget plus retained endpoints")
        XCTAssertEqual(out.points.map(\.bpm).max(), 191, "global max must survive")
        XCTAssertEqual(out.points.map(\.bpm).min(), 71, "global min must survive")
    }

    func testDecimatedPointsAreInTimestampOrder() {
        let s = samples(from: 0, seconds: 3600, bpm: 145, every: 2)
        let out = HRAnalysis.decimate(samples: s, start: start, budget: 200)

        XCTAssertEqual(out.points.map(\.t), out.points.map(\.t).sorted(),
                       "a chart reading these in order must not see time run backwards")
    }

    func testShortSampleSetIsReturnedWhole() {
        let s = samples(from: 0, seconds: 60, bpm: 130, every: 5)
        let out = HRAnalysis.decimate(samples: s, start: start, budget: 200)

        XCTAssertEqual(out.points.count, s.count, "nothing to decimate below the budget")
        XCTAssertTrue(out.gaps.isEmpty)
    }

    // MARK: - Gaps

    func testGapIsReportedAndNeverBridged() {
        var s = samples(from: 0, seconds: 300, bpm: 140)
        s += samples(from: 900, seconds: 300, bpm: 140)  // 600s hole

        let out = HRAnalysis.decimate(samples: s, start: start, budget: 200)

        XCTAssertEqual(out.gaps.count, 1)
        XCTAssertEqual(out.gaps.first?.from ?? 0, 295, accuracy: 5)
        XCTAssertEqual(out.gaps.first?.to ?? 0, 900, accuracy: 5)
    }

    func testJitterUnderThresholdIsNotAGap() {
        var s = samples(from: 0, seconds: 300, bpm: 140)
        s += samples(from: 340, seconds: 300, bpm: 140)  // 40s hole, under the 60s threshold

        let out = HRAnalysis.decimate(samples: s, start: start, budget: 200)

        XCTAssertTrue(out.gaps.isEmpty, "normal sample jitter must not read as a dropout")
    }

    func testUnorderedSamplesAreSortedBeforeIntegration() {
        let end = start.addingTimeInterval(600)
        let ordered = samples(from: 0, seconds: 600, bpm: 150)
        let shuffled = ordered.shuffled()

        let a = HRAnalysis.integrateZones(samples: ordered, config: config, start: start, end: end)
        let b = HRAnalysis.integrateZones(samples: shuffled, config: config, start: start, end: end)

        XCTAssertEqual(a.coveredSeconds, b.coveredSeconds, accuracy: 0.001)
        XCTAssertEqual(a.uncoveredSeconds, b.uncoveredSeconds, accuracy: 0.001)
    }

    // MARK: - Sidecar encoding

    func testStreamFileEncodesSnakeCaseKeys() throws {
        let file = HRStreamFile(
            schemaVersion: 1, generator: "hk-stream/1", activityId: "ABC-123",
            start: "2026-08-14T18:02:11Z", elapsedSeconds: 3600,
            sourceSampleCount: 1834, coveredSeconds: 3480, uncoveredSeconds: 120,
            gaps: [HRGap(from: 1420, to: 1540)], points: [HRPoint(t: 0, bpm: 118)]
        )

        let data = try JSONEncoder().encode(file)
        let json = String(decoding: data, as: UTF8.self)

        XCTAssertTrue(json.contains("\"schema_version\""))
        XCTAssertTrue(json.contains("\"activity_id\""))
        XCTAssertTrue(json.contains("\"uncovered_seconds\""))
        XCTAssertTrue(json.contains("\"source_sample_count\""))
    }
}
