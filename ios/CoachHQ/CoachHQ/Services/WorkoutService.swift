import Foundation
import Combine

@MainActor
class WorkoutService: ObservableObject {
    @Published private(set) var templates: [Workout] = []
    @Published private(set) var todaySessions: [String: Workout] = [:]
    @Published private(set) var currentWeekJSON: Data? = nil
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
        currentWeekJSON = nil
        fetchError = nil
    }

    // MARK: - Display helpers

    func displayWorkout(for id: String) -> Workout? {
        todaySessions[id] ?? templates.first { $0.id == id }
    }

    // MARK: - GitHub fetch

    /// Templates + current_week + today's session files. One loading flag for the page.
    func fetchPage() async {
        isLoading = true
        fetchError = nil
        defer { isLoading = false }
        await fetchCurrentWeek()
        await fetchTemplates()
        await fetchTodaySessions()
    }

    func fetchTemplates() async {
        guard let apiClient else { return }

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
            // `_manifest.json` is an id list, not a workout — decoding it would trip
            // "Some workout templates failed to load" on every fetch.
            if entry.name == "_manifest.json" { continue }
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

    func fetchCurrentWeek() async {
        guard let apiClient else { return }
        do {
            currentWeekJSON = try await apiClient.readFile(path: "user_data/ledger/current_week.json")
        } catch let e as GitHubAPIError {
            guard case .notFound = e else {
                // Missing is "not live". Any other failure is also not live — never crash,
                // never wipe templates over a week-file hiccup.
                currentWeekJSON = nil
                return
            }
            currentWeekJSON = nil
        } catch {
            currentWeekJSON = nil
        }
    }

    func fetchTodaySessions() async {
        guard let apiClient else { return }

        let timeZone = WorkoutsPageSelector.resolvedTimeZone(
            currentWeekJSON: currentWeekJSON,
            athleteTimeZone: nil
        )
        let today = WorkoutsPageSelector.dateKey(from: Date(), timeZone: timeZone)
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
}

// MARK: - Workouts page selector (A5-ios)

/// Today band. `runnable` is the only timer CTA.
enum TodayHero: Equatable {
    case runnable(workout: Workout, from: RunnableSource, isDone: Bool)
    case mention(title: String, durationMin: Int?)
    case rest
    case none
}

enum RunnableSource: String, Equatable {
    case session
    case template
}

enum WeekDaySource: String, Equatable {
    case plan
    case activity
    case empty
}

struct WeekDay: Equatable, Identifiable {
    var id: String { date }
    let date: String
    let source: WeekDaySource
    let title: String?
    let durationMin: Int?
    /// Free string from `discipline` or activity sport — view maps it onto `WarmSportId`.
    let sport: String?
}

struct WorkoutPageActivity: Equatable {
    let start: String
    let sport: String?
    let title: String?
    let durationMin: Int?
}

enum WorkoutsPageSelector {
    private static let datePattern = try! NSRegularExpression(pattern: "^\\d{4}-\\d{2}-\\d{2}")

    static func select(
        templates: [Workout],
        sessions: [String: Workout],
        currentWeekJSON: Data?,
        activities: [WorkoutPageActivity],
        now: Date,
        athleteTimeZone: String?
    ) -> (today: TodayHero, week: [WeekDay]?) {
        let parsed = parseCurrentWeek(currentWeekJSON)
        let timeZone = resolvedTimeZone(parsed: parsed, athleteTimeZone: athleteTimeZone)
        let todayKey = dateKey(from: now, timeZone: timeZone)
        let byDate = activitiesByDate(activities)

        guard let parsed, parsed.isLive else {
            let weekDates = isoWeekDates(containing: todayKey)
            let hasHist = weekDates.contains { byDate[$0] != nil }
            return (today: .none, week: hasHist ? weekDates.map { day in weekDay(date: day, plan: nil, activity: byDate[day]) } : nil)
        }

        let weekDates = parsed.weekDates ?? isoWeekDates(containing: todayKey)
        let planByDate = Dictionary(uniqueKeysWithValues: parsed.days.compactMap { day -> (String, ParsedSession)? in
            guard let date = day.date, let session = day.session else { return nil }
            return (date, session)
        })

        let today: TodayHero
        if let session = planByDate[todayKey] {
            if let templateId = session.templateId, !templateId.isEmpty {
                if let workout = sessions[templateId] {
                    today = .runnable(workout: workout, from: .session, isDone: session.isDone)
                } else if let workout = templates.first(where: { $0.id == templateId }) {
                    today = .runnable(workout: workout, from: .template, isDone: session.isDone)
                } else {
                    // Live + template_id, but the file is missing — a line, not a crash.
                    today = .mention(title: session.title ?? templateId, durationMin: session.durationMin)
                }
            } else {
                today = .mention(title: session.title ?? "", durationMin: session.durationMin)
            }
        } else {
            today = .rest
        }

        let week = weekDates.map { date in
            weekDay(date: date, plan: planByDate[date], activity: byDate[date])
        }
        return (today, week)
    }

    /// `current_week.timezone` when the file has one; else athlete tz; else UTC. Never the device.
    static func resolvedTimeZone(currentWeekJSON: Data?, athleteTimeZone: String?) -> TimeZone {
        resolvedTimeZone(parsed: parseCurrentWeek(currentWeekJSON), athleteTimeZone: athleteTimeZone)
    }

    static func dateKey(from date: Date, timeZone: TimeZone) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    // MARK: Private

    private struct ParsedWeek {
        var isLive: Bool
        var timezone: String?
        var weekDates: [String]?
        var days: [ParsedDay]
    }

    private struct ParsedDay {
        var date: String?
        var session: ParsedSession?
    }

    private struct ParsedSession {
        var templateId: String?
        var title: String?
        var durationMin: Int?
        var status: String?
        var discipline: String?
        var isDone: Bool { status == "done" }
    }

    private static func resolvedTimeZone(parsed: ParsedWeek?, athleteTimeZone: String?) -> TimeZone {
        if let parsed, parsed.isLive, let tz = TimeZone(identifier: parsed.timezone ?? "") {
            return tz
        }
        if let id = athleteTimeZone, let tz = TimeZone(identifier: id) {
            return tz
        }
        if let parsed, let tz = TimeZone(identifier: parsed.timezone ?? "") {
            return tz
        }
        return TimeZone(secondsFromGMT: 0)!
    }

    private static func parseCurrentWeek(_ data: Data?) -> ParsedWeek? {
        guard let data else { return nil }
        let obj: [String: Any]
        do {
            guard let parsed = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                return nil
            }
            obj = parsed
        } catch {
            return nil
        }

        let status = obj["data_status"] as? String
        let timezone = obj["timezone"] as? String
        let week = obj["week"] as? [String: Any]
        let start = week?["start_date"] as? String
        let rawDays = obj["days"] as? [[String: Any]] ?? []
        let days: [ParsedDay] = rawDays.map { day in
            let date = day["date"] as? String
            let sessions = day["sessions"] as? [[String: Any]] ?? []
            let first = sessions.first
            let session: ParsedSession? = first.map { s in
                let templateRaw = s["template_id"]
                let templateId: String?
                if templateRaw is NSNull {
                    templateId = nil
                } else {
                    templateId = templateRaw as? String
                }
                let duration: Int?
                if let n = s["planned_duration_min"] as? Int {
                    duration = n
                } else if let n = s["planned_duration_min"] as? Double {
                    duration = Int(n)
                } else {
                    duration = nil
                }
                return ParsedSession(
                    templateId: templateId,
                    title: s["title"] as? String,
                    durationMin: duration,
                    status: s["status"] as? String,
                    discipline: s["discipline"] as? String
                )
            }
            return ParsedDay(date: date, session: session)
        }

        let weekDates: [String]?
        if let start, datePattern.firstMatch(in: start, range: NSRange(start.startIndex..., in: start)) != nil {
            weekDates = isoWeekDates(containing: start)
        } else {
            weekDates = nil
        }

        return ParsedWeek(
            isLive: status == "live",
            timezone: timezone,
            weekDates: weekDates,
            days: days
        )
    }

    private static func activitiesByDate(_ activities: [WorkoutPageActivity]) -> [String: WorkoutPageActivity] {
        var map: [String: WorkoutPageActivity] = [:]
        for activity in activities {
            guard let key = dateKey(fromStart: activity.start) else { continue }
            if map[key] == nil {
                map[key] = activity
            }
        }
        return map
    }

    private static func dateKey(fromStart start: String) -> String? {
        let ns = start as NSString
        guard let match = datePattern.firstMatch(in: start, range: NSRange(location: 0, length: ns.length)),
              match.range.location != NSNotFound else { return nil }
        return ns.substring(with: match.range)
    }

    private static func weekDay(date: String, plan: ParsedSession?, activity: WorkoutPageActivity?) -> WeekDay {
        if let plan {
            return WeekDay(
                date: date,
                source: .plan,
                title: plan.title,
                durationMin: plan.durationMin,
                sport: plan.discipline
            )
        }
        if let activity {
            return WeekDay(
                date: date,
                source: .activity,
                title: activity.title,
                durationMin: activity.durationMin,
                sport: activity.sport
            )
        }
        return WeekDay(date: date, source: .empty, title: nil, durationMin: nil, sport: nil)
    }

    /// Monday–Sunday containing `dateKey`, using the same UTC-date arithmetic as
    /// `engine/lib/current-week.mts` `getIsoWeekId`.
    static func isoWeekDates(containing dateKey: String) -> [String] {
        guard dateKey.count >= 10,
              let date = utcDate(from: String(dateKey.prefix(10))) else { return [] }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let weekday = calendar.component(.weekday, from: date) // 1 = Sunday
        let isoWeekday = weekday == 1 ? 7 : weekday - 1 // Mon = 1 … Sun = 7
        guard let monday = calendar.date(byAdding: .day, value: -(isoWeekday - 1), to: date) else {
            return []
        }
        return (0..<7).compactMap { offset in
            guard let day = calendar.date(byAdding: .day, value: offset, to: monday) else { return nil }
            return Self.dateKey(from: day, timeZone: TimeZone(secondsFromGMT: 0)!)
        }
    }

    private static func utcDate(from dateKey: String) -> Date? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let parts = dateKey.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }
}
