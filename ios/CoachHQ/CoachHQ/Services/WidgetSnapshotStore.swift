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
    /// Account (`repoFullName`) the on-disk cache was written for. The cache key itself
    /// isn't scoped per account — instead we store who it belongs to and refuse to load
    /// it for anyone else. Without this, the previous signed-in account's cached Home
    /// snapshot paints instantly on cold launch / account switch and only gets overwritten
    /// once the real fetch lands ~5s later.
    private static let cacheAccountKey = "widget_snapshots_cache_account"

    init() {
        // Cache load is deferred to `configure(apiClient:)` — before the signed-in account
        // is known, loading would risk rendering a previous account's snapshot.
    }

    func configure(apiClient: GitHubAPIClient) {
        self.apiClient = apiClient
        isConfigured = true
        loadCached()
    }

    /// Drops in-memory and on-disk snapshot data so a stale account's Home can never
    /// survive a sign-out or account switch.
    func reset() {
        snapshots = nil
        lastFetchedAt = nil
        lastError = nil
        UserDefaults.standard.removeObject(forKey: Self.cacheKey)
        UserDefaults.standard.removeObject(forKey: Self.cacheFetchedAtKey)
        UserDefaults.standard.removeObject(forKey: Self.cacheAccountKey)
    }

    // MARK: - Cache

    private func loadCached() {
        // Never render a cache written for a different (or no longer known) account.
        let cachedAccount = UserDefaults.standard.string(forKey: Self.cacheAccountKey)
        guard let currentAccount = apiClient?.repoFullName, cachedAccount == currentAccount else {
            if cachedAccount != nil { clearCacheStorage() }
            return
        }
        guard let data = UserDefaults.standard.data(forKey: Self.cacheKey) else { return }
        do {
            snapshots = try JSONDecoder().decode(WidgetSnapshotsFile.self, from: data)
            lastFetchedAt = UserDefaults.standard.object(forKey: Self.cacheFetchedAtKey) as? Date
        } catch {
            // Drop corrupt cache — e.g. schema drift or a partial placeholder file that
            // decoded before `sizes` was required. A fresh GitHub fetch will repopulate.
            clearCacheStorage()
        }
    }

    private func clearCacheStorage() {
        UserDefaults.standard.removeObject(forKey: Self.cacheKey)
        UserDefaults.standard.removeObject(forKey: Self.cacheFetchedAtKey)
        UserDefaults.standard.removeObject(forKey: Self.cacheAccountKey)
    }

    /// Persists the last good snapshot locally (in-app cache, tagged with the account it
    /// belongs to) and mirrors it into the App Group shared container for the WidgetKit
    /// extension, then nudges WidgetKit to redraw the S-size home screen widgets against
    /// the fresh data instead of waiting out their own timeline policy.
    func persist(_ file: WidgetSnapshotsFile) {
        guard let data = try? JSONEncoder().encode(file) else { return }
        UserDefaults.standard.set(data, forKey: Self.cacheKey)
        let now = Date()
        UserDefaults.standard.set(now, forKey: Self.cacheFetchedAtKey)
        if let account = apiClient?.repoFullName {
            UserDefaults.standard.set(account, forKey: Self.cacheAccountKey)
        }
        lastFetchedAt = now

        AppGroupSnapshotBridge.write(file)
        WidgetCenter.shared.reloadAllTimelines()
    }

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

    /// Polls Home snapshots after a HealthKit commit until the user-repo sync workflow
    /// has regenerated `gen/aggregate.json` (timestamp in `home.sync`) or attempts exhaust.
    func refreshAfterSync(since commitFinishedAt: Date) async {
        let waitSeconds: [UInt64] = [0, 15, 15, 20, 20, 30]
        for (attempt, delay) in waitSeconds.enumerated() {
            if attempt > 0 {
                try? await Task.sleep(nanoseconds: delay * 1_000_000_000)
            }
            await refresh(showSpinner: false)
            if snapshotsAreFresh(since: commitFinishedAt) { return }
        }
    }

    private func snapshotsAreFresh(since commitFinishedAt: Date) -> Bool {
        guard let timestamp = snapshots?.home.sync.timestamp,
              let pipelineAt = Self.parseSyncTimestamp(timestamp) else { return false }
        return pipelineAt >= commitFinishedAt
    }

    private static func parseSyncTimestamp(_ raw: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: raw) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: raw)
    }

    /// Skip automatic refresh when snapshots are fresh (5 min) — tab switches stay calm.
    var shouldRefresh: Bool {
        guard snapshots != nil else { return true }
        guard let lastFetchedAt else { return true }
        return Date().timeIntervalSince(lastFetchedAt) > 300
    }
}
