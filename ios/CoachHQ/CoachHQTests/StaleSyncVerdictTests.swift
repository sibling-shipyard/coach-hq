import XCTest
@testable import CoachHQ

/// A sync that never produced fresh data (#883). The unit under test is the verdict: which
/// give-up is a fault worth an error, and which is a slow-but-healthy run worth only a warning.
final class StaleSyncVerdictTests: XCTestCase {

    private func run(status: String, conclusion: String?) -> SyncWorkflowRun {
        SyncWorkflowRun(
            status: status,
            conclusion: conclusion,
            htmlURL: "https://github.com/owner/repo/actions/runs/1",
            runStartedAt: "2026-09-05T20:02:51Z"
        )
    }

    // MARK: - Classification

    func testNoRunForTheCommitMeansTheWorkflowNeverStarted() {
        XCTAssertEqual(StaleSyncVerdict.from(run: nil), .pipelineNeverRan)
    }

    func testQueuedOrInProgressRunIsSlowNotBroken() {
        for status in ["queued", "in_progress", "waiting", "pending", "requested"] {
            XCTAssertEqual(
                StaleSyncVerdict.from(run: run(status: status, conclusion: nil)),
                .pipelineStillRunning,
                "status \(status)"
            )
        }
    }

    func testCompletedButNotSuccessfulIsAFailure() {
        // `failure` covers the Checkout deaths that made up 5 of the 7 real failures on record.
        for conclusion in ["failure", "cancelled", "timed_out", "startup_failure", "action_required"] {
            XCTAssertEqual(
                StaleSyncVerdict.from(run: run(status: "completed", conclusion: conclusion)),
                .pipelineFailed,
                "conclusion \(conclusion)"
            )
        }
    }

    func testGreenRunWithStaleNumbersIsItsOwnVerdict() {
        XCTAssertEqual(
            StaleSyncVerdict.from(run: run(status: "completed", conclusion: "success")),
            .pipelineGreenButStale
        )
    }

    // MARK: - Severity

    func testOnlyBrokenPipelinesReportAsErrors() {
        XCTAssertTrue(StaleSyncVerdict.pipelineFailed.isFault)
        XCTAssertTrue(StaleSyncVerdict.pipelineNeverRan.isFault)
        XCTAssertTrue(StaleSyncVerdict.pipelineGreenButStale.isFault)
        // A slow queue and an unanswerable lookup must never page anyone; a muted alert is
        // worse than no alert.
        XCTAssertFalse(StaleSyncVerdict.pipelineStillRunning.isFault)
        XCTAssertFalse(StaleSyncVerdict.pipelineStatusUnknown.isFault)
    }

    func testOnlyTheGreenRunIsRecheckedBeforeReporting() {
        // The run can finish during the GitHub lookup, so a `success` verdict is asked once more
        // whether the numbers have since moved. Every other verdict describes a run that produced
        // no new numbers at all, and a second snapshot read cannot change that.
        XCTAssertTrue(StaleSyncVerdict.pipelineGreenButStale.needsFreshnessRecheck)
        XCTAssertFalse(StaleSyncVerdict.pipelineFailed.needsFreshnessRecheck)
        XCTAssertFalse(StaleSyncVerdict.pipelineNeverRan.needsFreshnessRecheck)
        XCTAssertFalse(StaleSyncVerdict.pipelineStillRunning.needsFreshnessRecheck)
        XCTAssertFalse(StaleSyncVerdict.pipelineStatusUnknown.needsFreshnessRecheck)
    }

    func testEachVerdictHasItsOwnStableSentryTitle() {
        let all: [StaleSyncVerdict] = [
            .pipelineFailed, .pipelineNeverRan, .pipelineGreenButStale,
            .pipelineStillRunning, .pipelineStatusUnknown
        ]
        XCTAssertEqual(Set(all.map(\.summary)).count, all.count)
        XCTAssertEqual(Set(all.map(\.rawValue)).count, all.count)
    }

    // MARK: - Decoding GitHub's answer

    func testDecodesWorkflowRunListFromGitHubPayload() throws {
        let json = """
        {
          "total_count": 1,
          "workflow_runs": [{
            "id": 33988920968,
            "name": "Sync",
            "status": "completed",
            "conclusion": "failure",
            "run_started_at": "2026-09-05T20:02:51Z",
            "html_url": "https://github.com/owner/repo/actions/runs/33988920968"
          }]
        }
        """
        let list = try JSONDecoder().decode(SyncWorkflowRunList.self, from: Data(json.utf8))
        let first = try XCTUnwrap(list.workflowRuns.first)
        XCTAssertEqual(first.status, "completed")
        XCTAssertEqual(first.conclusion, "failure")
        XCTAssertEqual(first.runStartedAt, "2026-09-05T20:02:51Z")
        XCTAssertEqual(StaleSyncVerdict.from(run: first), .pipelineFailed)
    }

    func testInProgressRunDecodesWithNullConclusion() throws {
        let json = """
        { "total_count": 1, "workflow_runs": [{ "status": "in_progress", "conclusion": null }] }
        """
        let list = try JSONDecoder().decode(SyncWorkflowRunList.self, from: Data(json.utf8))
        let first = try XCTUnwrap(list.workflowRuns.first)
        XCTAssertNil(first.conclusion)
        XCTAssertNil(first.htmlURL)
        XCTAssertEqual(StaleSyncVerdict.from(run: first), .pipelineStillRunning)
    }

    func testEmptyRunListMeansNeverRan() throws {
        let json = #"{ "total_count": 0, "workflow_runs": [] }"#
        let list = try JSONDecoder().decode(SyncWorkflowRunList.self, from: Data(json.utf8))
        XCTAssertEqual(StaleSyncVerdict.from(run: list.workflowRuns.first), .pipelineNeverRan)
    }

    // MARK: - The budget the report quotes

    @MainActor
    func testPollBudgetMatchesTheWaitLadder() {
        XCTAssertEqual(WidgetSnapshotStore.syncPollWaits, [0, 15, 15, 20, 20, 30])
        XCTAssertEqual(WidgetSnapshotStore.syncPollBudgetSeconds, 100)
    }
}
