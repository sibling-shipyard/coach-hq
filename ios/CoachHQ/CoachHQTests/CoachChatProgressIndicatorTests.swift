import XCTest
@testable import CoachHQ

/// I1: the cycling "Coach is thinking…" progress label, and the three real D1 failure shapes
/// each getting their own accurate message. Mirrors ui/client/src/components/coach-chat's own
/// CoachChatWidgets.test.tsx / coachChatModel.test.ts coverage.
final class CoachChatProgressIndicatorTests: XCTestCase {

    // MARK: - Cycling stage labels

    func testStageLabelsCycleInOrder() {
        XCTAssertEqual(CoachChatThinkingStage.labels.count, 3)
        var stage = 0
        XCTAssertEqual(CoachChatThinkingStage.labels[stage], "Coach is thinking…")

        stage = CoachChatThinkingStage.next(from: stage)
        XCTAssertEqual(stage, 1)
        XCTAssertEqual(CoachChatThinkingStage.labels[stage], "Parsing Coach's thoughts…")

        stage = CoachChatThinkingStage.next(from: stage)
        XCTAssertEqual(stage, 2)
        XCTAssertEqual(CoachChatThinkingStage.labels[stage], "Updating your log…")
    }

    func testStageHoldsOnLastInsteadOfLooping() {
        var stage = CoachChatThinkingStage.labels.count - 1
        stage = CoachChatThinkingStage.next(from: stage)
        stage = CoachChatThinkingStage.next(from: stage)
        XCTAssertEqual(stage, CoachChatThinkingStage.labels.count - 1)
    }

    // MARK: - D1 failure shapes, decoded and distinct

    func testDecodesCommitFailureErrorBodyWithPreservedReply() throws {
        let json = """
        { "error": "commit failed", "reply": "Coach's actual reply text", "traceId": "abc-123" }
        """
        let body = try JSONDecoder().decode(ChatAPIErrorBody.self, from: Data(json.utf8))
        XCTAssertEqual(body.reply, "Coach's actual reply text")
        XCTAssertEqual(body.traceId, "abc-123")
    }

    func testGenericGeminiFailureErrorBodyHasNoReply() throws {
        let json = """
        { "error": "Gemini call failed" }
        """
        let body = try JSONDecoder().decode(ChatAPIErrorBody.self, from: Data(json.utf8))
        XCTAssertNil(body.reply)
    }

    func testDecodesDroppedActionsOnASuccessfulTurn() throws {
        let json = """
        {
          "reply": "Logged the run.",
          "threadId": "thread-1",
          "threads": [],
          "profileComplete": true,
          "droppedActions": [{ "field": "ledger.entries[0].load", "reason": "out of range" }]
        }
        """
        let decoded = try JSONDecoder().decode(ChatSendResponse.self, from: Data(json.utf8))
        XCTAssertEqual(decoded.droppedActions?.count, 1)
        XCTAssertEqual(decoded.droppedActions?.first, DroppedAction(field: "ledger.entries[0].load", reason: "out of range"))
    }

    func testOrdinaryTurnHasNoDroppedActions() throws {
        let json = """
        { "reply": "All good.", "threadId": "thread-1", "threads": [], "profileComplete": true }
        """
        let decoded = try JSONDecoder().decode(ChatSendResponse.self, from: Data(json.utf8))
        XCTAssertNil(decoded.droppedActions)
    }

    func testSaveFailedErrorCarriesTheRealReply() {
        let error = CoachChatSaveFailedError(message: "commit failed", reply: "Coach's real words", traceId: "t-1")
        XCTAssertEqual(error.reply, "Coach's real words")
        XCTAssertEqual(error.message, "commit failed")
    }
}
