import XCTest
@testable import CoachHQ

final class SyncedActivityRowCacheTests: XCTestCase {
    func testMatchesActivityIdOnTheCachedPayload() {
        let row = Self.row(id: "AAA")
        let hit = Self.entry(fileName: "hk_2026-08-01_other.json", activityId: "AAA")
        let other = Self.entry(fileName: "hk_2026-08-02_BBB.json", activityId: "BBB")

        XCTAssertEqual(
            row.cacheEntry(in: [other, hit], drafts: [])?.fileName,
            hit.fileName
        )
    }

    func testFallsBackToFilenameContainingTheId() {
        let row = Self.row(id: "AAA")
        let hit = SyncCacheEntry(
            fileName: "hk_2026-08-01_AAA.json",
            name: "Run",
            sportType: "Run",
            startDateLocal: "2026-08-01T08:00:00",
            elapsedTime: 1000,
            hasDescription: false
        )

        XCTAssertEqual(row.cacheEntry(in: [hit], drafts: [])?.fileName, hit.fileName)
    }

    func testResolvesViaJustSyncedDraftFilename() {
        let row = Self.row(id: "AAA")
        let cached = Self.entry(fileName: "hk_2026-08-01_AAA.json", activityId: nil)
        let draft = SyncedActivityDraft(
            activityId: "AAA",
            fileName: "hk_2026-08-01_AAA.json",
            title: "Run",
            sport: "Run",
            start: "2026-08-01T08:00:00",
            durationSeconds: 1000,
            load: 40
        )

        XCTAssertEqual(
            row.cacheEntry(in: [cached], drafts: [draft])?.fileName,
            cached.fileName
        )
    }

    func testReturnsNilWhenNothingMatches() {
        let row = Self.row(id: "AAA")
        let other = Self.entry(fileName: "hk_2026-08-02_BBB.json", activityId: "BBB")
        XCTAssertNil(row.cacheEntry(in: [other], drafts: []))
    }

    private static func row(id: String) -> SyncedActivityRow {
        SyncedActivityRow(
            id: id,
            title: "Run",
            sport: "Run",
            start: "2026-08-01T08:00:00",
            durationSeconds: 1000,
            load: 40
        )
    }

    private static func entry(fileName: String, activityId: String?) -> SyncCacheEntry {
        let activity = Activity(
            name: "Run",
            sportType: "Run",
            startDateLocal: "2026-08-01T08:00:00",
            elapsedTime: 1000,
            movingTime: 1000,
            calories: nil,
            distance: 0,
            totalElevationGain: 0,
            averageHeartrate: nil,
            maxHeartrate: nil,
            hasHeartrate: false,
            hrZones: nil,
            description: nil,
            totalPhotoCount: 0,
            averageSpeed: 0,
            maxSpeed: 0,
            deviceName: nil,
            source: "healthkit",
            activityId: activityId
        )
        return SyncCacheEntry(fileName: fileName, activity: activity, hasDescription: false)
    }
}
