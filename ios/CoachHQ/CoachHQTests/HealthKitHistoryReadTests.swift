import HealthKit
import XCTest
@testable import CoachHQ

@MainActor
final class HealthKitHistoryReadTests: XCTestCase {
    func testGarminRewriteReadFailureStopsWholeBatchAndRetryUpsertsCanonicalFile() async throws {
        let (manager, client) = fixture()
        // One body succeeds while the old Garmin recording's body fails. A partial
        // history must not let the rewritten UUID or the unrelated new workout upload.
        client.bodies[Self.otherFile] = try Self.activityData(id: Self.otherID, hour: "06")
        client.bodyError = URLError(.networkConnectionLost)
        let rewrittenUUID = manager.workouts[0].uuid.uuidString

        await manager.syncNewWorkouts()

        XCTAssertTrue(client.commits.isEmpty)
        XCTAssertEqual(manager.heartRateReads, 0)
        XCTAssertFalse(manager.isSyncing)
        guard case .failed = manager.lastSyncResult?.outcome else {
            return XCTFail("A required history read failure must fail sync")
        }
        XCTAssertNotNil(manager.syncError)
        XCTAssertNil(manager.lastSyncDate)
        XCTAssertNil(manager.syncState?.hkLastSynced)

        client.bodyError = nil
        await manager.syncNewWorkouts()

        let files = try XCTUnwrap(client.commits.first)
        let canonicalData = try XCTUnwrap(files.first { $0.path == Self.histPath + Self.canonicalFile }?.data)
        let canonical = try JSONDecoder().decode(Activity.self, from: canonicalData)
        XCTAssertEqual(canonical.activityId, Self.canonicalID)
        XCTAssertEqual(canonical.name, "Calisthenics #7")
        XCTAssertEqual(canonical.aliases, [rewrittenUUID])
        XCTAssertFalse(files.contains { $0.path.contains(rewrittenUUID) })
        XCTAssertEqual(files.filter { $0.path.hasPrefix(Self.histPath) }.count, 2)
        XCTAssertEqual(client.commits.count, 1)
    }

    func testListedFile404FailsSync() async {
        TimelineBuffer.shared.clearOnSignOut()
        let (manager, client) = fixture()
        client.bodyError = GitHubAPIError.notFound(operation: "Reading listed history")
        await manager.syncNewWorkouts()
        XCTAssertTrue(client.commits.isEmpty)
        guard case .failed = manager.lastSyncResult?.outcome else {
            return XCTFail("A listed file's 404 is not an empty history")
        }
        let events = TimelineBuffer.shared.getEvents()
        XCTAssertEqual(events.filter { $0.category == "healthkit.history.read" }.count, 1)
    }

    func testMalformedRequiredBodyFailsSync() async {
        let (manager, client) = fixture()
        client.bodies[Self.canonicalFile] = Data("{broken".utf8)
        await manager.syncNewWorkouts()
        XCTAssertTrue(client.commits.isEmpty)
        guard case .failed = manager.lastSyncResult?.outcome else {
            return XCTFail("A decode failure must not drop a committed session")
        }
    }

    func testCancelledRequiredReadStopsWithoutFailureToast() async {
        let (manager, client) = fixture()
        client.bodyError = CancellationError()
        await manager.syncNewWorkouts()
        XCTAssertTrue(client.commits.isEmpty)
        XCTAssertNil(manager.lastSyncResult)
        XCTAssertNil(manager.syncError)
        XCTAssertFalse(manager.isSyncing)
    }

    func testMissingHistoryDirectoryAllowsFirstInsert() async throws {
        TimelineBuffer.shared.clearOnSignOut()
        let (manager, client) = fixture()
        client.listError = GitHubAPIError.notFound(operation: "Listing history")
        await manager.syncNewWorkouts()
        let files = try XCTUnwrap(client.commits.first)
        XCTAssertEqual(files.filter { $0.path.hasPrefix(Self.histPath) }.count, 2)
        XCTAssertTrue(files.contains { $0.path.contains(manager.workouts[0].uuid.uuidString) })
        XCTAssertTrue(TimelineBuffer.shared.getEvents().allSatisfy {
            $0.category != "healthkit.history.read"
        })
    }

    func testFailedDirectoryListingStopsSync() async {
        let (manager, client) = fixture()
        client.listError = URLError(.timedOut)
        await manager.syncNewWorkouts()
        XCTAssertTrue(client.commits.isEmpty)
        XCTAssertNotNil(manager.syncError)
    }

