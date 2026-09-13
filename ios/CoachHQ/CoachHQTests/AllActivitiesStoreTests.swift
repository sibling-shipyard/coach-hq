import XCTest
@testable import CoachHQ

@MainActor
final class AllActivitiesStoreTests: XCTestCase {

    func testReadyRepoSkipsGitHub() async {
        let store = AllActivitiesStore()
        let entry = Self.entry(fileName: "hk_2026-09-13_a.json")
        store.seedLoaded(repo: "a/b", names: [entry.fileName], entries: [entry])
        let client = FakeHistClient(names: ["hk_2026-09-13_a.json", "hk_2026-09-01_b.json"])

        await store.loadInitialIfNeeded(repo: "a/b", client: client)

        XCTAssertEqual(client.listCount, 0)
        XCTAssertTrue(client.reads.isEmpty)
        XCTAssertEqual(store.loadedEntries.map(\.fileName), [entry.fileName])
    }

    func testResetClearsLoadedRepo() async {
        let store = AllActivitiesStore()
        store.seedLoaded(repo: "a/b", names: ["hk_z.json"], entries: [Self.entry(fileName: "hk_z.json")])
        store.reset()

        let client = FakeHistClient(names: ["hk_z.json"])
        await store.loadInitialIfNeeded(repo: "a/b", client: client)

        XCTAssertEqual(client.listCount, 1)
        XCTAssertEqual(client.reads, ["hk_z.json"])
    }

    func testRepoKeyRestoresWithoutRefetch() async {
        let store = AllActivitiesStore()
        store.initialPageSize = 1
        let clientA = FakeHistClient(names: ["hk_a.json"], activities: [
            "hk_a.json": Self.activity(name: "A")
        ])
        let clientB = FakeHistClient(names: ["hk_b.json"], activities: [
            "hk_b.json": Self.activity(name: "B")
        ])

        await store.loadInitialIfNeeded(repo: "one/a", client: clientA)
        await store.loadInitialIfNeeded(repo: "two/b", client: clientB)
        await store.loadInitialIfNeeded(repo: "one/a", client: clientA)

        XCTAssertEqual(clientA.listCount, 1)
        XCTAssertEqual(clientA.reads, ["hk_a.json"])
        XCTAssertEqual(store.loadedEntries.map(\.fileName), ["hk_a.json"])
    }

    func testLoadMoreFetchesNextPageOnly() async {
        let store = AllActivitiesStore()
        store.initialPageSize = 1
        store.loadMorePageSize = 1
        let client = FakeHistClient(
            names: ["hk_c.json", "hk_b.json", "hk_a.json"],
            activities: [
                "hk_c.json": Self.activity(name: "C"),
                "hk_b.json": Self.activity(name: "B"),
                "hk_a.json": Self.activity(name: "A"),
            ]
        )

        await store.loadInitialIfNeeded(repo: "a/b", client: client)
        XCTAssertEqual(client.reads, ["hk_c.json"])
        XCTAssertTrue(store.hasMore)

        await store.loadMore(client: client)
        XCTAssertEqual(client.reads, ["hk_c.json", "hk_b.json"])
        XCTAssertEqual(store.loadedEntries.map(\.fileName), ["hk_c.json", "hk_b.json"])
    }

    func testFailedReadDoesNotSkewTheNextPage() async {
        let store = AllActivitiesStore()
        store.initialPageSize = 2
        store.loadMorePageSize = 2
        let client = FakeHistClient(
            names: ["hk_d.json", "hk_c.json", "hk_b.json", "hk_a.json"],
            activities: [
                "hk_d.json": Self.activity(name: "D"),
                "hk_b.json": Self.activity(name: "B"),
                "hk_a.json": Self.activity(name: "A"),
            ]
        )

        await store.loadInitialIfNeeded(repo: "a/b", client: client)
        XCTAssertEqual(client.reads, ["hk_d.json", "hk_c.json"])
        XCTAssertEqual(store.loadedEntries.map(\.fileName), ["hk_d.json"])
        XCTAssertTrue(store.hasMore)

        await store.loadMore(client: client)
        XCTAssertEqual(client.reads, ["hk_d.json", "hk_c.json", "hk_b.json", "hk_a.json"])
        XCTAssertEqual(store.loadedEntries.map(\.fileName), ["hk_d.json", "hk_b.json", "hk_a.json"])
        XCTAssertFalse(store.hasMore)
    }

