import Foundation

/// Bridges `gen/widget_snapshots.json` between the main app and the WidgetKit extension
/// via an App Group shared container — WidgetKit timelines can't reach `GitHubAPIClient`
/// (no network entitlement, no auth), so the app writes what it already fetched and the
/// extension only ever reads the local mirror. Per ADR 0005, still no analytics here — this
/// is a plain file copy of the same snapshot the app already decoded.
///
/// **Xcode setup (manual, see `patches/PATCHES.md`):** add this file to both the main app
/// target and the widget extension target's membership, and add the App Group capability
/// (`\(appGroupID)`) to both targets.
enum AppGroupSnapshotBridge {
    static let appGroupID = "group.com.coachphelps.ios"
    private static let fileName = "widget_snapshots.json"

    private static var containerURL: URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroupID)?
            .appendingPathComponent(fileName)
    }

    /// Writes the snapshot file into the shared container. Called by `WidgetSnapshotStore`
    /// after every successful `refresh()` so the WidgetKit extension always mirrors the last
    /// good fetch the app made — never re-derives or re-fetches on its own.
    static func write(_ file: WidgetSnapshotsFile) {
        guard let url = containerURL, let data = try? JSONEncoder().encode(file) else { return }
        try? data.write(to: url, options: .atomic)
    }

    /// Reads the last snapshot the app mirrored. Returns `nil` before the first successful
    /// app-side refresh (fresh install, App Group misconfigured) — callers render the
    /// glance-only empty state in that case, never fabricated numbers.
    static func read() -> WidgetSnapshotsFile? {
        guard let url = containerURL, let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshotsFile.self, from: data)
    }
}
