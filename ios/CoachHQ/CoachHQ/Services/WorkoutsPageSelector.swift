import Foundation

/// Pure functions that turn the same data the Workouts tab already fetches (current_week.json,
/// today's coach session files, the workout templates, and locally-synced activities) into the
/// three bands the Workouts tab renders: today, this week, library. No new storage, no state
/// machine — just picking which existing row applies.
///
/// This is a Swift port of `ui/client/src/lib/workoutsPageSelector.ts`'s reasoning (A5, A5-ios),
/// not a line-for-line translation — kept in its own file, no shared package across languages.
enum WorkoutsPageSelector {

    enum TodayBand: Equatable {
        /// `isSession` mirrors web's `from: "session" | "template"` — true when the coach
        /// adjusted today's session file, false when it's just the base template.
        case runnable(workout: Workout, isSession: Bool, done: Bool)
        case mention(title: String, durationMin: Int?)
        case rest
        case none
    }

    struct WeekRow: Equatable {
        let date: String
        let isFilled: Bool
        let title: String?
        let durationMin: Int?
        let discipline: CurrentWeekSessionDiscipline?
        let isToday: Bool
    }

    struct Selection {
        let today: TodayBand
        /// nil means the band hides entirely — no live plan and nothing logged this ISO week.
        let week: [WeekRow]?
    }

    struct Input {
        /// Parsed `current_week.json`, or nil if missing/unreadable/failed to decode.
        let currentWeek: CurrentWeek?
        /// Nil whenever `currentWeek` is nil.
        let availability: CurrentWeekAvailability?
        let templates: [Workout]
        /// Coach session files fetched for `today`, keyed the same way `WorkoutService`
        /// already keys them (filename with the date prefix dropped).
        let sessionsForToday: [String: Workout]
        /// Locally-synced activities (`SyncCache.load()`), used only when the plan isn't live.
        let loggedActivities: [SyncCacheEntry]
        /// "Today" — the week's own timezone when live, the athlete's known timezone
        /// otherwise, never the device's local zone. Computed by the caller.
        let today: String
    }

    // MARK: - Selection

    static func select(_ input: Input) -> Selection {
        let live = (input.availability?.available ?? false) && input.currentWeek != nil
        guard live, let plan = input.currentWeek else {
            return Selection(today: .none, week: weekRowsFromActivities(input.loggedActivities, today: input.today))
        }

        let day = plan.days.first { $0.date == input.today }
        let today = selectTodayBand(
            day: day,
            today: input.today,
            templates: input.templates,
            sessionsForToday: input.sessionsForToday
        )
        let week = plan.days.map { weekRow(for: $0, today: input.today) }
        return Selection(today: today, week: week)
    }

    /// Live plus a session with a real routine is runnable (whether or not it's already
    /// marked done). Live plus a day with no routine, like a match or a hike, is a one-line
    /// mention — never "Rest". Live with nothing scheduled today is Rest.
    private static func selectTodayBand(
        day: CurrentWeekDay?,
        today: String,
        templates: [Workout],
        sessionsForToday: [String: Workout]
    ) -> TodayBand {
        guard let session = day?.sessions.first else { return .rest }

        if let templateId = session.templateId,
           let resolved = resolveRunnable(
                templateId: templateId,
                sessionFile: session.sessionFile,
                today: today,
                templates: templates,
                sessionsForToday: sessionsForToday
           ) {
            return .runnable(workout: resolved.workout, isSession: resolved.isSession, done: session.status == .done)
        }
        return .mention(title: session.title, durationMin: session.plannedDurationMin)
    }

    /// The coach-adjusted session file for today if one exists, otherwise the base template.
    private static func resolveRunnable(
        templateId: String,
        sessionFile: String?,
        today: String,
        templates: [Workout],
        sessionsForToday: [String: Workout]
    ) -> (workout: Workout, isSession: Bool)? {
        let fileId = sessionFile.flatMap { sessionFileId($0, today: today) }
        if let fileId, let session = sessionsForToday[fileId], session.sessionDate == today {
            return (session, true)
        }
        if let session = sessionsForToday.values.first(where: {
            $0.sessionDate == today && ($0.id == templateId || $0.basedOnTemplate == templateId)
        }) {
            return (session, true)
        }
        if let template = templates.first(where: { $0.id == templateId }) {
            return (template, false)
        }
        return nil
    }

