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

    func testWrongAttachmentVersionIsIgnored() throws {
        let json = """
        {
          "id": "c-3",
          "role": "coach",
          "paragraphs": ["Keep the prose."],
          "attachments": [{
            "version": 9,
            "kind": "synced_activity_list",
            "batch_id": "nope",
            "activities": []
          }]
        }
        """
        let message = try JSONDecoder().decode(ChatMessage.self, from: Data(json.utf8))
        XCTAssertEqual(message.paragraphs, ["Keep the prose."])
        XCTAssertNil(message.syncedActivityList)
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

    func testOlderPostDoesNotApplyWhenEpochIsNewer() {
        XCTAssertFalse(ActivitySyncEpoch.shouldApply(turnEpoch: 1, currentEpoch: 2))
    }

    func testMatchingEpochApplies() {
        XCTAssertTrue(ActivitySyncEpoch.shouldApply(turnEpoch: 2, currentEpoch: 2))
    }

    func testStalePostDoesNotOverwriteNewerBatch() {
        let since = Date()
        let turnA = ActivitySyncTurn(
            activities: [Self.draft(id: "A")],
            freshnessSince: since,
            epoch: 1,
            phase: .requestingCoach
        )
        let turnB = ActivitySyncTurn(
            activities: [Self.draft(id: "B")],
            freshnessSince: since,
            epoch: 2,
            phase: .waitingForSnapshots
        )
        var published = turnA
        published = turnB
        var aDone = turnA
        aDone.phase = .complete
        aDone.reply = "Batch A"
        published = ActivitySyncEpoch.apply(incoming: aDone, onto: published)
        XCTAssertEqual(published.epoch, 2)
        XCTAssertEqual(published.phase, .waitingForSnapshots)
        XCTAssertEqual(published.activities.map(\.activityId), ["B"])
        XCTAssertNil(published.reply)
    }

    func testThinkingDotsOnlyWhileRequestingCoach() {
        var turn = ActivitySyncTurn(
            activities: [Self.fixtureDraft],
            freshnessSince: Date(),
            epoch: 1,
            phase: .waitingForSnapshots
        )
        XCTAssertFalse(turn.isThinking)
        XCTAssertFalse(turn.needsRetry)

        turn.phase = .requestingCoach
        XCTAssertTrue(turn.isThinking)
        XCTAssertFalse(turn.needsRetry)

        turn.phase = .retryWait
        XCTAssertFalse(turn.isThinking)
        XCTAssertTrue(turn.needsRetry)

        turn.phase = .retryPost
        XCTAssertFalse(turn.isThinking)
        XCTAssertTrue(turn.needsRetry)

        turn.phase = .complete
        XCTAssertFalse(turn.isThinking)
        XCTAssertFalse(turn.needsRetry)
    }

    func testPersistedMultiActivityTurnDecodesOneListAndReply() throws {
        let json = """
        {
          "id": "c-m0",
          "role": "coach",
          "paragraphs": ["Nice work on Easy Run and Ride #2. How did the legs feel after the ride?"],
          "attachments": [{
            "version": 1,
            "kind": "synced_activity_list",
            "batch_id": "fixture-batch-m0",
            "activities": [
              {
                "id": "11111111-1111-1111-1111-111111111111",
                "title": "Easy Run",
                "sport": "Run",
                "start": "2026-08-22T06:30:00",
                "duration_s": 2400,
                "load": 3
              },
              {
                "id": "22222222-2222-2222-2222-222222222222",
                "title": "Ride #2",
                "sport": "Ride",
                "start": "2026-08-22T09:00:00",
                "duration_s": 3600,
                "load": null
              }
            ]
          }]
        }
        """
        let message = try JSONDecoder().decode(ChatMessage.self, from: Data(json.utf8))
        let list = try XCTUnwrap(message.syncedActivityList)
        XCTAssertEqual(message.paragraphs?.count, 1)
        XCTAssertEqual(list.batchId, "fixture-batch-m0")
        XCTAssertEqual(list.activities.map(\.id), [
            "11111111-1111-1111-1111-111111111111",
            "22222222-2222-2222-2222-222222222222",
        ])
        XCTAssertEqual(ActivitySyncIDs.qualified(list.activities[0].id), "hk:11111111-1111-1111-1111-111111111111")
    }

    private static let fixtureDraft = SyncedActivityDraft(
        activityId: "11111111-1111-1111-1111-111111111111",
        fileName: "hk_2026-08-22_11111111-1111-1111-1111-111111111111.json",
        title: "Easy Run",
        sport: "Run",
        start: "2026-08-22T06:30:00",
        durationSeconds: 2400,
        load: 3
    )

    private static func draft(id: String) -> SyncedActivityDraft {
        SyncedActivityDraft(
            activityId: id,
            fileName: "\(id).json",
            title: "Run",
            sport: "Run",
            start: "2026-08-23T07:00:00",
            durationSeconds: 2400,
            load: 18
        )
    }
}
