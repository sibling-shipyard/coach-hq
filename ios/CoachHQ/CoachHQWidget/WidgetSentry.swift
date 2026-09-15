import Foundation
import Sentry

/// Lightweight Sentry wiring for the widget extension. The main app's `DiagnosticsManager`
/// is not in this target — keep init minimal (DSN + release tags, no traces/replay) so a
/// failed App Group read during timeline reload still shows up as an issue.
enum WidgetSentry {
    private static var didConfigure = false
    private static var isEnabled = false

    static var releaseName: String {
        let bundle = Bundle.main
        let identifier = bundle.bundleIdentifier ?? "com.siblingshipyard.coachhq.widget"
        let version = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown"
        let build = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown"
        return "\(identifier)@\(version)+\(build)"
    }

    static func configureIfNeeded() {
        guard !didConfigure else { return }
        didConfigure = true
        let dsn = Secrets.sentryDSN.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !dsn.isEmpty, !dsn.contains("example@sentry.io") else { return }

        SentrySDK.start { options in
            options.dsn = dsn
            options.releaseName = releaseName
            options.dist = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown"
#if DEBUG
            options.environment = "development"
#else
            options.environment = "production"
#endif
            options.tracesSampleRate = 0
            options.enableAutoSessionTracking = false
            options.enableFileIOTracing = false
            options.attachScreenshot = false
            options.sessionReplay = SentryReplayOptions(sessionSampleRate: 0, onErrorSampleRate: 0)
        }
        isEnabled = true
    }

    static func capture(error: Error, operation: String) {
        configureIfNeeded()
        guard isEnabled else { return }
        let operationID = UUID()
        SentrySDK.capture(error: error) { scope in
            scope.setTag(value: operation, key: "operation")
            scope.setTag(value: operationID.uuidString, key: "operation_id")
        }
    }

    /// App Group read for timeline/snapshot providers. Missing file → empty glance; real
    /// read/decode failures → Sentry, then empty glance (never fabricated numbers).
    static func loadSnapshots() -> WidgetSnapshotsFile? {
        configureIfNeeded()
        do {
            return try AppGroupSnapshotBridge.read()
        } catch {
            capture(error: error, operation: "widget.timeline.read")
            return nil
        }
    }
}
