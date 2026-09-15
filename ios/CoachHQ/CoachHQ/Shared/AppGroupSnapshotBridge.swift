import Foundation

/// Bridges `gen/widget_snapshots.json` between the main app and the WidgetKit extension
/// via an App Group shared container — WidgetKit timelines can't reach `GitHubAPIClient`
/// (no network entitlement, no auth), so the app writes what it already fetched and the
/// extension only ever reads the local mirror. Per ADR 0005, still no analytics here — this
/// is a plain file copy of the same snapshot the app already decoded. Callers own diagnostics
/// when encode/write/read/decode fails (main app: `DiagnosticsManager`; widget: `WidgetSentry`).
///
/// **Xcode setup (manual, see `patches/PATCHES.md`):** add this file to both the main app
/// target and the widget extension target's membership, and add the App Group capability
/// (`\(appGroupID)`) to both targets.
enum AppGroupSnapshotBridge {
    static let appGroupID = "group.com.siblingshipyard.coachhq.ios"
    private static let fileName = "widget_snapshots.json"

    enum Error: Swift.Error, LocalizedError {
        case containerUnavailable
        case readFailed(Swift.Error)
        case decodeFailed(Swift.Error)

        var errorDescription: String? {
            switch self {
            case .containerUnavailable:
                return "App Group container unavailable for \(AppGroupSnapshotBridge.appGroupID)"
            case .readFailed(let underlying):
                return "App Group snapshot read failed: \(underlying.localizedDescription)"
            case .decodeFailed(let underlying):
                return "App Group snapshot decode failed: \(underlying.localizedDescription)"
            }
        }
    }

    private static var containerURL: URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroupID)?
            .appendingPathComponent(fileName)
    }

    /// Writes the snapshot file into the shared container. Called by `WidgetSnapshotStore`
    /// after every successful `refresh()` so the WidgetKit extension always mirrors the last
    /// good fetch the app made — never re-derives or re-fetches on its own.
    static func write(_ file: WidgetSnapshotsFile) throws {
        try write(try JSONEncoder().encode(file))
    }

    /// Same as `write(_:)` when the caller already holds encoded bytes (avoids a second encode
    /// on the main-app persist path).
    static func write(_ data: Data) throws {
        guard let url = containerURL else { throw Error.containerUnavailable }
        try data.write(to: url, options: .atomic)
    }

    /// Reads the last snapshot the app mirrored. Returns `nil` before the first successful
    /// app-side refresh (fresh install) — callers render the glance-only empty state in that
    /// case, never fabricated numbers. Throws when the App Group is missing or the on-disk
    /// file is unreadable/corrupt (stale widgets forever if ignored).
    static func read() throws -> WidgetSnapshotsFile? {
        guard let url = containerURL else { throw Error.containerUnavailable }
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let data: Data
        do {
            data = try Data(contentsOf: url)
        } catch {
            throw Error.readFailed(error)
        }
        do {
            return try JSONDecoder().decode(WidgetSnapshotsFile.self, from: data)
        } catch {
            throw Error.decodeFailed(error)
        }
    }
}
