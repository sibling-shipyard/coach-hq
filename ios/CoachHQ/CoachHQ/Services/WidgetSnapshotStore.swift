import Foundation
import Combine
import WidgetKit

/// Observable store for Warm Instrument Home snapshots (ADR 0005).
/// Fetches live snapshots from the hosted dashboard API (`/api/widget-snapshots`), which
/// runs the TS generator server-side from `gen/aggregate.json`. Caches the last good snapshot
/// locally and mirrors it to the App Group for WidgetKit.
@MainActor
class WidgetSnapshotStore: ObservableObject {
    @Published var snapshots: WidgetSnapshotsFile?
    @Published var isLoading = false
    @Published var lastFetchedAt: Date?
    @Published var lastError: String?
    @Published private(set) var isConfigured = false

    private var apiClient: GitHubAPIClient?

    private static let cacheKey = "widget_snapshots_cache"
    private static let cacheFetchedAtKey = "widget_snapshots_cache_fetched_at"

    init() {
        loadCached()
    }

    func configure(apiClient: GitHubAPIClient) {
        self.apiClient = apiClient
        isConfigured = true
    }

    // MARK: - Cache

    private func loadCached() {
        guard let data = UserDefaults.standard.data(forKey: Self.cacheKey) else { return }
        do {
            snapshots = try JSONDecoder().decode(WidgetSnapshotsFile.self, from: data)
            lastFetchedAt = UserDefaults.standard.object(forKey: Self.cacheFetchedAtKey) as? Date
        } catch {
            // Drop corrupt cache — e.g. schema drift or a partial placeholder file that
            // decoded before `sizes` was required. A fresh GitHub fetch will repopulate.
            UserDefaults.standard.removeObject(forKey: Self.cacheKey)
            UserDefaults.standard.removeObject(forKey: Self.cacheFetchedAtKey)
        }
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

    /// Fetches the latest snapshots from the hosted dashboard API.
    /// `showSpinner` is `false` for background refreshes where stale data is already on screen.
    func refresh(showSpinner: Bool = true) async {
        guard let apiClient else { return }
        guard !isLoading else { return }

        if showSpinner { isLoading = true }
        defer { isLoading = false }

        do {
            let file = try await apiClient.fetchWidgetSnapshots()
            snapshots = file
            lastError = nil
            persist(file)
        } catch let error as GitHubAPIError {
            if case .sessionNotReady = error { return }
            lastError = error.errorDescription ?? "Couldn't load Home"
        } catch {
            lastError = "Couldn't load Home"
        }
    }
}
