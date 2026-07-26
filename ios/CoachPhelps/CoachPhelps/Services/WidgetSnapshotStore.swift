import Foundation
import Combine
import WidgetKit

/// Observable store for `gen/widget_snapshots.json` (ADR 0005's cross-platform contract).
/// Caches the last good snapshot in `UserDefaults` so Home has something to render on cold
/// launch / offline before the network read completes, and re-fetches on demand (pull-to-
/// refresh, post-HealthKit-sync). A failed refresh never clears an already-loaded snapshot —
/// Home stays on the last good read and surfaces `lastError` instead of going blank.
@MainActor
class WidgetSnapshotStore: ObservableObject {
    @Published var snapshots: WidgetSnapshotsFile?
    @Published var isLoading = false
    @Published var lastFetchedAt: Date?
    @Published var lastError: String?

    private var apiClient: GitHubAPIClient?

    private static let cacheKey = "widget_snapshots_cache"
    private static let cacheFetchedAtKey = "widget_snapshots_cache_fetched_at"

    init() {
        loadCached()
    }

    func configure(apiClient: GitHubAPIClient) {
        self.apiClient = apiClient
    }

    // MARK: - Cache

    private func loadCached() {
        guard let data = UserDefaults.standard.data(forKey: Self.cacheKey) else { return }
        snapshots = try? JSONDecoder().decode(WidgetSnapshotsFile.self, from: data)
        lastFetchedAt = UserDefaults.standard.object(forKey: Self.cacheFetchedAtKey) as? Date
    }

    /// Persists the last good snapshot locally (in-app cache) and mirrors it into the App
    /// Group shared container for the WidgetKit extension, then nudges WidgetKit to redraw
    /// the S-size home screen widgets against the fresh data instead of waiting out their
    /// own timeline policy.
    func persist(_ file: WidgetSnapshotsFile) {
        guard let data = try? JSONEncoder().encode(file) else { return }
        UserDefaults.standard.set(data, forKey: Self.cacheKey)
        let now = Date()
        UserDefaults.standard.set(now, forKey: Self.cacheFetchedAtKey)
        lastFetchedAt = now

        AppGroupSnapshotBridge.write(file)
        WidgetCenter.shared.reloadAllTimelines()
    }

    // MARK: - Refresh

    /// Fetches the latest snapshot file from GitHub via `GitHubAPIClient.readWidgetSnapshots()`.
    /// `showSpinner` is `false` for background refreshes (pull-to-refresh, post-sync) where a
    /// stale-but-present snapshot is already on screen.
    func refresh(showSpinner: Bool = true) async {
        guard let apiClient else { return }
        guard !isLoading else { return }

        if showSpinner { isLoading = true }
        defer { isLoading = false }

        do {
            let file = try await apiClient.readWidgetSnapshots()
            snapshots = file
            lastError = nil
            persist(file)
        } catch {
            lastError = (error as? GitHubAPIError)?.errorDescription ?? "Couldn't load Home"
        }
    }
}
