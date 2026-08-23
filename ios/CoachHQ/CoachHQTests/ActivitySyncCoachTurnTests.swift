import XCTest
@testable import CoachHQ

final class ActivitySyncCoachTurnTests: XCTestCase {

    func testQualifiedIdAddsHkPrefix() {
        XCTAssertEqual(ActivitySyncIDs.qualified("A1B2"), "hk:A1B2")
    }

    func testQualifiedIdDoesNotDoublePrefix() {
        XCTAssertEqual(ActivitySyncIDs.qualified("hk:A1B2"), "hk:A1B2")
    }

    func testDecodesSyncedActivityListAttachment() throws {
        let json = """
        {
          "id": "c-1",
          "role": "coach",
          "paragraphs": ["Solid session."],
          "attachments": [{
            "version": 1,
            "kind": "synced_activity_list",
            "batch_id": "abc123",
            "activities": [{
              "id": "uuid-1",
              "title": "Run #4",
              "sport": "Run",
              "start": "2026-08-23T07:00:00",
              "duration_s": 2400,
              "load": 18
            }]
          }]
        }
        """
        let message = try JSONDecoder().decode(ChatMessage.self, from: Data(json.utf8))
        let list = try XCTUnwrap(message.syncedActivityList)
        XCTAssertEqual(list.batchId, "abc123")
        XCTAssertEqual(list.activities.count, 1)
        XCTAssertEqual(list.activities[0].title, "Run #4")
        XCTAssertEqual(list.activities[0].durationSeconds, 2400)
        XCTAssertEqual(list.activities[0].load, 18)
    }

    func testUnknownAttachmentIsIgnoredNotFatal() throws {
        let json = """
        {
          "id": "c-2",
          "role": "coach",
          "paragraphs": ["Still here."],
          "attachments": [
            { "version": 2, "kind": "future_widget", "payload": { "x": 1 } },
            {
              "version": 1,
              "kind": "synced_activity_list",
              "batch_id": "keep",
              "activities": [{
                "id": "u",
                "title": "Ride #1",
                "sport": "Ride",
                "start": "2026-08-23T08:00:00",
                "duration_s": 3600,
                "load": null
              }]
            }
          ]
        }
        """
        let message = try JSONDecoder().decode(ChatMessage.self, from: Data(json.utf8))
        XCTAssertEqual(message.paragraphs, ["Still here."])
        XCTAssertEqual(message.attachments?.count, 1)
        XCTAssertEqual(message.syncedActivityList?.batchId, "keep")
        XCTAssertNil(message.syncedActivityList?.activities[0].load)
    }

    func testDuplicateSkipsNotificationAndHomeCopy() {
        XCTAssertFalse(ActivitySyncCopy.shouldAnnounceReply(duplicate: true, chatVisible: false))
        XCTAssertFalse(ActivitySyncCopy.shouldAnnounceReply(duplicate: false, chatVisible: true))
        XCTAssertTrue(ActivitySyncCopy.shouldAnnounceReply(duplicate: false, chatVisible: false))
    }

    func testFirstSentenceStopsAtTerminator() {
        XCTAssertEqual(
            ActivitySyncCopy.firstSentence(of: "Nice work. Want to add a second set tomorrow?"),
            "Nice work."
        )
    }
}
