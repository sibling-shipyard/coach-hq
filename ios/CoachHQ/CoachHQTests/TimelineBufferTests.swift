import XCTest
@testable import CoachHQ

class TimelineBufferTests: XCTestCase {
    override func setUp() {
        super.setUp()
        TimelineBuffer.shared.clearOnSignOut()
    }
    
    override func tearDown() {
        TimelineBuffer.shared.clearOnSignOut()
        super.tearDown()
    }
    
    func testBufferLimits() {
        let buffer = TimelineBuffer.shared
        for i in 0..<250 { buffer.addEvent("Event \(i)") }
        XCTAssertEqual(buffer.getEvents().count, 200)
    }
    
    func testExpiry() {
        let buffer = TimelineBuffer.shared
        buffer.addEvent("Old Event", timestamp: Date().addingTimeInterval(-25 * 60 * 60))
        buffer.addEvent("Recent Event", timestamp: Date())
        let events = buffer.getEvents()
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events.first?.message, "Recent Event")
    }
    
    func testPersistence() {
        let buffer = TimelineBuffer.shared
        buffer.addEvent("Persist Me")
        
        // Re-init from disk
        let buffer2 = TimelineBuffer()
        XCTAssertEqual(buffer2.getEvents().count, 1)
        XCTAssertEqual(buffer2.getEvents().first?.message, "Persist Me")
    }
}
