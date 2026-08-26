import XCTest
@testable import CoachHQ

final class TimelineBufferTests: XCTestCase {
    private static let referenceDate = Date(timeIntervalSince1970: 1_800_000_000)

    private var fileURL: URL!
    private var buffer: TimelineBuffer!

    override func setUp() {
        super.setUp()
        fileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("timeline-\(UUID().uuidString).json")
        buffer = TimelineBuffer(fileURL: fileURL, now: { Self.referenceDate })
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: fileURL)
        buffer = nil
        fileURL = nil
        super.tearDown()
    }

    func testBufferKeepsNewestTwoHundredEvents() {
        for index in 0..<250 {
            buffer.addEvent(category: "test", message: "Event \(index)")
        }

        let events = buffer.getEvents()
        XCTAssertEqual(events.count, TimelineBuffer.eventLimit)
        XCTAssertEqual(events.first?.message, "Event 50")
        XCTAssertEqual(events.last?.message, "Event 249")
    }

    func testPersistedBufferStaysWithinByteLimit() {
        for index in 0..<40 {
            buffer.addEvent(
                category: "large",
                message: "\(index)-" + String(repeating: "x", count: 12_000),
                metadata: ["detail": String(repeating: "y", count: 2_000)]
            )
        }

        XCTAssertLessThanOrEqual(buffer.persistedSizeBytes, TimelineBuffer.byteLimit)
        XCTAssertTrue(buffer.getEvents().last?.message.hasPrefix("39-") == true)
    }

    func testExpiredEventsAreRemovedFromDisk() {
        buffer.addEvent(
            category: "test",
            message: "old",
            timestamp: Self.referenceDate.addingTimeInterval(-TimelineBuffer.ageLimit - 1)
        )
        buffer.addEvent(category: "test", message: "recent", timestamp: Self.referenceDate)

        let reloaded = TimelineBuffer(fileURL: fileURL, now: { Self.referenceDate })
        XCTAssertEqual(reloaded.getEvents().map(\.message), ["recent"])
    }

    func testEventsPersistAcrossBufferInstances() {
        let operationID = UUID()
        buffer.addEvent(
            category: "healthkit.sync",
            message: "finished",
            operationID: operationID,
            metadata: ["outcome": "success", "count": "2"]
        )

        let reloaded = TimelineBuffer(fileURL: fileURL, now: { Self.referenceDate })
        XCTAssertEqual(reloaded.getEvents().first?.operationID, operationID)
        XCTAssertEqual(reloaded.getEvents().first?.metadata["count"], "2")
    }

    func testSignOutClearsMemoryAndPersistedTimeline() {
        buffer.addEvent(category: "test", message: "private account event")
        XCTAssertTrue(FileManager.default.fileExists(atPath: fileURL.path))

        buffer.clearOnSignOut()

        XCTAssertTrue(buffer.getEvents().isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: fileURL.path))
        XCTAssertEqual(TimelineBuffer(fileURL: fileURL, now: { Self.referenceDate }).getEvents(), [])
    }
}

final class DiagnosticsScrubberTests: XCTestCase {
    func testDeepScrubberRedactsNestedCredentialsAndSensitiveKeys() throws {
        let githubToken = "ghp_" + String(repeating: "a", count: 40)
        let geminiKey = "AIza" + String(repeating: "B", count: 35)
        let jwt = "Bearer eyJheader.payload.signature"
        let input: [String: Any] = [
            "safe": "kept",
            "nested": [
                "Authorization": githubToken,
                "items": ["prefix \(geminiKey) suffix", ["token": jwt]]
            ]
        ]

        let output = DiagnosticsScrubber.scrub(input)
        let nested = try XCTUnwrap(output["nested"] as? [String: Any])
        XCTAssertEqual(output["safe"] as? String, "kept")
        XCTAssertEqual(nested["Authorization"] as? String, "[Filtered]")
        XCTAssertFalse(String(describing: output).contains(githubToken))
        XCTAssertFalse(String(describing: output).contains(geminiKey))
        XCTAssertFalse(String(describing: output).contains("eyJheader.payload.signature"))
    }

    func testPrivateCredentialNamesAreRedactedAsKeys() {
        let output = DiagnosticsScrubber.scrub([
            "GEMINI_API_KEY": "value",
            "SESSION_SECRET": "value",
            "GITHUB_APP_CLIENT_SECRET": "value"
        ])

        XCTAssertEqual(output["GEMINI_API_KEY"], "[Filtered]")
        XCTAssertEqual(output["SESSION_SECRET"], "[Filtered]")
        XCTAssertEqual(output["GITHUB_APP_CLIENT_SECRET"], "[Filtered]")
    }

    func testSafeSentryVerificationRequiresExplicitLaunchArgument() {
        XCTAssertFalse(DiagnosticsManager.shouldSendTestEvent(arguments: ["CoachHQ"]))
        XCTAssertTrue(DiagnosticsManager.shouldSendTestEvent(
            arguments: ["CoachHQ", "--send-sentry-test-event"]
        ))
    }
}
