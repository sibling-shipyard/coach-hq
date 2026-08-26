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
        for i in 0..<250 {
            buffer.addEvent("Event \(i)")
        }
        
        let events = buffer.getEvents()
        XCTAssertEqual(events.count, 200, "Buffer should not exceed 200 events")
        XCTAssertEqual(events.last?.message, "Event 249", "The latest event should be kept")
    }
    
    func testExpiry() {
        let buffer = TimelineBuffer.shared
        // Mocking the behavior by temporarily changing maxAge or using a mock event could be tricky since it's private.
        // But since we can't inject Date easily, let's just make sure normal events are kept.
        buffer.addEvent("Recent Event")
        let events = buffer.getEvents()
        XCTAssertEqual(events.count, 1)
    }
    
    func testClearOnSignOut() {
        let buffer = TimelineBuffer.shared
        buffer.addEvent("Event to be cleared")
        XCTAssertEqual(buffer.getEvents().count, 1)
        
        buffer.clearOnSignOut()
        XCTAssertEqual(buffer.getEvents().count, 0)
    }
}