    /// Mirrors `WorkoutService.fetchTodaySessions`'s own key derivation: the session
    /// filename minus its `<date>_` prefix and `.json` extension.
    private static func sessionFileId(_ path: String, today: String) -> String? {
        let base = (path as NSString).lastPathComponent
        let withoutExt = base.hasSuffix(".json") ? String(base.dropLast(5)) : base
        let prefix = "\(today)_"
        guard withoutExt.hasPrefix(prefix) else { return nil }
        return String(withoutExt.dropFirst(prefix.count))
    }

    /// Every day in the week list is either the plan's row, a logged activity that day, or
    /// blank; blank means unplanned, not Rest.
    private static func weekRow(for day: CurrentWeekDay, today: String) -> WeekRow {
        let isToday = day.date == today
        guard let session = day.sessions.first else {
            return WeekRow(date: day.date, isFilled: false, title: nil, durationMin: nil, discipline: nil, isToday: isToday)
        }
        return WeekRow(
            date: day.date,
            isFilled: true,
            title: session.title,
            durationMin: session.plannedDurationMin,
            discipline: session.discipline,
            isToday: isToday
        )
    }

    // MARK: - Not-live fallback

    /// Not live, or missing, means the week band shows only logged activity for that ISO
    /// week if any exists, else hides entirely.
    private static func weekRowsFromActivities(_ activities: [SyncCacheEntry], today: String) -> [WeekRow]? {
        let monday = mondayOfWeek(containing: today)
        let weekDates = (0..<7).map { addDaysToDateString(monday, $0) }
        let byDate = Dictionary(grouping: activities) { String($0.startDateLocal.prefix(10)) }

        let rows = weekDates.map { date -> WeekRow in
            guard let entries = byDate[date], let first = entries.first else {
                return WeekRow(date: date, isFilled: false, title: nil, durationMin: nil, discipline: nil, isToday: date == today)
            }
            return WeekRow(
                date: date,
                isFilled: true,
                title: first.name,
                durationMin: Int((Double(first.elapsedTime) / 60).rounded()),
                discipline: discipline(for: first),
                isToday: date == today
            )
        }
        return rows.contains(where: { $0.isFilled }) ? rows : nil
    }

    /// Best-effort discipline from a locally-synced activity — prefers the manually-tagged
    /// `category`, falls back to the HealthKit-derived `sportType`, else `.other`. Only used
    /// for the not-live week fallback; the live path always has a real discipline from
    /// current_week.json.
    private static func discipline(for entry: SyncCacheEntry) -> CurrentWeekSessionDiscipline {
        if let category = entry.activity?.category, let mapped = disciplineToken(category) {
            return mapped
        }
        if let mapped = disciplineToken(entry.sportType) {
            return mapped
        }
        return .other(entry.sportType)
    }

    private static func disciplineToken(_ raw: String) -> CurrentWeekSessionDiscipline? {
        switch raw.lowercased() {
        case "badminton": return .badminton
        case "calisthenics": return .calisthenics
        case "ride", "cycling": return .cycling
        case "foundation": return .foundation
        case "recovery", "realign": return .recovery
        case "run", "running": return .run
        case "strength": return .strength
        case "weighttraining", "weight_training": return .weightTraining
        case "hike", "hiking": return .hike
        case "walk", "walking": return .walk
        case "cricket": return .cricket
        case "football", "soccer": return .football
        case "workout": return .workout
        case "swim", "swimming": return .swim
        default: return nil
        }
    }

    /// Monday (as `YYYY-MM-DD`) of the ISO week containing `dateString`. Pure calendar-day
    /// arithmetic in UTC — date strings carry no time component, so this never depends on
    /// the device's own timezone.
    static func mondayOfWeek(containing dateString: String) -> String {
        var utcCalendar = Calendar(identifier: .gregorian)
        utcCalendar.timeZone = TimeZone(identifier: "UTC")!
        let formatter = DateFormatter()
        formatter.calendar = utcCalendar
        formatter.timeZone = utcCalendar.timeZone
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: dateString) else { return dateString }
        let weekday = utcCalendar.component(.weekday, from: date) // 1 = Sunday ... 7 = Saturday
        let daysSinceMonday = (weekday + 5) % 7 // Sun->6, Mon->0, Tue->1, ...
        guard let monday = utcCalendar.date(byAdding: .day, value: -daysSinceMonday, to: date) else {
            return dateString
        }
        return formatter.string(from: monday)
    }
}
