import XCTest
@testable import CoachHQ

/// D1 (#736): iOS parity with web's coachChatModel.test.ts coverage of CoachChatSaveFailedError
/// and DroppedAction decoding - see docs/plans/ccr-d1-validation-lld.md.
final class CoachChatSaveFailureTests: XCTestCase {

    func testChatAPIErrorBodyDecodesReplyAndTraceId() throws {
        let json = """
        {"error": "GitHub commit failed", "reply": "Nice work today.", "traceId": "abc-123"}
        """
        let body = try JSONDecoder().decode(ChatAPIErrorBody.self, from: Data(json.utf8))
        XCTAssertEqual(body.error, "GitHub commit failed")
        XCTAssertEqual(body.reply, "Nice work today.")
        XCTAssertEqual(body.traceId, "abc-123")
    }

    func testChatAPIErrorBodyWithoutReplyDecodesNil() throws {
        let json = """
        {"error": "Gemini request failed (503)"}
        """
        let body = try JSONDecoder().decode(ChatAPIErrorBody.self, from: Data(json.utf8))
        XCTAssertNil(body.reply)
    }

    func testFriendlyMessageForSaveFailedIsDistinctFromGenericError() {
        let saveFailed = CoachChatSaveFailedError(message: "GitHub commit failed", reply: "Nice work.", traceId: "abc-123")
        let message = UserFacingError.friendlyMessage(for: saveFailed)
        XCTAssertEqual(message, "Coach replied, but I couldn't save it — try again?")
        XCTAssertNotEqual(message, UserFacingError.friendlyMessage(for: GitHubAPIError.requestFailed(operation: "Sending message", status: 503, detail: nil)))
    }

    func testChatSendResponseDecodesDroppedActions() throws {
        let json = """
        {
          "reply": "Logged your run.",
          "threadId": "thread-1",
          "threads": [],
          "profileComplete": true,
          "droppedActions": [{"field": "quest_event.quest_id", "reason": "unknown quest id after retry"}]
        }
        """
        let response = try JSONDecoder().decode(ChatSendResponse.self, from: Data(json.utf8))
        let dropped = try XCTUnwrap(response.droppedActions)
        XCTAssertEqual(dropped.count, 1)
        XCTAssertEqual(dropped[0].field, "quest_event.quest_id")
        XCTAssertEqual(dropped[0].reason, "unknown quest id after retry")
    }

    func testChatSendResponseWithoutDroppedActionsDecodesNil() throws {
        let json = """
        {"reply": "All good.", "threadId": "thread-1", "threads": [], "profileComplete": true}
        """
        let response = try JSONDecoder().decode(ChatSendResponse.self, from: Data(json.utf8))
        XCTAssertNil(response.droppedActions)
    }
}
