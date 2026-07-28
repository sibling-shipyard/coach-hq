import Foundation
import Combine

@MainActor
class WorkoutService: ObservableObject {
    @Published private(set) var templates: [Workout] = []
    @Published private(set) var todaySessions: [String: Workout] = [:]
    @Published private(set) var isLoading = false
    @Published private(set) var fetchError: String? = nil

    private var apiClient: GitHubAPIClient?

    /// Maps Calendar.weekday (1=Sun, 2=Mon … 7=Sat) → template id.
    static let dowMap: [Int: String] = [
        3: "workout_a",   // Tuesday
        4: "workout_b",   // Wednesday
        6: "workout_c",   // Friday
        1: "workout_d",   // Sunday
    ]

    static func todayTemplateId() -> String? {
        dowMap[Calendar.current.component(.weekday, from: Date())]
    }

    init() {
        loadBundled()
    }

    func configure(apiClient: GitHubAPIClient) {
        self.apiClient = apiClient
        Task { await fetchTodaySessions() }
    }

    // MARK: - Display helpers

    func displayWorkout(for id: String) -> Workout? {
        todaySessions[id] ?? templates.first { $0.id == id }
    }

    // MARK: - GitHub fetch

    func fetchTodaySessions() async {
        guard let apiClient else { return }
        isLoading = true
        fetchError = nil
        defer { isLoading = false }

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = .withFullDate
        let today = formatter.string(from: Date())

        var sessions: [String: Workout] = [:]
        for template in templates {
            let path = "user_data/activities/workout_plans/sessions/\(today)_\(template.id).json"
            do {
                let data = try await apiClient.readFile(path: path)
                let workout = try JSONDecoder().decode(Workout.self, from: data)
                sessions[template.id] = workout
            } catch GitHubAPIError.notFound {
                // No coach session today for this template — expected
            } catch {
                // Non-critical: bundled template is the fallback
            }
        }
        todaySessions = sessions
    }

    // MARK: - Bundle load

    private func loadBundled() {
        let decoder = JSONDecoder()
        templates = BundledTemplates.displayOrder.compactMap { id in
            guard let json = BundledTemplates.json(for: id),
                  let data = json.data(using: .utf8),
                  let workout = try? decoder.decode(Workout.self, from: data) else { return nil }
            return workout
        }
    }
}
