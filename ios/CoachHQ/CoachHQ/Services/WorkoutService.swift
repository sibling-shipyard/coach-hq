import Foundation
import Combine

@MainActor
class WorkoutService: ObservableObject {
    @Published private(set) var templates: [Workout] = []
    /// Coach session files for whichever date was last fetched (see `fetchTodaySessions`),
    /// keyed by filename with the date prefix and `.json` dropped.
    @Published private(set) var todaySessions: [String: Workout] = [:]
    /// A5-ios: `current_week.json`, decoded, or nil if missing/unreadable. Nil also just
    /// means "no live plan" to every caller — same lenient-decode-failure story `Workout`
    /// already has for template/session files.
    @Published private(set) var currentWeek: CurrentWeek? = nil
    /// Set alongside `currentWeek` — nil exactly when `currentWeek` is nil.
    @Published private(set) var currentWeekAvailability: CurrentWeekAvailability? = nil
    /// The athlete's own known timezone (`user_data/coach/profile.json`'s `timezone`), used
    /// by the Workouts page selector only when the current week isn't live.
    @Published private(set) var athleteTimezone: String? = nil
    @Published private(set) var isLoading = false
    @Published private(set) var fetchError: String? = nil

    private var apiClient: GitHubAPIClient?

    init() {}

    func configure(apiClient: GitHubAPIClient) {
        self.apiClient = apiClient
    }

    /// Drops any fetched data so a stale account's workouts can never survive a sign-out.
    func reset() {
        templates = []
        todaySessions = [:]
        currentWeek = nil
        currentWeekAvailability = nil
        athleteTimezone = nil
        fetchError = nil
    }

    // MARK: - Display helpers

    func displayWorkout(for id: String) -> Workout? {
        todaySessions[id] ?? templates.first { $0.id == id }
    }

    // MARK: - GitHub fetch

    func fetchTemplates() async {
        guard let apiClient else { return }
        isLoading = true
        fetchError = nil
        defer { isLoading = false }

        // Only a confirmed 404 (no templates/ directory at all) means "genuinely no plan" —
        // any other failure must leave `templates` as the last good fetch, or a transient
        // hiccup on pull-to-refresh renders as a false "No workouts yet" (see fetchError below,
        // which the view branches on to distinguish the two).
        let entries: [GitHubFileEntry]
        do {
            entries = try await apiClient.listFiles(path: "user_data/activities/workout_plans/templates")
        } catch let e as GitHubAPIError {
            guard case .notFound = e else {
                // GitHubAPIClient.withRetry owns Sentry for this fault; only surface UX here.
                fetchError = "Couldn't load workout templates"
                return
            }
            templates = []
            return
        } catch {
            WorkoutFetchDiagnostics.reportUnexpected(
                error,
                operation: WorkoutFetchDiagnostics.templatesOperation
            )
            fetchError = "Couldn't load workout templates"
            return
        }

        let decoder = JSONDecoder()
        var loaded: [Workout] = []
        for entry in entries where entry.type == "file" && entry.name.hasSuffix(".json") {
            do {
                let data = try await apiClient.readFile(path: entry.path)
                loaded.append(try decoder.decode(Workout.self, from: data))
            } catch {
                print("fetchTemplates: skipping \(entry.name): \(error)")
                WorkoutFetchDiagnostics.reportSkip(
                    fileName: entry.name,
                    error: error,
                    operation: WorkoutFetchDiagnostics.templatesOperation
                )
                if fetchError == nil {
                    fetchError = "Some workout templates failed to load"
                }
            }
        }
        templates = loaded
    }

    /// Fetches coach session files for `dateString` (`YYYY-MM-DD`), defaulting to the
    /// device's own local date. The Workouts page always passes an explicit date computed
    /// from the plan's own timezone (live) or the athlete's known timezone (not live) — see
    /// `WorkoutsPageSelector` — never the device's local zone.
    func fetchTodaySessions(forDate dateString: String? = nil) async {
        guard let apiClient else { return }
        isLoading = true
        fetchError = nil
        defer { isLoading = false }

        let today = dateString ?? Self.localDateKey(from: Date())
        let prefix = "\(today)_"

        // List the sessions directory directly instead of only probing paths for known
        // template ids — a one-off session for a workout type with no matching template
        // (Coach gives a cali session to an athlete with no cali template) has a filename
        // that would never get checked otherwise.
        let entries: [GitHubFileEntry]
        do {
            entries = try await apiClient.listFiles(path: "user_data/activities/workout_plans/sessions")
        } catch GitHubAPIError.notFound {
            todaySessions = [:]
            return
        } catch let e as GitHubAPIError {
            // GitHubAPIClient.withRetry owns Sentry for this fault; keep athlete-facing string.
            if fetchError == nil {
                fetchError = e.errorDescription ?? "Couldn't load today's coach sessions"
            }
            return
        } catch {
            WorkoutFetchDiagnostics.reportUnexpected(
                error,
                operation: WorkoutFetchDiagnostics.sessionsOperation
            )
            if fetchError == nil {
                fetchError = "Couldn't load today's coach sessions"
            }
            return
        }

        var sessions: [String: Workout] = [:]
        for entry in entries
        where entry.type == "file" && entry.name.hasSuffix(".json") && entry.name.hasPrefix(prefix) {
            let sessionId = String(entry.name.dropFirst(prefix.count).dropLast(".json".count))
            do {
                let data = try await apiClient.readFile(path: entry.path)
                sessions[sessionId] = try JSONDecoder().decode(Workout.self, from: data)
            } catch {
                print("fetchTodaySessions: skipping \(entry.name): \(error)")
                WorkoutFetchDiagnostics.reportSkip(
                    fileName: entry.name,
                    error: error,
                    operation: WorkoutFetchDiagnostics.sessionsOperation
                )
                if fetchError == nil {
                    fetchError = "Couldn't load today's coach sessions"
                }
            }
        }
        todaySessions = sessions
    }

