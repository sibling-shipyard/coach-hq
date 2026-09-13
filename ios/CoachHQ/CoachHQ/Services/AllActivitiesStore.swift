import Combine
import Foundation
import SwiftUI

/// GitHub hist listing + lazily fetched bodies for All Activity.
///
/// Session-scoped (same lifetime as `WorkoutService`), keyed by repo. Not `SyncCache`:
/// that shelf only backfills 7 days and evicts past 30, so it cannot back this list.
protocol ActivityHistFetching {
    func listHistFileNames() async throws -> [String]
    func readActivity(fileName: String) async throws -> Activity
}

struct GitHubActivityHistClient: ActivityHistFetching {
    let api: GitHubAPIClient

    init(authManager: GitHubAuthManager) {
        self.api = GitHubAPIClient(authManager: authManager)
    }

    func listHistFileNames() async throws -> [String] {
        try await api.listFiles(path: "user_data/activities/hist")
            .filter { $0.type == "file" }
            .map(\.name)
            .sorted(by: >)
    }

    func readActivity(fileName: String) async throws -> Activity {
        try await api.readActivity(fileName: fileName)
    }
}

@MainActor
final class AllActivitiesStore: ObservableObject {
    static let defaultInitialPageSize = 50
    static let defaultLoadMorePageSize = 20

    var initialPageSize = AllActivitiesStore.defaultInitialPageSize
    var loadMorePageSize = AllActivitiesStore.defaultLoadMorePageSize

    @Published private(set) var allFileNames: [String] = []
    @Published private(set) var loadedEntries: [SyncCacheEntry] = []
    @Published private(set) var isLoadingInitial = false
    @Published private(set) var isLoadingMore = false
    @Published private(set) var loadError: String?

    var hasMore: Bool { loadedEntries.count < allFileNames.count }

    private struct RepoState {
        var allFileNames: [String] = []
        var loadedEntries: [SyncCacheEntry] = []
        var didInitialLoad = false
        var loadError: String?
    }

    private var caches: [String: RepoState] = [:]
    private var currentRepo: String?
    private var serial: Task<Void, Never>?
    private var generation = 0

    func reset() {
        generation += 1
        serial?.cancel()
        serial = nil
        caches = [:]
        currentRepo = nil
        allFileNames = []
        loadedEntries = []
        isLoadingInitial = false
        isLoadingMore = false
        loadError = nil
    }

    func loadInitialIfNeeded(repo: String, client: ActivityHistFetching) async {
        await enqueue { [weak self] in
            await self?.loadInitialIfNeededUnlocked(repo: repo, client: client)
        }
    }

    func retry(repo: String, client: ActivityHistFetching) async {
        await enqueue { [weak self] in
            guard let self else { return }
            self.caches[repo] = nil
            if self.currentRepo == repo {
                self.allFileNames = []
                self.loadedEntries = []
                self.loadError = nil
            }
            await self.loadInitialIfNeededUnlocked(repo: repo, client: client)
        }
    }

    func loadMore(client: ActivityHistFetching) async {
        await enqueue { [weak self] in
            await self?.loadMoreUnlocked(client: client)
        }
    }

    /// After a hist sync: re-list, fetch only names newer than the cached head, prepend.
    /// No-op until this repo has completed an initial load.
    func ingestNewHist(repo: String, client: ActivityHistFetching) async {
        await enqueue { [weak self] in
            await self?.ingestUnlocked(repo: repo, client: client)
        }
    }

    /// Test seam: mark a repo loaded without GitHub.
    func seedLoaded(repo: String, names: [String], entries: [SyncCacheEntry]) {
        let state = RepoState(
            allFileNames: names,
            loadedEntries: entries,
            didInitialLoad: true,
            loadError: nil
        )
        caches[repo] = state
        publish(state, repo: repo)
    }

    /// Names at the front of `listing` that are not in `existing` (hist is append-newest).
    static func leadingNewNames(existing: [String], listing: [String]) -> [String] {
        let known = Set(existing)
        return Array(listing.prefix { !known.contains($0) })
    }

