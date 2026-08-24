import XCTest
@testable import CoachHQ

final class CoachMessageSnapshotTests: XCTestCase {
    func testGoldenSnapshotCarriesExactCoachMessage() {
        let message = GoldenDataset.snapshots.home.coachMessage

        XCTAssertEqual(message?.id, "cm-11111111-2222-4333-8444-555555555555")
        XCTAssertEqual(
            message?.body,
            "The quiet work landed. Nothing clever to add today, but I noticed."
        )
        XCTAssertEqual(
            message?.conversationSeedId,
            "local-proactive-cm-11111111-2222-4333-8444-555555555555"
        )
    }

    func testSnapshotWithoutCoachMessageStillDecodes() throws {
        let encoded = try JSONEncoder().encode(GoldenDataset.snapshots)
        var root = try XCTUnwrap(
            JSONSerialization.jsonObject(with: encoded) as? [String: Any]
        )
        var home = try XCTUnwrap(root["home"] as? [String: Any])
        home.removeValue(forKey: "coachMessage")
        root["home"] = home

        let oldData = try JSONSerialization.data(withJSONObject: root)
        let decoded = try JSONDecoder().decode(WidgetSnapshotsFile.self, from: oldData)

        XCTAssertNil(decoded.home.coachMessage)
    }
}

final class CoachMessageAPIClientTests: XCTestCase {
    private let ids = [
        "healthkit:AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
    ]

    func testCanonicalActivityIdsAreQualifiedDeduplicatedAndSorted() throws {
        let result = try CoachMessageAPIClient.canonicalActivityIds([
            "strava:42",
            "healthkit:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
            "strava:42",
        ])

        XCTAssertEqual(result, [ids[0], "strava:42"])
    }

    func testActivityBatchBoundsAndAsciiContractAreEnforced() {
        XCTAssertThrowsError(try CoachMessageAPIClient.canonicalActivityIds(
            (1...21).map { "strava:\($0)" }
        ))
        XCTAssertThrowsError(try CoachMessageAPIClient.canonicalActivityIds(["strava:٤٢"]))
    }

    func testResponseDecodesFractionalTimestampAndIdempotency() throws {
        let decoded = try CoachMessageAPIClient.decodeResponse(
            responseData(createdAt: "2026-08-23T20:00:00.000Z", idempotent: true),
            expectedActivityIds: ids
        )

        XCTAssertTrue(decoded.idempotent)
        XCTAssertFalse(decoded.shouldNotify)
        XCTAssertEqual(decoded.message.body, "Exact Coach body.")
    }

    func testResponseDecodesNonFractionalTimestamp() throws {
        let decoded = try CoachMessageAPIClient.decodeResponse(
            responseData(createdAt: "2026-08-23T20:00:00Z"),
            expectedActivityIds: ids
        )

        XCTAssertEqual(decoded.message.createdAt, "2026-08-23T20:00:00Z")
    }

    func testMalformedMessageIdCannotSeedOrNotify() {
        XCTAssertThrowsError(try CoachMessageAPIClient.decodeResponse(
            responseData(createdAt: "2026-08-23T20:00:00.000Z", id: "wrong"),
            expectedActivityIds: ids
        ))
    }

    func testIdempotentResponseCannotRequestNotification() {
        XCTAssertThrowsError(try CoachMessageAPIClient.decodeResponse(
            responseData(
                createdAt: "2026-08-23T20:00:00.000Z",
                idempotent: true,
                shouldNotify: true
            ),
            expectedActivityIds: ids
        ))
    }

    func testOversizedResponseIsRejectedBeforeDecoding() {
        XCTAssertThrowsError(try CoachMessageAPIClient.decodeResponse(
            Data(repeating: 0x20, count: CoachMessageAPIClient.maximumPayloadBytes + 1),
            expectedActivityIds: ids
        ))
    }

    private func responseData(
        createdAt: String,
        id: String = "cm-12345678-abcd-4abc-8abc-123456789abc",
        idempotent: Bool = false,
        shouldNotify: Bool = false
    ) -> Data {
        let seed = "local-proactive-\(id)"
        let json = """
        {
          "message": {
            "id": "\(id)",
            "created_at": "\(createdAt)",
            "activity_ids": ["\(ids[0])"],
            "body": "Exact Coach body.",
            "conversation_seed_id": "\(seed)"
          },
          "delivered": true,
          "idempotent": \(idempotent),
          "should_notify": \(shouldNotify),
          "repoSha": "abc123"
        }
        """
        return Data(json.utf8)
    }
}

final class CoachMessageRouteTests: XCTestCase {
    private let repo = "athlete.test/coach-hq"
    private let seed = "local-proactive-cm-12345678-abcd-4abc-8abc-123456789abc"
    private let body = "Exact body, including every word."

    override func tearDown() {
        CoachMessageRoute.clear()
        CoachChatLocalCache.clear(repoFullName: repo, threadId: seed)
        super.tearDown()
    }

    func testNotificationRouteIsAccountScopedAndExact() throws {
        let route = try XCTUnwrap(CoachMessageRoute(userInfo: [
            "repoFullName": repo,
            "conversationSeedId": seed,
            "coachMessageBody": body,
            "createdAt": "2026-08-23T20:00:00.000Z",
        ]))
        route.persist()

        XCTAssertEqual(CoachMessageRoute.load(matching: repo), route)
        XCTAssertNil(CoachMessageRoute.load(matching: "other/coach-hq"))
        XCTAssertNil(CoachMessageRoute.load(matching: repo))
    }

