import XCTest
@testable import CoachHQ

/// #1078 I8, I10–I15 — pure diagnostic seams (no URLSession / GitHub). TimelineBuffer records
/// even when Sentry is disabled, matching HealthKitSyncDiagnosticsTests.
final class SentryCoverageM4DiagnosticsTests: XCTestCase {

    override func setUp() {
        super.setUp()
        TimelineBuffer.shared.clearOnSignOut()
    }

    override func tearDown() {
        TimelineBuffer.shared.clearOnSignOut()
        super.tearDown()
    }

    // MARK: - I8 CoachChatAPIClient retry

    func testCoachChatTerminalFailureIsCaptured() {
        let operationID = UUID()
        let error = GitHubAPIError.requestFailed(operation: "Sending message", status: 500, detail: "boom")
        CoachChatAPIRetrySignal.reportTerminalFailure(
            error: error,
            label: "Sending message",
            attempts: 3,
            operationID: operationID
        )

        let events = TimelineBuffer.shared.getEvents()
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0].category, CoachChatAPIRetrySignal.operation)
        XCTAssertEqual(events[0].message, "failed")
        XCTAssertEqual(events[0].operationID, operationID)
        XCTAssertEqual(events[0].metadata["label"], "Sending message")
        XCTAssertEqual(events[0].metadata["attempts"], "3")
    }

    func testCoachChatShouldNotCaptureSessionNotReadyOrNotFound() {
        XCTAssertFalse(CoachChatAPIRetrySignal.shouldCapture(GitHubAPIError.sessionNotReady))
        XCTAssertFalse(CoachChatAPIRetrySignal.shouldCapture(
            GitHubAPIError.notFound(operation: "Loading conversations")
        ))
        XCTAssertTrue(CoachChatAPIRetrySignal.shouldCapture(GitHubAPIError.notAuthenticated))
        XCTAssertFalse(CoachChatAPIRetrySignal.shouldCapture(CancellationError()))
    }

    // MARK: - I10–I13 WorkoutService

    func testWorkoutTemplateSkipRecordsOnTheTimeline() {
        let operationID = UUID()
        WorkoutFetchDiagnostics.reportSkip(
            fileName: "tmpl_a.json",
            error: TestM4Error.decode,
            operation: WorkoutFetchDiagnostics.templatesOperation,
            operationID: operationID
        )

        let events = TimelineBuffer.shared.getEvents()
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0].category, WorkoutFetchDiagnostics.templatesOperation)
        XCTAssertEqual(events[0].metadata["file"], "tmpl_a.json")
        XCTAssertEqual(events[0].metadata["phase"], "skip")
    }

    func testWorkoutSkipDoesNotDoubleCaptureGitHubAPIErrors() {
        WorkoutFetchDiagnostics.reportSkip(
            fileName: "tmpl_a.json",
            error: GitHubAPIError.requestFailed(operation: "Reading x", status: 500, detail: nil),
            operation: WorkoutFetchDiagnostics.templatesOperation
        )
        XCTAssertTrue(TimelineBuffer.shared.getEvents().isEmpty)
    }

    func testWorkoutCurrentWeekDecodeFailureRecords() {
        let operationID = UUID()
        WorkoutFetchDiagnostics.reportDecodeFailure(
            TestM4Error.decode,
            operation: WorkoutFetchDiagnostics.currentWeekOperation,
            operationID: operationID
        )

        let events = TimelineBuffer.shared.getEvents()
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0].category, WorkoutFetchDiagnostics.currentWeekOperation)
        XCTAssertEqual(events[0].metadata["phase"], "decode")
    }

    func testWorkoutLocalReportSkipsGitHubAPIErrorsAlreadyCapturedUpstream() {
        XCTAssertFalse(WorkoutFetchDiagnostics.shouldReportIfNotCoveredByGitHubClient(
            GitHubAPIError.notFound(operation: "Reading current_week")
        ))
        XCTAssertFalse(WorkoutFetchDiagnostics.shouldReportIfNotCoveredByGitHubClient(
            GitHubAPIError.requestFailed(operation: "Reading profile", status: 502, detail: nil)
        ))
        XCTAssertTrue(WorkoutFetchDiagnostics.shouldReportIfNotCoveredByGitHubClient(TestM4Error.decode))
    }

    // MARK: - I14/I15 CoachMessage

    func testCoachMessageGenerateFailureIsCaptured() {
        let operationID = UUID()
        CoachMessageGenerateDiagnostics.report(
            error: GitHubAPIError.requestFailed(
                operation: "Generating Coach message",
                status: 503,
                detail: "unavailable"
            ),
            operationID: operationID,
            metadata: ["activity_count": "2"]
        )

        let events = TimelineBuffer.shared.getEvents()
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0].category, CoachMessageGenerateDiagnostics.operation)
        XCTAssertEqual(events[0].operationID, operationID)
        XCTAssertEqual(events[0].metadata["activity_count"], "2")
    }

    func testCoachMessageShouldNotCaptureSessionNotReady() {
        XCTAssertFalse(CoachMessageGenerateDiagnostics.shouldCapture(GitHubAPIError.sessionNotReady))
        XCTAssertTrue(CoachMessageGenerateDiagnostics.shouldCapture(GitHubAPIError.notAuthenticated))
        XCTAssertFalse(CoachMessageGenerateDiagnostics.shouldCapture(CancellationError()))
    }
}

private enum TestM4Error: Error {
    case decode
}
