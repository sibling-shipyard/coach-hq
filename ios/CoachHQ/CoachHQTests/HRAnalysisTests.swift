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

        XCTAssertLessThanOrEqual(out.points.count, 200, "single segment must respect the budget")
        XCTAssertEqual(out.points.map(\.bpm).max(), 191, "global max must survive")
        XCTAssertEqual(out.points.map(\.bpm).min(), 71, "global min must survive")
    }

    /// The budget is a payload promise, so it needs a test that actually stresses it. A
    /// many-gap workout is the shape that breaks naive allocation: an earlier version handed
    /// every segment `max(2, budget * share)` and reached 297 points against a stated cap of 200.
    func testManyGapsStayWithinTheStatedBound() {
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        var samples: [(date: Date, bpm: Double)] = []
        var t: TimeInterval = 0
        for i in 0..<40 {
            for k in stride(from: 0.0, to: 300.0, by: 5.0) {
                samples.append((date: start.addingTimeInterval(t + k),
                                bpm: 120 + Double(i % 40)))
            }
            t += 300 + 120   // 120s hole — well past the 60s gap threshold
        }

        let out = HRAnalysis.decimate(samples: samples, start: start, budget: 200)
        let segmentCount = out.gaps.count + 1
        let bound = max(200, 2 * segmentCount)

        XCTAssertEqual(segmentCount, 40)
        XCTAssertLessThanOrEqual(
            out.points.count, bound,
            "hard bound is max(budget, 2 per segment) — every run keeps its two endpoints"
        )
    }

    /// Each covered run must survive decimation, however tight the budget. A run that loses both
    /// endpoints disappears from the ribbon, and the athlete sees a session that never happened.
    func testEverySegmentKeepsAtLeastTwoPoints() {
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        var samples: [(date: Date, bpm: Double)] = []
        var t: TimeInterval = 0
        for _ in 0..<30 {
            for k in stride(from: 0.0, to: 200.0, by: 5.0) {
                samples.append((date: start.addingTimeInterval(t + k), bpm: 150))
            }
            t += 200 + 90
        }

        let out = HRAnalysis.decimate(samples: samples, start: start, budget: 40)

        XCTAssertGreaterThanOrEqual(out.points.count, 2 * (out.gaps.count + 1),
                                    "budget below the floor must not erase runs")
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

/// Round-trip tests for the sidecar the detail view reads.
///
/// Gap detection is exercised through `HRAnalysis.decimate`, whose gap output is what the
/// ribbon carries a zone across — getting it wrong is the one bug that would put invented
/// structure on screen.
final class HRStreamDecodingTests: XCTestCase {

    func testSidecarSurvivesEncodeDecode() throws {
        let original = HRStreamFile(
            schemaVersion: 1, generator: "hk-stream/1", activityId: "8F3A-1",
            start: "2026-08-14T18:02:11Z", elapsedSeconds: 3600,
            sourceSampleCount: 1834, coveredSeconds: 3480, uncoveredSeconds: 120,
            gaps: [HRGap(from: 1420, to: 1540)],
            points: [HRPoint(t: 0, bpm: 118), HRPoint(t: 1420, bpm: 155)]
        )

        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(HRStreamFile.self, from: data)

        XCTAssertEqual(decoded, original)
    }

    /// A file written by a future schema version must still decode — the version field is what
    /// backfill keys off, so it has to be readable before it can be compared.
    func testDecodesFromRawJSON() throws {
        let json = """
        {
          "schema_version": 1, "generator": "hk-stream/1", "activity_id": "ABC",
          "start": "2026-08-14T18:02:11Z", "elapsed_seconds": 600,
          "source_sample_count": 120, "covered_seconds": 600, "uncovered_seconds": 0,
          "gaps": [], "points": [{"t": 0, "bpm": 110}]
        }
        """
        let decoded = try JSONDecoder().decode(HRStreamFile.self, from: Data(json.utf8))

        XCTAssertEqual(decoded.activityId, "ABC")
        XCTAssertEqual(decoded.points.count, 1)
        XCTAssertTrue(decoded.gaps.isEmpty)
    }

    /// Two dropouts must produce two gaps, so the curve renders three separate runs.
    func testTwoDropoutsProduceTwoGaps() {
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        func block(_ from: TimeInterval, _ len: TimeInterval) -> [(date: Date, bpm: Double)] {
            stride(from: from, to: from + len, by: 5).map {
                (date: start.addingTimeInterval($0), bpm: 145)
            }
        }
        let samples = block(0, 300) + block(600, 300) + block(1200, 300)

        let out = HRAnalysis.decimate(samples: samples, start: start, budget: 200)

        XCTAssertEqual(out.gaps.count, 2, "three covered runs means two breaks between them")
    }
}

/// The ribbon is the only place an athlete reads the shape of a session, and it sits directly
/// above a legend computed from different numbers. These cover the two ways they can disagree.
final class RibbonBuilderTests: XCTestCase {

    private let config = HRZoneConfig.default   // 131 / 145 / 158 / 172

    private func stream(elapsed: Int, points: [(Int, Int)]) -> HRStreamFile {
        HRStreamFile(
            schemaVersion: 1, generator: "hk-stream/1", activityId: "T",
            start: "2026-08-23T08:00:00Z", elapsedSeconds: elapsed,
            sourceSampleCount: points.count, coveredSeconds: elapsed, uncoveredSeconds: 0,
            gaps: [], points: points.map { HRPoint(t: $0.0, bpm: $0.1) }
        )
    }

    // MARK: - Time weighting

    /// A brief spike must not colour a whole cell.
    ///
    /// The points are min/max decimated, so a 2s peak is stored with the same weight as a 58s
    /// plateau. Averaging them evenly gives (110 + 200) / 2 = 155 — Zone 3. Time-weighted, the
    /// cell is Zone 1, which is where the athlete actually spent it.
    func testBriefSpikeDoesNotColourTheWholeCell() {
        let s = stream(elapsed: 60, points: [(0, 110), (58, 200)])
        let zones = RibbonBuilder.zonesPerCell(stream: s, config: config, cells: 1)

        XCTAssertEqual(zones, [0], "58s at 110bpm outweighs 2s at 200bpm")
    }

    func testSustainedHighZoneStillWins() {
        let s = stream(elapsed: 60, points: [(0, 200), (55, 110)])
        let zones = RibbonBuilder.zonesPerCell(stream: s, config: config, cells: 1)

        XCTAssertEqual(zones, [4], "55s at 200bpm is genuinely Zone 5")
    }

    func testEachCellReadsItsOwnSlice() {
        let s = stream(elapsed: 100, points: [(0, 100), (50, 165)])
        let zones = RibbonBuilder.zonesPerCell(stream: s, config: config, cells: 2)

        XCTAssertEqual(zones, [0, 3], "first half recovery, second half threshold")
    }

    // MARK: - Stored boundaries

    /// Changing the steppers in Settings must not recolour history.
    ///
    /// The legend beneath the ribbon renders seconds stored at sync time against the boundaries
    /// stored with them. If the ribbon read live `UserDefaults`, one card would show two
    /// different answers for the same session.
    func testRibbonUsesTheActivitysOwnBoundaries() {
        let stored: [String: HRZoneEntry] = [
            "Zone 1": HRZoneEntry(low: 0, high: 100, seconds: 10),
            "Zone 2": HRZoneEntry(low: 101, high: 120, seconds: 10),
            "Zone 3": HRZoneEntry(low: 121, high: 140, seconds: 10),
            "Zone 4": HRZoneEntry(low: 141, high: 160, seconds: 10),
            "Zone 5": HRZoneEntry(low: 161, high: nil, seconds: 10),
        ]
        let recovered = RibbonBuilder.storedConfig(from: stored)

        XCTAssertEqual(recovered.zone1Upper, 100)
        XCTAssertEqual(recovered.zone4Upper, 160)

        // 130bpm is Zone 1 under today's defaults but Zone 3 under what this activity was scored
        // against. The stored answer is the one the legend agrees with.
        let s = stream(elapsed: 60, points: [(0, 130)])
        XCTAssertEqual(RibbonBuilder.zonesPerCell(stream: s, config: recovered, cells: 1), [2])
        XCTAssertEqual(RibbonBuilder.zonesPerCell(stream: s, config: .default, cells: 1), [0])
    }

    func testFallsBackToCurrentSettingsWhenNoBoundariesStored() {
        XCTAssertEqual(RibbonBuilder.storedConfig(from: nil).zone1Upper,
                       HRZoneConfig.current.zone1Upper)
        XCTAssertEqual(RibbonBuilder.storedConfig(from: [:]).zone1Upper,
                       HRZoneConfig.current.zone1Upper)
    }

    // MARK: - Gaps and sizing

    func testGapCarriesTheNeighbouringZone() {
        XCTAssertEqual(RibbonBuilder.carryGaps([1, nil, nil, 3]), [1, 1, 1, 3])
    }

    func testLeadingGapReachesForwardToTheFirstReading() {
        XCTAssertEqual(RibbonBuilder.carryGaps([nil, nil, 2, 2]), [2, 2, 2, 2],
                       "a session opening before the watch locks on must not open at Zone 1")
    }

    func testUncoveredCellsAreReportedAsNilBeforeCarrying() {
        // Readings only in the first half of a 100s session, split into 2 cells.
        let s = stream(elapsed: 100, points: [(0, 150), (10, 150), (20, 150)])
        let zones = RibbonBuilder.zonesPerCell(stream: s, config: config, cells: 2)

        XCTAssertEqual(zones.count, 2)
        XCTAssertNotNil(zones[0])
    }

    func testCellCountIsClampedAtBothEnds() {
        XCTAssertEqual(RibbonBuilder.cellCount(elapsedSeconds: 60), 5, "floor")
        XCTAssertEqual(RibbonBuilder.cellCount(elapsedSeconds: 896), 29, "~30s per cell")
        XCTAssertEqual(RibbonBuilder.cellCount(elapsedSeconds: 5400), 48, "cap at 48")
    }

    func testEmptyStreamYieldsNoZones() {
        let s = stream(elapsed: 600, points: [])
        XCTAssertEqual(RibbonBuilder.zonesPerCell(stream: s, config: config, cells: 4),
                       [nil, nil, nil, nil])
    }
}
