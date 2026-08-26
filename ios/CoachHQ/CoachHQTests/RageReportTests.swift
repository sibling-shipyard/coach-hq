import XCTest
@testable import CoachHQ

class RageReportTests: XCTestCase {
    
    override func setUp() {
        super.setUp()
        SentrySDK.capturedMessages.removeAll()
        TimelineBuffer.shared.clearOnSignOut()
    }
    
    override func tearDown() {
        SentrySDK.capturedMessages.removeAll()
        TimelineBuffer.shared.clearOnSignOut()
        super.tearDown()
    }
    
    func testSubmitReport_withTimeline() {
        let viewModel = RageReportViewModel()
        viewModel.message = "Crash when scrolling"
        viewModel.includeTimeline = true
        
        TimelineBuffer.shared.addEvent("Navigated to Home")
        
        viewModel.submitReport()
        
        XCTAssertEqual(SentrySDK.capturedMessages.count, 1)
        let capture = SentrySDK.capturedMessages.first!
        XCTAssertEqual(capture.message, "Crash when scrolling")
        XCTAssertEqual(capture.attachments.count, 1)
        XCTAssertEqual(capture.attachments.first?.filename, "timeline.json")
    }
    
    func testSubmitReport_withoutTimeline() {
        let viewModel = RageReportViewModel()
        viewModel.message = "UI looks weird"
        viewModel.includeTimeline = false
        
        TimelineBuffer.shared.addEvent("Navigated to Settings")
        
        viewModel.submitReport()
        
        XCTAssertEqual(SentrySDK.capturedMessages.count, 1)
        let capture = SentrySDK.capturedMessages.first!
        XCTAssertEqual(capture.message, "UI looks weird")
        XCTAssertEqual(capture.attachments.count, 0)
    }
}
