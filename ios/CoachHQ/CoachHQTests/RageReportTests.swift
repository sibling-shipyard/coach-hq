import Foundation
import XCTest
@testable import CoachHQ

final class RageReportTests: XCTestCase {
    func testEvidenceStartsUnselectedAndCanBeSelectedIndividually() {
        let events = makeEvents()
        let viewModel = RageReportViewModel(events: events, submitter: RecordingRageReportSubmitter())

        XCTAssertEqual(viewModel.availableEvents, events)
        XCTAssertEqual(viewModel.selectedEventCount, 0)

        viewModel.setSelected(true, for: events[1])

        XCTAssertFalse(viewModel.isSelected(events[0]))
        XCTAssertTrue(viewModel.isSelected(events[1]))
    }

    func testSubmitAttachesExactlySelectedEvidence() throws {
        let events = makeEvents()
        let submitter = RecordingRageReportSubmitter()
        let viewModel = RageReportViewModel(events: events, submitter: submitter)
        viewModel.message = "  Crash when scrolling  "
        viewModel.setSelected(true, for: events[1])

        viewModel.submitReport()

        let call = try XCTUnwrap(submitter.calls.first)
        let attachment = try XCTUnwrap(call.attachment)
        XCTAssertEqual(call.message, "Crash when scrolling")
        XCTAssertEqual(attachment.filename, "timeline.json")
        XCTAssertEqual(attachment.contentType, "application/json")
        XCTAssertEqual(try JSONDecoder().decode([TimelineEvent].self, from: attachment.data), [events[1]])
        XCTAssertEqual(submitter.calls.count, 1)
        XCTAssertEqual(viewModel.submissionState, .queued)
    }

    func testPastedCredentialsAreScrubbedFromTheAthleteMessage() throws {
        let token = "ghp_" + String(repeating: "a", count: 40)
        let submitter = RecordingRageReportSubmitter()
        let viewModel = RageReportViewModel(events: makeEvents(), submitter: submitter)
        viewModel.message = "login broke, my token is \(token)"

        viewModel.submitReport()

        let call = try XCTUnwrap(submitter.calls.first)
        XCTAssertEqual(call.message, "login broke, my token is [Filtered]")
    }

    func testSubmitWithoutSelectedEvidenceHasNoAttachment() throws {
        let submitter = RecordingRageReportSubmitter()
        let viewModel = RageReportViewModel(events: makeEvents(), submitter: submitter)
        viewModel.message = "UI looks weird"

        viewModel.submitReport()

        let call = try XCTUnwrap(submitter.calls.first)
        XCTAssertNil(call.attachment)
        XCTAssertEqual(viewModel.submissionState, .queued)
    }

    func testCancelSendsNothing() {
        let submitter = RecordingRageReportSubmitter()
        let viewModel = RageReportViewModel(events: makeEvents(), submitter: submitter)
        viewModel.message = "Should never leave the phone"

        viewModel.cancelReport()
        viewModel.submitReport()

        XCTAssertTrue(submitter.calls.isEmpty)
        XCTAssertEqual(viewModel.submissionState, .cancelled)
    }

    func testSubmissionFailureDoesNotClaimReportWasQueued() {
        let submitter = RecordingRageReportSubmitter(error: TestError.failed)
        let viewModel = RageReportViewModel(events: makeEvents(), submitter: submitter)
        viewModel.message = "Something broke"

        viewModel.submitReport()

        XCTAssertEqual(submitter.calls.count, 1)
        XCTAssertEqual(viewModel.submissionState, .failed)
        XCTAssertTrue(viewModel.canSubmit)
    }

    private func makeEvents() -> [TimelineEvent] {
        [
            TimelineEvent(
                id: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
                timestamp: Date(timeIntervalSince1970: 1_000),
                category: "navigation",
                message: "Opened Home"
            ),
            TimelineEvent(
                id: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!,
                timestamp: Date(timeIntervalSince1970: 2_000),
                category: "healthkit.sync",
                message: "Sync failed"
            )
        ]
    }
}

private final class RecordingRageReportSubmitter: RageReportSubmitting {
    struct Call {
        let message: String
        let attachment: RageReportAttachment?
    }

    private(set) var calls: [Call] = []
    private let error: Error?

    init(error: Error? = nil) {
        self.error = error
    }

    func submit(message: String, attachment: RageReportAttachment?) throws {
        calls.append(Call(message: message, attachment: attachment))
        if let error {
            throw error
        }
    }
}

private enum TestError: Error {
    case failed
}
