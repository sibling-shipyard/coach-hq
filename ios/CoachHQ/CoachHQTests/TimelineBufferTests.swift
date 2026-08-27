import XCTest
@testable import CoachHQ

final class TimelineBufferTests: XCTestCase {
    private static let referenceDate = Date(timeIntervalSince1970: 1_800_000_000)

    private var buffer: TimelineBuffer!

    override func setUp() {
        super.setUp()
        buffer = TimelineBuffer(now: { Self.referenceDate })
    }

    override func tearDown() {
        buffer = nil
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

    func testTimelineStaysWithinByteLimit() {
        for index in 0..<40 {
            buffer.addEvent(
                category: "large",
                message: "\(index)-" + String(repeating: "x", count: 12_000),
                metadata: ["detail": String(repeating: "y", count: 2_000)]
            )
        }

        XCTAssertLessThanOrEqual(buffer.attachmentSizeBytes, TimelineBuffer.byteLimit)
        XCTAssertTrue(buffer.getEvents().last?.message.hasPrefix("39-") == true)
    }

    func testExpiredEventsAreDropped() {
        buffer.addEvent(
            category: "test",
            message: "old",
            timestamp: Self.referenceDate.addingTimeInterval(-TimelineBuffer.ageLimit - 1)
        )
        buffer.addEvent(category: "test", message: "recent", timestamp: Self.referenceDate)

        XCTAssertEqual(buffer.getEvents().map(\.message), ["recent"])
    }

    func testEventsCarryOperationIDAndMetadata() {
        let operationID = UUID()
        buffer.addEvent(
            category: "healthkit.sync",
            message: "finished",
            operationID: operationID,
            metadata: ["outcome": "success", "count": "2"]
        )

        let event = buffer.getEvents().first
        XCTAssertEqual(event?.operationID, operationID)
        XCTAssertEqual(event?.metadata["count"], "2")
    }

    func testCredentialsNeverReachTheTimeline() {
        let token = "ghp_" + String(repeating: "a", count: 40)
        buffer.addEvent(
            category: "github.request",
            message: "failed with \(token)",
            metadata: ["Authorization": token]
        )

        let event = buffer.getEvents().first
        XCTAssertEqual(event?.message, "failed with [Filtered]")
        XCTAssertEqual(event?.metadata["Authorization"], "[Filtered]")
    }

    func testSignOutClearsTheTimeline() {
        buffer.addEvent(category: "test", message: "private account event")
        XCTAssertFalse(buffer.getEvents().isEmpty)

        buffer.clearOnSignOut()

        XCTAssertTrue(buffer.getEvents().isEmpty)
        XCTAssertEqual(buffer.attachmentSizeBytes, 0)
    }

    func testConcurrentWritersStayWithinTheCap() {
        let group = DispatchGroup()
        for worker in 0..<8 {
            DispatchQueue.global().async(group: group) {
                for index in 0..<50 {
                    self.buffer.addEvent(category: "test", message: "\(worker)-\(index)")
                }
            }
        }
        XCTAssertEqual(group.wait(timeout: .now() + 30), .success)

        XCTAssertEqual(buffer.getEvents().count, TimelineBuffer.eventLimit)
    }
}
