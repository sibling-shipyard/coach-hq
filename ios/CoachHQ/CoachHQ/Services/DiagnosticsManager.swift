import Foundation
import Sentry

struct TimelineEvent: Codable, Equatable {
    let id: UUID
    let timestamp: Date
    let category: String
    let message: String
    let operationID: UUID?
    let metadata: [String: String]

    init(
        id: UUID = UUID(),
        timestamp: Date = Date(),
        category: String,
        message: String,
        operationID: UUID? = nil,
        metadata: [String: String] = [:]
    ) {
        self.id = id
        self.timestamp = timestamp
        self.category = category
        self.message = message
        self.operationID = operationID
        self.metadata = metadata
    }
}

enum DiagnosticsScrubber {
    nonisolated private static let filtered = "[Filtered]"
    nonisolated private static let sensitiveKeys: Set<String> = [
        "authorization", "cookie", "setcookie", "xgithubtoken", "xsessiontoken",
        "geminiapikey", "sessionsecret", "githubappclientsecret"
    ]
    nonisolated private static let patterns = [
        #"ghp_[A-Za-z0-9_]{36,}"#,
        #"AIza[0-9A-Za-z_-]{35}"#,
        #"(?:Bearer\s+)?eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)?"#
    ].compactMap { try? NSRegularExpression(pattern: $0) }

    nonisolated static func isSensitiveKey(_ key: String) -> Bool {
        let normalized = key.lowercased().filter(\.isLetter)
        return sensitiveKeys.contains(normalized)
    }

    nonisolated static func scrub(_ string: String) -> String {
        patterns.reduce(string) { result, pattern in
            pattern.stringByReplacingMatches(
                in: result,
                range: NSRange(result.startIndex..., in: result),
                withTemplate: filtered
            )
        }
    }

    nonisolated static func scrub(_ value: Any) -> Any {
        switch value {
        case let string as String:
            return scrub(string)
        case let dictionary as [String: Any]:
            return scrub(dictionary)
        case let array as [Any]:
            return array.map(scrub)
        default:
            return value
        }
    }

    nonisolated static func scrub(_ dictionary: [String: Any]) -> [String: Any] {
        dictionary.reduce(into: [:]) { result, item in
            result[item.key] = isSensitiveKey(item.key) ? filtered : scrub(item.value)
        }
    }

    nonisolated static func scrub(_ dictionary: [String: String]) -> [String: String] {
        dictionary.reduce(into: [:]) { result, item in
            result[item.key] = isSensitiveKey(item.key) ? filtered : scrub(item.value)
        }
    }
}

/// The local diagnostic timeline. Bounded by count, bytes, and age per ADR 0031, and cleared
/// on sign-out. It lives in memory only: a Rage Report is filed in the session the problem
/// happened in, so surviving a relaunch buys nothing, and not writing diagnostics to disk means
/// there is no athlete data at rest to expire, migrate, or leak.
final class TimelineBuffer: @unchecked Sendable {
    static let shared = TimelineBuffer()

    static let eventLimit = 200
    static let byteLimit = 256 * 1024
    static let ageLimit: TimeInterval = 24 * 60 * 60

    private let queue = DispatchQueue(label: "com.coachhq.timelinebuffer")
    private let clock: () -> Date
    private var events: [TimelineEvent] = []
    private var encodedBytes = 0

    init(now: (() -> Date)? = nil) {
        clock = now ?? { Date() }
    }

    func addEvent(
        category: String,
        message: String,
        operationID: UUID? = nil,
        metadata: [String: String] = [:],
        timestamp: Date? = nil
    ) {
        queue.sync {
            events.append(TimelineEvent(
                timestamp: timestamp ?? clock(),
                category: DiagnosticsScrubber.scrub(category),
                message: DiagnosticsScrubber.scrub(message),
                operationID: operationID,
                metadata: DiagnosticsScrubber.scrub(metadata)
            ))
            enforceLimits()
        }
    }

    func getEvents() -> [TimelineEvent] {
        queue.sync {
            enforceLimits()
            return events
        }
    }

