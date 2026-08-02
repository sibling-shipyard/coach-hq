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

        var sessions: [String: Workout] = [:]
        for template in templates {
            let path = "user_data/activities/workout_plans/sessions/\(today)_\(template.id).json"
            do {
                let data = try await apiClient.readFile(path: path)
                let workout = try JSONDecoder().decode(Workout.self, from: data)
                sessions[template.id] = workout
            } catch GitHubAPIError.notFound {
                // No coach session today for this template — expected
            } catch GitHubAPIError.notAuthenticated {
                // Distinct from the generic case below so callers can match "HTTP 401"/"Not
                // authenticated" in fetchError and flag session expiry (see GitHubAuthManager.noteAPIError).
                if fetchError == nil {
                    fetchError = GitHubAPIError.notAuthenticated.errorDescription
                }
                print("fetchTodaySessions failed for \(path): not authenticated")
            } catch {
                // Keep bundled templates visible; surface the first failure for debugging.
                if fetchError == nil {
                    fetchError = "Couldn't load today's coach sessions"
                }
                print("fetchTodaySessions failed for \(path): \(error)")
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
