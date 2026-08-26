import XCTest
@testable import CoachHQ

class RageReportTests: XCTestCase {
    
    func testSubmitReport_withTimeline() {
        var submittedMessage: String?
        var submittedIncludeTimeline: Bool?
        
        let viewModel = RageReportViewModel { msg, include in
            submittedMessage = msg
            submittedIncludeTimeline = include
        }
        
        viewModel.message = "Crash when scrolling"
        viewModel.includeTimeline = true
        viewModel.submitReport()
        
        XCTAssertEqual(submittedMessage, "Crash when scrolling")
        XCTAssertEqual(submittedIncludeTimeline, true)
    }
    
    func testSubmitReport_withoutTimeline() {
        var submittedMessage: String?
        var submittedIncludeTimeline: Bool?
        
        let viewModel = RageReportViewModel { msg, include in
            submittedMessage = msg
            submittedIncludeTimeline = include
        }
        
        viewModel.message = "UI looks weird"
        viewModel.includeTimeline = false
        viewModel.submitReport()
        
        XCTAssertEqual(submittedMessage, "UI looks weird")
        XCTAssertEqual(submittedIncludeTimeline, false)
    }
}