    /// Fetches and decodes `user_data/ledger/current_week.json`. A missing file (never
    /// confirmed a week) or a decode failure both resolve the same way: `currentWeek` and
    /// `currentWeekAvailability` go to nil, which the selector treats as "no live plan" —
    /// same lenient story `fetchTemplates`/`fetchTodaySessions` already have.
    func fetchCurrentWeek(now: Date = Date()) async {
        guard let apiClient else { return }

        let data: Data
        do {
            data = try await apiClient.readFile(path: "user_data/ledger/current_week.json")
        } catch {
            // notFound is quiet by design; other GitHubAPIErrors are owned by withRetry.
            // Non-GitHub surprises still need a signal at this layer.
            WorkoutFetchDiagnostics.reportIfNotCoveredByGitHubClient(
                error,
                operation: WorkoutFetchDiagnostics.currentWeekOperation
            )
            currentWeek = nil
            currentWeekAvailability = nil
            return
        }

        do {
            let week = try JSONDecoder().decode(CurrentWeek.self, from: data)
            // Availability itself always reads the plan's own timezone (matches
            // engine/lib/current-week.mts's getAvailability) — the athlete's timezone only
            // comes into play later, for "today" when the plan turns out not to be live.
            let todayInPlanTimezone = dateString(for: now, inTimeZoneIdentifier: week.timezone)
            currentWeek = week
            currentWeekAvailability = computeCurrentWeekAvailability(for: week, today: todayInPlanTimezone)
        } catch {
            WorkoutFetchDiagnostics.reportDecodeFailure(
                error,
                operation: WorkoutFetchDiagnostics.currentWeekOperation
            )
            currentWeek = nil
            currentWeekAvailability = nil
        }
    }

    /// Fetches the athlete's known timezone from `user_data/coach/profile.json`, used by the
    /// Workouts page selector only when the current week isn't live. A missing field or
    /// unreadable file just leaves this nil — the selector falls back to UTC in that case.
    func fetchAthleteTimezone() async {
        guard let apiClient else { return }
        do {
            let data = try await apiClient.readFile(path: "user_data/coach/profile.json")
            let profile = try JSONDecoder().decode(CoachProfileSummary.self, from: data)
            athleteTimezone = profile.timezone
        } catch {
            WorkoutFetchDiagnostics.reportIfNotCoveredByGitHubClient(
                error,
                operation: WorkoutFetchDiagnostics.athleteTimezoneOperation
            )
            athleteTimezone = nil
        }
    }

    /// Local calendar date for session filenames (`YYYY-MM-DD_workout_a.json`).
    private static func localDateKey(from date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar.current
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = Calendar.current.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

}

/// #1078 I10–I13 — WorkoutService soft-continue paths. List/read faults are owned by
/// `GitHubAPIClient.withRetry`; this layer reports skips, local decode failures, and
/// unexpected non-GitHub errors only (one event per terminal failure).
enum WorkoutFetchDiagnostics {
    static let templatesOperation = "workout.fetch_templates"
    static let sessionsOperation = "workout.fetch_sessions"
    static let currentWeekOperation = "workout.fetch_current_week"
    static let athleteTimezoneOperation = "workout.fetch_athlete_timezone"

    static func reportSkip(
        fileName: String,
        error: Error,
        operation: String,
        operationID: UUID = UUID()
    ) {
        // readFile faults are owned by GitHubAPIClient.withRetry; only local decode
        // (and other non-GitHub) surprises are new signal here.
        guard shouldReportIfNotCoveredByGitHubClient(error) else { return }
        DiagnosticsManager.capture(
            error: error,
            operation: operation,
            operationID: operationID,
            metadata: ["file": fileName, "phase": "skip"]
        )
    }

    static func reportDecodeFailure(
        _ error: Error,
        operation: String,
        operationID: UUID = UUID()
    ) {
        DiagnosticsManager.capture(
            error: error,
            operation: operation,
            operationID: operationID,
            metadata: ["phase": "decode"]
        )
    }

    static func reportUnexpected(
        _ error: Error,
        operation: String,
        operationID: UUID = UUID()
    ) {
        DiagnosticsManager.capture(
            error: error,
            operation: operation,
            operationID: operationID,
            metadata: ["phase": "unexpected"]
        )
    }

    /// GitHubAPIError paths are either quiet by design (`notFound`/`sessionNotReady`) or
    /// owned by `withRetry`. Only non-GitHub surprises need a report at this layer.
    static func shouldReportIfNotCoveredByGitHubClient(_ error: Error) -> Bool {
        if error is CancellationError { return false }
        if error is GitHubAPIError { return false }
        let nsError = error as NSError
        return !(nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled)
    }

    static func reportIfNotCoveredByGitHubClient(
        _ error: Error,
        operation: String,
        operationID: UUID = UUID()
    ) {
        guard shouldReportIfNotCoveredByGitHubClient(error) else { return }
        DiagnosticsManager.capture(
            error: error,
            operation: operation,
            operationID: operationID,
            metadata: ["phase": "local"]
        )
    }
}