    func clearOnSignOut() {
        queue.sync {
            events.removeAll()
            encodedBytes = 0
        }
    }

    /// Size the timeline would occupy as a Rage Report attachment — the number the byte cap
    /// is about. Reported from the last enforcement rather than re-encoding on demand.
    var attachmentSizeBytes: Int {
        queue.sync {
            enforceLimits()
            return encodedBytes
        }
    }

    private func encodedSize(of events: [TimelineEvent]) -> Int {
        events.isEmpty ? 0 : (try? JSONEncoder().encode(events).count) ?? 0
    }

    private func enforceLimits() {
        let cutoff = clock().addingTimeInterval(-Self.ageLimit)
        events.removeAll { $0.timestamp <= cutoff }
        if events.count > Self.eventLimit {
            events = Array(events.suffix(Self.eventLimit))
        }

        encodedBytes = encodedSize(of: events)
        while events.count > 1, encodedBytes > Self.byteLimit {
            events.removeFirst()
            encodedBytes = encodedSize(of: events)
        }
        // A single event can still exceed the cap on its own; truncate rather than drop it,
        // so the report that mattered is not silently empty.
        if events.count == 1, encodedBytes > Self.byteLimit {
            let only = events[0]
            events = [TimelineEvent(
                id: only.id,
                timestamp: only.timestamp,
                category: only.category,
                message: String(only.message.prefix(2_048)),
                operationID: only.operationID,
                metadata: [:]
            )]
            encodedBytes = encodedSize(of: events)
        }
    }
}

struct DiagnosticOperation {
    let id: UUID
    let name: String
    private let startedAt: Date
    private let span: Span?

    fileprivate init(id: UUID, name: String, startedAt: Date, span: Span?) {
        self.id = id
        self.name = name
        self.startedAt = startedAt
        self.span = span
    }

    func finish(outcome: String, count: Int? = nil) {
        let durationMS = Int(Date().timeIntervalSince(startedAt) * 1_000)
        span?.setTag(value: outcome, key: "outcome")
        span?.setData(value: id.uuidString, key: "operation_id")
        span?.setData(value: durationMS, key: "duration_ms")
        if let count { span?.setData(value: count, key: "count") }
        span?.finish()
        DiagnosticsManager.record(
            category: name,
            message: "finished",
            operationID: id,
            metadata: [
                "outcome": outcome,
                "duration_ms": String(durationMS),
                "count": count.map(String.init) ?? "0"
            ]
        )
    }
}

enum DiagnosticsManager {
    private static var isConfigured = false
    private static var isEnabled = false

