import XCTest
@testable import CoachHQ

/// `UsualRowBuilder` is pure, so these cover the median arithmetic and both row-building paths
/// directly, without constructing a whole `ActivityDetailView`.
final class UsualRowBuilderTests: XCTestCase {

    // MARK: - median

    func testMedianOfOddCount() {
        XCTAssertEqual(UsualRowBuilder.median([3, 1, 2]), 2)
    }

    func testMedianOfEvenCountAveragesTheTwoMiddleValues() {
        XCTAssertEqual(UsualRowBuilder.median([1, 2, 3, 4]), 2.5)
    }

    func testMedianOfEmptyIsZero() {
        XCTAssertEqual(UsualRowBuilder.median([]), 0)
    }

    // MARK: - storedRows (server-computed baseline)

    func testStoredRowsIncludesAllThreeMetricsWhenPresent() throws {
        let stored = try JSONDecoder().decode(VsUsual.self, from: Data("""
        { "duration_median_s": 3000, "avg_hr_median": 140, "above_threshold_median_s": 600 }
        """.utf8))

        let rows = UsualRowBuilder.storedRows(
            from: stored,
            currentElapsedTime: 3300,
            currentAverageHeartrate: 150,
            currentHRZones: ["Zone 4": HRZoneEntry(low: 141, high: 160, seconds: 400),
                             "Zone 5": HRZoneEntry(low: 161, high: nil, seconds: 200)]
        )

        XCTAssertEqual(rows.map(\.label), ["Duration", "Avg HR", "Above threshold"])
        XCTAssertEqual(rows[0].deltaLabel, "+10%", "3300 vs 3000 usual = +10%")
        XCTAssertEqual(rows[1].deltaLabel, "+10 bpm", "150 vs 140 usual")
    }

    func testStoredRowsSkipsAMetricWithNoStoredBaseline() throws {
        let stored = try JSONDecoder().decode(VsUsual.self, from: Data("""
        { "duration_median_s": 3000 }
        """.utf8))

        let rows = UsualRowBuilder.storedRows(
            from: stored,
            currentElapsedTime: 3300,
            currentAverageHeartrate: 150,
            currentHRZones: nil
        )

        XCTAssertEqual(rows.map(\.label), ["Duration"])
    }

    func testStoredRowsGatesAboveThresholdBelow30Seconds() throws {
        let stored = try JSONDecoder().decode(VsUsual.self, from: Data("""
        { "above_threshold_median_s": 20 }
        """.utf8))

        let rows = UsualRowBuilder.storedRows(
            from: stored,
            currentElapsedTime: 3300,
            currentAverageHeartrate: nil,
            currentHRZones: ["Zone 4": HRZoneEntry(low: 141, high: 160, seconds: 100)]
        )

        XCTAssertTrue(rows.isEmpty, "20s of usual above-threshold time is noise, not a real baseline")
    }

    // MARK: - cachedRows (on-device fallback)

    private func entry(elapsedTime: Int, averageHeartrate: Double? = nil, daysAgo: Int) -> SyncCacheEntry {
        SyncCacheEntry(
            fileName: "hk_2026-08-\(20 - daysAgo)_\(daysAgo).json",
            name: "Run",
            sportType: "Run",
            startDateLocal: "2026-08-\(String(format: "%02d", 20 - daysAgo))T08:00:00",
            elapsedTime: elapsedTime,
            hasDescription: false,
            averageHeartrate: averageHeartrate
        )
    }

    func testCachedRowsNeedsAtLeastTwoPriorSessionsForDuration() {
        let current = entry(elapsedTime: 3000, daysAgo: 0)
        let onePrior = [entry(elapsedTime: 2800, daysAgo: 1)]

        let rows = UsualRowBuilder.cachedRows(
            allEntries: onePrior + [current],
            currentSportType: current.sportType,
            currentFileName: current.fileName,
            currentElapsedTime: current.elapsedTime,
            currentAverageHeartrate: nil,
            currentHRZones: nil
        )

        XCTAssertTrue(rows.isEmpty, "one prior session is not enough to call anything usual")
    }

    func testCachedRowsFiltersToTheSameSportAndExcludesSelf() {
        let current = entry(elapsedTime: 3000, daysAgo: 0)
        let priorSameSport = [entry(elapsedTime: 2800, daysAgo: 1), entry(elapsedTime: 3200, daysAgo: 2)]
        var otherSport = entry(elapsedTime: 1000, daysAgo: 3)
        otherSport.sportType = "Ride"

        let rows = UsualRowBuilder.cachedRows(
            allEntries: priorSameSport + [otherSport, current],
            currentSportType: current.sportType,
            currentFileName: current.fileName,
            currentElapsedTime: current.elapsedTime,
            currentAverageHeartrate: nil,
            currentHRZones: nil
        )

        XCTAssertEqual(rows.first?.label, "Duration")
        XCTAssertEqual(rows.first?.usualValue, 3000, "median of {2800, 3200}, Ride entry excluded")
    }

    func testCachedRowsOnlyKeepsTheTwentyMostRecentPriorSessions() {
        let current = entry(elapsedTime: 100, daysAgo: 0)
        // 21 prior sessions of varying duration; only the 20 most recent (daysAgo 1...20) count —
        // matching engine/core/vs_usual.py's BASELINE_LIMIT (20).
        let prior = (1...21).map { entry(elapsedTime: $0 * 100, daysAgo: $0) }

        let rows = UsualRowBuilder.cachedRows(
            allEntries: prior + [current],
            currentSportType: current.sportType,
            currentFileName: current.fileName,
            currentElapsedTime: current.elapsedTime,
            currentAverageHeartrate: nil,
            currentHRZones: nil
        )

        // daysAgo 21 (elapsedTime 2100) is the oldest and must be excluded from the median.
        let durationRow = rows.first { $0.label == "Duration" }
        XCTAssertNotNil(durationRow)
        XCTAssertFalse([2100].contains(durationRow!.usualValue))
    }
}