    private func enqueue(_ body: @escaping () async -> Void) async {
        let prior = serial
        let next = Task { @MainActor in
            await prior?.value
            guard !Task.isCancelled else { return }
            await body()
        }
        serial = next
        await next.value
    }

    private func loadInitialIfNeededUnlocked(repo: String, client: ActivityHistFetching) async {
        if let cached = caches[repo], cached.didInitialLoad {
            publish(cached, repo: repo)
            return
        }
        publish(caches[repo] ?? RepoState(), repo: repo)
        isLoadingInitial = true
        defer { isLoadingInitial = false }
        let gen = generation
        do {
            let names = try await client.listHistFileNames()
            guard gen == generation else { return }
            allFileNames = names
            loadError = nil
            persist(didInitialLoad: false)
            await fetchPageUnlocked(client: client, count: initialPageSize, generation: gen)
            guard gen == generation else { return }
            persist(didInitialLoad: true)
        } catch {
            guard gen == generation else { return }
            loadError = "Couldn't load activity history"
            persist(didInitialLoad: false)
        }
    }

    private func loadMoreUnlocked(client: ActivityHistFetching) async {
        guard hasMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        let gen = generation
        await fetchPageUnlocked(client: client, count: loadMorePageSize, generation: gen)
        guard gen == generation else { return }
        persist(didInitialLoad: true)
    }

    private func ingestUnlocked(repo: String, client: ActivityHistFetching) async {
        guard caches[repo]?.didInitialLoad == true else { return }
        if currentRepo != repo, let cached = caches[repo] {
            publish(cached, repo: repo)
        }
        let gen = generation
        do {
            let listing = try await client.listHistFileNames()
            guard gen == generation else { return }
            let newNames = Self.leadingNewNames(existing: allFileNames, listing: listing)
            allFileNames = listing
            guard !newNames.isEmpty else {
                persist(didInitialLoad: true)
                return
            }
            var newEntries: [SyncCacheEntry] = []
            for fileName in newNames {
                guard gen == generation else { return }
                guard let activity = try? await client.readActivity(fileName: fileName) else { continue }
                newEntries.append(SyncCacheEntry(
                    fileName: fileName,
                    activity: activity,
                    hasDescription: !(activity.description ?? "").isEmpty
                ))
            }
            guard gen == generation else { return }
            applyWithoutAnimation {
                loadedEntries.insert(contentsOf: newEntries, at: 0)
            }
            persist(didInitialLoad: true)
        } catch {
            // Keep the in-memory page. A failed listing must not wipe a successful load.
        }
    }

    private func fetchPageUnlocked(
        client: ActivityHistFetching,
        count: Int,
        generation gen: Int
    ) async {
        let start = loadedEntries.count
        guard start < allFileNames.count else { return }
        let end = min(start + count, allFileNames.count)
        var newEntries: [SyncCacheEntry] = []
        for fileName in allFileNames[start..<end] {
            guard gen == generation else { return }
            guard let activity = try? await client.readActivity(fileName: fileName) else { continue }
            newEntries.append(SyncCacheEntry(
                fileName: fileName,
                activity: activity,
                hasDescription: !(activity.description ?? "").isEmpty
            ))
        }
        guard gen == generation else { return }
        applyWithoutAnimation {
            loadedEntries.append(contentsOf: newEntries)
        }
    }

    private func applyWithoutAnimation(_ updates: () -> Void) {
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction, updates)
    }

    private func publish(_ state: RepoState, repo: String) {
        currentRepo = repo
        allFileNames = state.allFileNames
        loadedEntries = state.loadedEntries
        loadError = state.loadError
    }

    private func persist(didInitialLoad: Bool) {
        guard let repo = currentRepo else { return }
        caches[repo] = RepoState(
            allFileNames: allFileNames,
            loadedEntries: loadedEntries,
            didInitialLoad: didInitialLoad,
            loadError: loadError
        )
    }
}
