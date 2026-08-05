import Foundation
import Combine

@MainActor
class WorkoutService: ObservableObject {
    @Published private(set) var templates: [Workout] = []
    @Published private(set) var todaySessions: [String: Workout] = [:]
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

    func fetchTodaySessions() async {
        guard let apiClient else { return }
        isLoading = true
        fetchError = nil
        defer { isLoading = false }

        let today = Self.localDateKey(from: Date())
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
