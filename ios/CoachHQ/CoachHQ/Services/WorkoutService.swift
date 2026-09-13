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
                fetchError = "Couldn't load workout templates"
                return
            }
            templates = []
            return
        } catch {
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
        } catch GitHubAPIError.notAuthenticated {
            if fetchError == nil {
                fetchError = GitHubAPIError.notAuthenticated.errorDescription
            }
            return
        } catch {
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
            currentWeek = nil
            currentWeekAvailability = nil
            return
        }

        guard let week = try? JSONDecoder().decode(CurrentWeek.self, from: data) else {
            currentWeek = nil
            currentWeekAvailability = nil
            return
        }

        // Availability itself always reads the plan's own timezone (matches
        // engine/lib/current-week.mts's getAvailability) — the athlete's timezone only
        // comes into play later, for "today" when the plan turns out not to be live.
        let todayInPlanTimezone = dateString(for: now, inTimeZoneIdentifier: week.timezone)
        currentWeek = week
        currentWeekAvailability = computeCurrentWeekAvailability(for: week, today: todayInPlanTimezone)
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