    func testIngestFetchesOnlyLeadingNewNames() async {
        let store = AllActivitiesStore()
        store.seedLoaded(
            repo: "a/b",
            names: ["hk_b.json", "hk_a.json"],
            entries: [Self.entry(fileName: "hk_b.json"), Self.entry(fileName: "hk_a.json")]
        )
        let client = FakeHistClient(
            names: ["hk_c.json", "hk_b.json", "hk_a.json"],
            activities: ["hk_c.json": Self.activity(name: "C")]
        )

        await store.ingestNewHist(repo: "a/b", client: client)

        XCTAssertEqual(client.listCount, 1)
        XCTAssertEqual(client.reads, ["hk_c.json"])
        XCTAssertEqual(store.allFileNames, ["hk_c.json", "hk_b.json", "hk_a.json"])
        XCTAssertEqual(store.loadedEntries.map(\.fileName), ["hk_c.json", "hk_b.json", "hk_a.json"])
    }

    func testIngestNoopsUntilInitialLoad() async {
        let store = AllActivitiesStore()
        let client = FakeHistClient(names: ["hk_a.json"])

        await store.ingestNewHist(repo: "a/b", client: client)

        XCTAssertEqual(client.listCount, 0)
        XCTAssertTrue(store.loadedEntries.isEmpty)
    }

    func testLeadingNewNamesTakesOnlyTheUnknownPrefix() {
        XCTAssertEqual(
            AllActivitiesStore.leadingNewNames(
                existing: ["hk_b.json", "hk_a.json"],
                listing: ["hk_d.json", "hk_c.json", "hk_b.json", "hk_a.json"]
            ),
            ["hk_d.json", "hk_c.json"]
        )
        XCTAssertEqual(
            AllActivitiesStore.leadingNewNames(
                existing: ["hk_b.json"],
                listing: ["hk_b.json", "hk_a.json"]
            ),
            []
        )
    }

    // MARK: - Fixtures

    private static func activity(name: String) -> Activity {
        Activity(
            name: name,
            sportType: "Run",
            startDateLocal: "2026-09-13T08:00:00",
            elapsedTime: 1800,
            movingTime: 1800,
            calories: 200,
            distance: 5000,
            totalElevationGain: 0,
            averageHeartrate: 140,
            maxHeartrate: 160,
            hasHeartrate: true,
            hrZones: nil,
            description: nil,
            totalPhotoCount: 0,
            averageSpeed: 2.7,
            maxSpeed: 3.5,
            deviceName: nil,
            source: "healthkit"
        )
    }

    private static func entry(fileName: String, name: String = "Run") -> SyncCacheEntry {
        SyncCacheEntry(fileName: fileName, activity: activity(name: name), hasDescription: false)
    }
}

private final class FakeHistClient: ActivityHistFetching {
    var names: [String]
    var activities: [String: Activity]
    private(set) var listCount = 0
    private(set) var reads: [String] = []

    init(names: [String], activities: [String: Activity] = [:]) {
        self.names = names
        self.activities = activities
    }

    func listHistFileNames() async throws -> [String] {
        listCount += 1
        return names
    }

    func readActivity(fileName: String) async throws -> Activity {
        reads.append(fileName)
        guard let activity = activities[fileName] else {
            throw GitHubAPIError.notFound(operation: "Reading \(fileName)")
        }
        return activity
    }
}