    static var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown"
    }

    static var buildNumber: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown"
    }

    static var releaseName: String {
        let bundle = Bundle.main
        let identifier = bundle.bundleIdentifier ?? "com.siblingshipyard.coachhq.app"
        return "\(identifier)@\(appVersion)+\(buildNumber)"
    }

    static var environment: String {
#if DEBUG
        "development"
#else
        "production"
#endif
    }

    static func configure() {
        guard !isConfigured else { return }
        isConfigured = true
        let dsn = Secrets.sentryDSN.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !dsn.isEmpty, !dsn.contains("example@sentry.io") else { return }

        SentrySDK.start { options in
            options.dsn = dsn
            options.releaseName = releaseName
            options.dist = buildNumber
            options.environment = environment
            options.tracesSampleRate = 1.0
            options.enableFileIOTracing = false
            options.attachScreenshot = false
            options.sessionReplay = SentryReplayOptions(sessionSampleRate: 0, onErrorSampleRate: 0)
            options.beforeSend = scrub(event:)
        }
        isEnabled = true
        SentrySDK.configureScope { scope in
            scope.setTag(value: appVersion, key: "app_version")
            scope.setTag(value: buildNumber, key: "build_number")
        }
        sendTestEventIfRequested(arguments: ProcessInfo.processInfo.arguments)
    }

    static func setAthlete(repoFullName: String?) {
        guard isEnabled else { return }
        let athleteID = repoFullName?.split(separator: "/").first.map(String.init)
        SentrySDK.configureScope { scope in
            if let athleteID {
                scope.setTag(value: athleteID, key: "athlete_id")
                scope.setUser(User(userId: athleteID))
            } else {
                scope.removeTag(key: "athlete_id")
                scope.setUser(nil)
            }
        }
    }

    static func setView(_ viewName: String) {
        if isEnabled {
            SentrySDK.configureScope { $0.setTag(value: viewName, key: "view_name") }
        }
        record(category: "navigation", message: viewName)
    }

    static func beginOperation(name: String) -> DiagnosticOperation {
        let id = UUID()
        let span = isEnabled ? SentrySDK.startTransaction(name: name, operation: name) : nil
        span?.setData(value: id.uuidString, key: "operation_id")
        record(category: name, message: "started", operationID: id)
        return DiagnosticOperation(id: id, name: name, startedAt: Date(), span: span)
    }

    static func record(
        category: String,
        message: String,
        operationID: UUID? = nil,
        metadata: [String: String] = [:]
    ) {
        TimelineBuffer.shared.addEvent(
            category: category,
            message: message,
            operationID: operationID,
            metadata: metadata
        )
        guard isEnabled else { return }
        let breadcrumb = Breadcrumb(level: .info, category: category)
        breadcrumb.message = message
        breadcrumb.data = DiagnosticsScrubber.scrub(
            metadata.merging(operationID.map { ["operation_id": $0.uuidString] } ?? [:]) { current, _ in current }
        )
        SentrySDK.addBreadcrumb(breadcrumb)
    }

    static func capture(
        error: Error,
        operation: String,
        operationID: UUID,
        metadata: [String: String] = [:]
    ) {
        record(category: operation, message: "failed", operationID: operationID, metadata: metadata)
        guard isEnabled else { return }
        SentrySDK.capture(error: error) { scope in
            scope.setTag(value: operation, key: "operation")
            scope.setTag(value: operationID.uuidString, key: "operation_id")
            scope.setExtras(DiagnosticsScrubber.scrub(metadata))
        }
    }

    static func shouldSendTestEvent(arguments: [String]) -> Bool {
        arguments.contains("--send-sentry-test-event")
    }

    private static func sendTestEventIfRequested(arguments: [String]) {
        guard shouldSendTestEvent(arguments: arguments) else { return }
        let operationID = UUID()
        SentrySDK.capture(message: "CoachHQ iOS Sentry verification") { scope in
            scope.setTag(value: "sentry_verification", key: "operation")
            scope.setTag(value: operationID.uuidString, key: "operation_id")
            scope.setExtra(value: true, key: "safe_test_event")
        }
    }

    nonisolated static func scrub(event: Event) -> Event? {
        if let request = event.request {
            request.headers = request.headers?.filter { !DiagnosticsScrubber.isSensitiveKey($0.key) }
                .mapValues(DiagnosticsScrubber.scrub)
            request.cookies = nil
            request.queryString = request.queryString.map(DiagnosticsScrubber.scrub)
            request.url = request.url.map(DiagnosticsScrubber.scrub)
        }
        event.extra = event.extra.map(DiagnosticsScrubber.scrub)
        event.tags = event.tags.map(DiagnosticsScrubber.scrub)
        event.context = event.context.map { context in
            context.mapValues(DiagnosticsScrubber.scrub)
        }
        if let message = event.message {
            event.message = SentryMessage(formatted: DiagnosticsScrubber.scrub(message.formatted))
        }
        event.exceptions?.forEach { $0.value = DiagnosticsScrubber.scrub($0.value) }
        event.breadcrumbs?.forEach { breadcrumb in
            breadcrumb.message = breadcrumb.message.map(DiagnosticsScrubber.scrub)
            breadcrumb.data = breadcrumb.data.map(DiagnosticsScrubber.scrub)
        }
        if let userData = event.user?.data {
            event.user?.data = DiagnosticsScrubber.scrub(userData)
        }
        return event
    }
}
