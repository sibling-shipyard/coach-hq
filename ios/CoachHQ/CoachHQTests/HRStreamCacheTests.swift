import XCTest
@testable import CoachHQ

final class HRStreamCacheTests: XCTestCase {
    override func tearDown() {
        HRStreamCache.reset()
        super.tearDown()
    }

    func testUnknownUuidIsNotContained() {
        XCTAssertFalse(HRStreamCache.contains("missing"))
        XCTAssertNil(HRStreamCache.lookup("missing"))
    }

    func testStoresHitAndKnownMiss() {
        let stream = Self.sampleStream(id: "hit")
        HRStreamCache.store("hit", stream: stream)
        HRStreamCache.store("miss", stream: nil)

        XCTAssertTrue(HRStreamCache.contains("hit"))
        XCTAssertEqual(HRStreamCache.lookup("hit"), stream)
        XCTAssertTrue(HRStreamCache.contains("miss"), "a 404 must be remembered so reopen skips GitHub")
        XCTAssertNil(HRStreamCache.lookup("miss"))
    }

    func testResetClearsSlots() {
        HRStreamCache.store("hit", stream: nil)
        HRStreamCache.reset()
        XCTAssertFalse(HRStreamCache.contains("hit"))
    }

    func testOnlyNotFoundIsACachedMiss() {
        XCTAssertTrue(
            HRStreamCache.shouldCacheAsMiss(GitHubAPIError.notFound(operation: "Reading stream"))
        )
        XCTAssertFalse(
            HRStreamCache.shouldCacheAsMiss(
                GitHubAPIError.requestFailed(operation: "Reading stream", status: nil, detail: nil)
            )
        )
        XCTAssertFalse(
            HRStreamCache.shouldCacheAsMiss(GitHubAPIError.decodingFailed(operation: "Reading stream"))
        )
        XCTAssertFalse(HRStreamCache.shouldCacheAsMiss(URLError(.timedOut)))
    }

    private static func sampleStream(id: String) -> HRStreamFile {
        HRStreamFile(
            schemaVersion: 1, generator: "hk-stream/1", activityId: id,
            start: "2026-08-14T18:02:11Z", elapsedSeconds: 600,
            sourceSampleCount: 120, coveredSeconds: 600, uncoveredSeconds: 0,
            gaps: [],
            points: [HRPoint(t: 0, bpm: 110)]
        )
    }
}