    func testImportPreviewFailsOnUnreadableGarminHistoryAndRetryShowsSynced() async throws {
        let (manager, client) = fixture()
        client.bodyError = URLError(.timedOut)
        let failedRows = await manager.loadHealthImportRows(daysBack: 3650)
        XCTAssertNil(failedRows)

        client.bodyError = nil
        let retriedRows = await manager.loadHealthImportRows(daysBack: 3650)
        let rows = try XCTUnwrap(retriedRows)
        let canonicalRow = try XCTUnwrap(rows.first { $0.id == Self.canonicalID })
        XCTAssertEqual(canonicalRow.state, .synced)
        XCTAssertFalse(rows.contains { $0.id == manager.workouts[0].uuid.uuidString })
    }

    func testManualImportCannotBypassRequiredHistoryRead() async {
        let (manager, client) = fixture()
        client.bodyError = URLError(.timedOut)
        let workout = manager.workouts[0]
        await manager.syncNewWorkouts(importing: .init(
            uuids: [workout.uuid.uuidString], since: workout.startDate.addingTimeInterval(-60)
        ))
        XCTAssertTrue(client.commits.isEmpty)
        XCTAssertNotNil(manager.syncError)
    }

    private static let histPath = "user_data/activities/hist/"
    private static let canonicalID = "11111111-1111-4111-8111-111111111111"
    private static let otherID = "22222222-2222-4222-8222-222222222222"
    private static let canonicalFile = "hk_\(day)_\(canonicalID).json"
    private static let otherFile = "hk_\(day)_\(otherID).json"

    private static var day: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Calendar.current.date(byAdding: .day, value: -1, to: Date())!)
    }

    private func fixture() -> (HistoryTestSyncManager, HistoryTestClient) {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        formatter.timeZone = .current
        let start = formatter.date(from: "\(Self.day)T08:00:00")!
        let workouts = [start, start.addingTimeInterval(4 * 3600)].map {
            HKWorkout(activityType: .traditionalStrengthTraining, start: $0,
                      end: $0.addingTimeInterval(3600))
        }
        let client = HistoryTestClient(authManager: GitHubAuthManager())
        client.bodies[Self.canonicalFile] = try! Self.activityData(id: Self.canonicalID, hour: "08")
        let manager = HistoryTestSyncManager()
        manager.workouts = workouts
        manager.configure(apiClient: client)
        return (manager, client)
    }

    private static func activityData(id: String, hour: String) throws -> Data {
        let activity = Activity(
            name: "Calisthenics #7", sportType: "WeightTraining",
            startDateLocal: "\(day)T\(hour):00:00", elapsedTime: 3600, movingTime: 3600,
            calories: 200, distance: 0, totalElevationGain: 0,
            averageHeartrate: nil, maxHeartrate: nil, hasHeartrate: false, hrZones: nil,
            description: nil, totalPhotoCount: 0, averageSpeed: 0, maxSpeed: 0,
            deviceName: "Garmin", source: "healthkit", activityId: id
        )
        return try JSONEncoder().encode(activity)
    }
}

private final class HistoryTestSyncManager: HealthKitSyncManager {
    var workouts: [HKWorkout] = []
    private(set) var heartRateReads = 0

    override func fetchWorkouts(since startDate: Date) async throws -> [HKWorkout] {
        workouts.filter { $0.startDate >= startDate }
    }

    override func fetchHeartRateSamples(from start: Date, to end: Date) async throws -> [(date: Date, bpm: Double)] {
        heartRateReads += 1
        return []
    }
}

private final class HistoryTestClient: GitHubAPIClient {
    var bodies: [String: Data] = [:]
    var bodyError: Error?
    var listError: Error?
    private(set) var commits: [[(path: String, data: Data)]] = []

    override func readSyncState() async throws -> SyncState { SyncState() }

    override func listFiles(path: String) async throws -> [GitHubFileEntry] {
        if let listError { throw listError }
        return bodies.keys.sorted().map {
            GitHubFileEntry(name: $0, path: path + "/" + $0, type: "file", sha: "test")
        }
    }

    override func readFile(path: String) async throws -> Data {
        // Zone reads are optional to this regression and must not touch stored settings.
        if path == HRZoneStore.path { return Data() }
        let name = String(path.split(separator: "/").last!)
        if name.contains("11111111"), let bodyError { throw bodyError }
        guard let body = bodies[name] else { throw GitHubAPIError.notFound(operation: "Reading history") }
        return body
    }

    override func commitFiles(_ files: [(path: String, data: Data)], message: String) async throws -> String {
        commits.append(files)
        // Capture the real sync write set without updating device caches or starting fanout.
        throw CancellationError()
    }
}
