import XCTest
@testable import CoachHQ

/// #1078 I1/I2/I3 — HealthKit sync silent Sentry gaps. Capture helpers are pure seams so
/// XCTest can assert without HealthKit callbacks; the once-per-epoch gate is the I3 quota.
final class HealthKitSyncDiagnosticsTests: XCTestCase {

    override func setUp() {
        super.setUp()
        TimelineBuffer.shared.clearOnSignOut()
    }

    override func tearDown() {
        TimelineBuffer.shared.clearOnSignOut()
        super.tearDown()
    }

    // MARK: - I1 / I2 capture seams

    func testObserverFailureRecordsOnTheTimeline() {
        let operationID = UUID()
        HealthKitObserverDiagnostics.reportFailure(
            TestDiagnosticError.observer,
            operationID: operationID
        )

        let events = TimelineBuffer.shared.getEvents()
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0].category, HealthKitObserverDiagnostics.operation)
        XCTAssertEqual(events[0].message, "failed")
        XCTAssertEqual(events[0].operationID, operationID)
    }

    func testBackgroundDeliveryFailureRecordsOnTheTimeline() {
        let operationID = UUID()
        HealthKitBackgroundDeliveryDiagnostics.reportFailure(
            TestDiagnosticError.backgroundDelivery,
            operationID: operationID
        )

        let events = TimelineBuffer.shared.getEvents()
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0].category, HealthKitBackgroundDeliveryDiagnostics.operation)
        XCTAssertEqual(events[0].message, "failed")
        XCTAssertEqual(events[0].operationID, operationID)
    }

    // MARK: - I3 once-per-epoch gate

    func testFirstPostFailureInAnEpochIsCaptured() {
        XCTAssertTrue(ActivitySyncPostFailureSignal.shouldCapture(
            epoch: 1,
            alreadyReportedEpoch: nil
        ))
        XCTAssertTrue(ActivitySyncPostFailureSignal.shouldCapture(
            epoch: 2,
            alreadyReportedEpoch: 1
        ))
    }

    func testLaterPostFailuresInTheSameEpochAreNotCaptured() {
        XCTAssertFalse(ActivitySyncPostFailureSignal.shouldCapture(
            epoch: 3,
            alreadyReportedEpoch: 3
        ))
    }

    func testPostFailureReportRecordsEpochAndRetryPhase() {
        let operationID = UUID()
        ActivitySyncPostFailureSignal.report(
            error: TestDiagnosticError.post,
            epoch: 7,
            phase: .retryPost,
            operationID: operationID
        )

        let events = TimelineBuffer.shared.getEvents()
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0].category, ActivitySyncPostFailureSignal.operation)
        XCTAssertEqual(events[0].message, "failed")
        XCTAssertEqual(events[0].operationID, operationID)
        XCTAssertEqual(events[0].metadata["epoch"], "7")
        XCTAssertEqual(events[0].metadata["retry_phase"], "retryPost")
    }
}

private enum TestDiagnosticError: Error {
    case observer
    case backgroundDelivery
    case post
}