    func testNilMatchingLeavesPersistedRoute() throws {
        let route = try XCTUnwrap(CoachMessageRoute(
            repoFullName: repo,
            conversationSeedId: seed,
            body: body,
            createdAt: "2026-08-23T20:00:00.000Z"
        ))
        route.persist()

        XCTAssertNil(CoachMessageRoute.load(matching: nil))
        XCTAssertEqual(CoachMessageRoute.load(matching: repo), route)
    }

    func testInvalidRepoOrSeedIsRejected() {
        XCTAssertNil(CoachMessageRoute(
            repoFullName: "invalid/repo/name",
            conversationSeedId: seed,
            body: body
        ))
        XCTAssertNil(CoachMessageRoute(
            repoFullName: repo,
            conversationSeedId: "local-proactive-wrong",
            body: body
        ))
    }

    func testProactiveThreadKeepsExactBodyAndThreadIdOnReopen() throws {
        let route = try XCTUnwrap(CoachMessageRoute(
            repoFullName: repo,
            conversationSeedId: seed,
            body: body,
            createdAt: "2026-08-23T20:00:00.000Z"
        ))
        let first = CoachChatLocalCache.proactiveThread(for: route)
        CoachChatLocalCache.save(messages: first.messages, repoFullName: repo, threadId: seed)
        let reopened = CoachChatLocalCache.proactiveThread(for: route)

        XCTAssertEqual(first.id, seed)
        XCTAssertEqual(reopened.id, seed)
        XCTAssertEqual(reopened.messages, first.messages)
        XCTAssertEqual(reopened.messages.filter { $0.role == .coach }.count, 1)
        XCTAssertEqual(reopened.messages.last?.paragraphs, [body])
    }

    func testRequestedOlderSeedIsExemptFromGreetingCleanup() throws {
        let oldDate = ISO8601DateFormatter().string(
            from: Calendar.current.date(byAdding: .day, value: -2, to: Date())!
        )
        let route = try XCTUnwrap(CoachMessageRoute(
            repoFullName: repo,
            conversationSeedId: seed,
            body: body,
            createdAt: oldDate
        ))
        let thread = CoachChatLocalCache.proactiveThread(for: route)
        CoachChatLocalCache.save(messages: thread.messages, repoFullName: repo, threadId: seed)

        let restored = CoachChatLocalCache.restoring(
            [],
            repoFullName: repo,
            preservingThreadId: seed
        )

        XCTAssertEqual(restored.map(\.id), [seed])
        XCTAssertEqual(restored[0].messages.last?.paragraphs, [body])
    }
}

final class CoachMessageDeliveryTests: XCTestCase {
    func testSuccessRefreshesBeforeNotifying() async {
        let events = EventLog()
        let client = StubGenerator(result: .success(response(shouldNotify: true)), events: events)

        await CoachMessagePostSyncDelivery.run(
            activityIds: ["healthkit:AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE"],
            repoFullName: "athlete/coach-athlete",
            client: client,
            refreshSnapshots: { await events.append("refresh") },
            notify: { _ in await events.append("notify") }
        )

        let recorded = await events.values()
        XCTAssertEqual(recorded, ["generate", "refresh", "notify"])
    }

    func testFailureDoesNotRefreshOrNotify() async {
        let events = EventLog()
        let client = StubGenerator(result: .failure(TestError.failed), events: events)

        await CoachMessagePostSyncDelivery.run(
            activityIds: ["healthkit:AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE"],
            repoFullName: "athlete/coach-athlete",
            client: client,
            refreshSnapshots: { await events.append("refresh") },
            notify: { _ in await events.append("notify") }
        )

        let recorded = await events.values()
        XCTAssertEqual(recorded, ["generate"])
    }

    func testIdempotentSuccessRefreshesWithoutNotification() async {
        let events = EventLog()
        let client = StubGenerator(result: .success(response(shouldNotify: false)), events: events)

        await CoachMessagePostSyncDelivery.run(
            activityIds: ["healthkit:AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE"],
            repoFullName: "athlete/coach-athlete",
            client: client,
            refreshSnapshots: { await events.append("refresh") },
            notify: { _ in await events.append("notify") }
        )

        let recorded = await events.values()
        XCTAssertEqual(recorded, ["generate", "refresh"])
    }

    private func response(shouldNotify: Bool) -> CoachMessageAPIResponse {
        CoachMessageAPIResponse(
            message: CoachMessageRecord(
                id: "cm-12345678-abcd-4abc-8abc-123456789abc",
                createdAt: "2026-08-23T20:00:00.000Z",
                activityIds: ["healthkit:AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE"],
                body: "Exact Coach body.",
                conversationSeedId: "local-proactive-cm-12345678-abcd-4abc-8abc-123456789abc"
            ),
            delivered: true,
            idempotent: !shouldNotify,
            shouldNotify: shouldNotify,
            repoSha: "abc123"
        )
    }

    private enum TestError: Error { case failed }

    private actor EventLog {
        private var events: [String] = []
        func append(_ event: String) { events.append(event) }
        func values() -> [String] { events }
    }

    private final class StubGenerator: CoachMessageGenerating {
        let result: Result<CoachMessageAPIResponse, Error>
        let events: EventLog

        init(result: Result<CoachMessageAPIResponse, Error>, events: EventLog) {
            self.result = result
            self.events = events
        }

        func generate(
            for activityIds: [String],
            repoFullName: String
        ) async throws -> CoachMessageAPIResponse {
            await events.append("generate")
            return try result.get()
        }
    }
}
