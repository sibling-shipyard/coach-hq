import Foundation

/// Pure functions that turn the same data the Train tab already fetches (`current_week.json`,
/// coach session files, templates, and hist) into a week of days plus today's runnable band.
/// No new storage — just picking which existing row applies.
///
/// Swift port of `ui/client/src/lib/workoutsPageSelector.ts`'s reasoning, widened for the
/// Day Card / Week Strip L page (every session, rest vs match vs protocol).
enum WorkoutsPageSelector {

    enum TodayBand: Equatable {
        /// `isSession` mirrors web's `from: "session" | "template"` — true when the coach
        /// adjusted today's session file, false when it's just the base template.
        case runnable(workout: Workout, isSession: Bool, done: Bool)
        case mention(title: String, durationMin: Int?)
        case rest
        case none
    }

    enum DayKind: Equatable {
        case past, today, future
    }

    enum SessionStatus: Equatable {
        case logged, draft
    }

    struct TrainSession: Equatable, Identifiable {
        let id: String
        let title: String
        let shortTitle: String
        let sport: WarmSportId
        let status: SessionStatus
        let load: Int?
        let durationMin: Int?
        let plannedMin: Int?
        let subline: String
        let phases: [WorkoutPhase]
        let coachNote: String?
        let workout: Workout?
        let activity: SyncCacheEntry?
        /// True when the session has a routine to open (template or session file).
        var isProtocol: Bool { workout != nil }
        var isMatchDraft: Bool { status == .draft && workout == nil }
    }

    struct TrainDay: Equatable, Identifiable {
        let date: String
        let kind: DayKind
        let isRest: Bool
        let sessions: [TrainSession]
        let observedLoad: Int?
        let coachNote: String?

        var id: String { date }
        var isToday: Bool { kind == .today }
    }

    struct TrainWeek: Equatable {
        let id: String
        let number: Int
        let loggedLoad: Int?
        let bandVerdict: String?
        let days: [TrainDay]
        let isLive: Bool
    }

    struct Selection: Equatable {
        let today: TodayBand
        /// Always a 7-day strip for `today`'s ISO week. Empty days are rest cubes.
        let week: TrainWeek?
    }

    struct LoadHints: Equatable {
        var loadByDate: [String: Int] = [:]
        var bandLow: Double? = nil
        var bandHigh: Double? = nil
    }

    struct Input {
        /// Parsed `current_week.json`, or nil if missing/unreadable/failed to decode.
        let currentWeek: CurrentWeek?
        /// Nil whenever `currentWeek` is nil.
        let availability: CurrentWeekAvailability?
        let templates: [Workout]
        /// Coach session files fetched for the date the caller last asked for (today on
        /// first paint, the selected day after a cube tap).
        let sessionsForDate: [String: Workout]
        /// Hist rows used to attach receipts — All Activity plus the 7-day sync shelf.
        let loggedActivities: [SyncCacheEntry]
        /// Observed day loads from Home snapshots when present (ADR 0005). Missing dates
        /// fall back to zone-weighted load on the attached activity.
        let loadHints: LoadHints
        /// "Today" — the week's own timezone when live, the athlete's known timezone
        /// otherwise, never the device's local zone. Computed by the caller.
        let today: String
    }

    // MARK: - Selection

    static func select(_ input: Input) -> Selection {
        let live = (input.availability?.available ?? false) && input.currentWeek != nil
        guard live, let plan = input.currentWeek else {
            return Selection(today: .none, week: weekFromActivities(input))
        }

        let day = plan.days.first { $0.date == input.today }
        let today = selectTodayBand(
            day: day,
            today: input.today,
            templates: input.templates,
            sessionsForDate: input.sessionsForDate
        )
        return Selection(today: today, week: weekFromPlan(plan, input: input))
    }

    /// Live plus a session with a real routine is runnable (whether or not it's already
    /// marked done). Live plus a day with no routine, like a match or a hike, is a one-line
    /// mention — never "Rest". Live with nothing scheduled today is Rest.
    private static func selectTodayBand(
        day: CurrentWeekDay?,
        today: String,
        templates: [Workout],
        sessionsForDate: [String: Workout]
    ) -> TodayBand {
        guard let session = day?.sessions.first else { return .rest }

        if let templateId = session.templateId,
           let resolved = resolveRunnable(
                templateId: templateId,
                sessionFile: session.sessionFile,
                date: today,
                templates: templates,
                sessionsForDate: sessionsForDate
           ) {
            return .runnable(workout: resolved.workout, isSession: resolved.isSession, done: session.status == .done)
        }
        return .mention(title: session.title, durationMin: session.plannedDurationMin)
    }

    /// The coach-adjusted session file for `date` if one exists, otherwise the base template.
    private static func resolveRunnable(
        templateId: String,
        sessionFile: String?,
        date: String,
        templates: [Workout],
        sessionsForDate: [String: Workout]
    ) -> (workout: Workout, isSession: Bool)? {
        let fileId = sessionFile.flatMap { sessionFileId($0, date: date) }
        if let fileId, let session = sessionsForDate[fileId], session.sessionDate == date {
            return (session, true)
        }
        if let session = sessionsForDate.values.first(where: {
            $0.sessionDate == date && ($0.id == templateId || $0.basedOnTemplate == templateId)
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
    private static func sessionFileId(_ path: String, date: String) -> String? {
        let base = (path as NSString).lastPathComponent
        let withoutExt = base.hasSuffix(".json") ? String(base.dropLast(5)) : base
        let prefix = "\(date)_"
        guard withoutExt.hasPrefix(prefix) else { return nil }
        return String(withoutExt.dropFirst(prefix.count))
    }

    // MARK: - Live week

    private static func weekFromPlan(_ plan: CurrentWeek, input: Input) -> TrainWeek {
        let days = plan.days.map { trainDay(for: $0, input: input) }
        return makeWeek(
            id: plan.week.id,
            days: days,
            hints: input.loadHints,
            isLive: true
        )
    }

    private static func trainDay(for day: CurrentWeekDay, input: Input) -> TrainDay {
        let kind = dayKind(day.date, today: input.today)
        let sessions = day.sessions.map { session in
            trainSession(session, on: day.date, input: input)
        }
        let observed = observedLoad(date: day.date, sessions: sessions, hints: input.loadHints)
        return TrainDay(
            date: day.date,
            kind: kind,
            isRest: sessions.isEmpty,
            sessions: sessions,
            observedLoad: observed,
            coachNote: day.coachNote
        )
    }

    private static func trainSession(
        _ session: CurrentWeekSession,
        on date: String,
        input: Input
    ) -> TrainSession {
        let activity = matchingActivity(session, date: date, in: input.loggedActivities)
        let resolved = session.templateId.flatMap {
            resolveRunnable(
                templateId: $0,
                sessionFile: session.sessionFile,
                date: date,
                templates: input.templates,
                sessionsForDate: input.sessionsForDate
            )
        }
        let logged = session.status == .done || activity != nil
        let load = logged ? sessionLoad(activity: activity, date: date, hints: input.loadHints) : nil
        let workout = resolved?.workout
        let duration = logged
            ? activity.map { Int((Double($0.elapsedTime) / 60).rounded()) }
            : (workout?.estimatedDurationMins ?? session.plannedDurationMin)
        return TrainSession(
            id: session.id,
            title: activity?.name ?? session.title,
            shortTitle: shortTitle(activity?.name ?? session.title, sport: session.discipline.asWarmSport),
            sport: session.discipline.asWarmSport,
            status: logged ? .logged : .draft,
            load: load,
            durationMin: duration,
            plannedMin: session.plannedDurationMin,
            subline: subline(session: session, workout: workout, activity: activity),
            phases: workout?.phases ?? [],
            coachNote: session.coachNote ?? workout?.coachingNote,
            workout: workout,
            activity: activity
        )
    }

    // MARK: - Not-live fallback

    /// Not live, or missing, still paints this ISO week so Train is never library-only
    /// while hist is still arriving. Empty days are rest.
    private static func weekFromActivities(_ input: Input) -> TrainWeek {
        let monday = mondayOfWeek(containing: input.today)
        let weekDates = (0..<7).map { addDaysToDateString(monday, $0) }
        let byDate = Dictionary(grouping: input.loggedActivities) { String($0.startDateLocal.prefix(10)) }
        let days = weekDates.map { date -> TrainDay in
            let entries = byDate[date] ?? []
            let sessions = entries.map { entry in histSession(entry, hints: input.loadHints) }
            return TrainDay(
                date: date,
                kind: dayKind(date, today: input.today),
                isRest: sessions.isEmpty,
                sessions: sessions,
                observedLoad: observedLoad(date: date, sessions: sessions, hints: input.loadHints),
                coachNote: nil
            )
        }
        return makeWeek(
            id: isoWeekId(fromMonday: monday),
            days: days,
            hints: input.loadHints,
            isLive: false
        )
    }

    private static func histSession(_ entry: SyncCacheEntry, hints: LoadHints) -> TrainSession {
        let date = String(entry.startDateLocal.prefix(10))
        let sport = discipline(for: entry).asWarmSport
        return TrainSession(
            id: entry.fileName,
            title: entry.name,
            shortTitle: shortTitle(entry.name, sport: sport),
            sport: sport,
            status: .logged,
            load: sessionLoad(activity: entry, date: date, hints: hints),
            durationMin: Int((Double(entry.elapsedTime) / 60).rounded()),
            plannedMin: nil,
            subline: sportSubline(sport),
            phases: [],
            coachNote: nil,
            workout: nil,
            activity: entry
        )
    }

    // MARK: - Join / load

    private static func matchingActivity(
        _ session: CurrentWeekSession,
        date: String,
        in activities: [SyncCacheEntry]
    ) -> SyncCacheEntry? {
        for raw in session.completionActivityIds {
            let uuid = raw.hasPrefix("healthkit:") ? String(raw.dropFirst("healthkit:".count)) : raw
            if let hit = activities.first(where: { $0.activity?.activityId == uuid || $0.fileName.contains(uuid) }) {
                return hit
            }
        }
        let sameDay = activities.filter { $0.startDateLocal.hasPrefix(date) }
        if sameDay.count == 1 { return sameDay[0] }
        let sport = session.discipline.asWarmSport
        return sameDay.first { discipline(for: $0).asWarmSport == sport }
    }

    private static func sessionLoad(activity: SyncCacheEntry?, date: String, hints: LoadHints) -> Int? {
        if let activity, let zones = activity.activity?.hrZones, let load = HealthKitSyncManager.zoneLoad(hrZones: zones) {
            return load
        }
        return hints.loadByDate[date]
    }

    private static func observedLoad(date: String, sessions: [TrainSession], hints: LoadHints) -> Int? {
        if let hinted = hints.loadByDate[date] { return hinted }
        let values = sessions.compactMap(\.load)
        guard !values.isEmpty else { return nil }
        return values.reduce(0, +)
    }

    private static func makeWeek(id: String, days: [TrainDay], hints: LoadHints, isLive: Bool) -> TrainWeek {
        let logged = days.compactMap(\.observedLoad).reduce(0, +)
        let loggedOrNil: Int? = days.contains(where: { $0.observedLoad != nil }) ? logged : nil
        return TrainWeek(
            id: id,
            number: weekNumber(from: id),
            loggedLoad: loggedOrNil,
            bandVerdict: bandVerdict(logged: loggedOrNil, hints: hints),
            days: days,
            isLive: isLive
        )
    }

    private static func bandVerdict(logged: Int?, hints: LoadHints) -> String? {
        guard let logged, let low = hints.bandLow, let high = hints.bandHigh else { return nil }
        if Double(logged) > high { return "over the band" }
        if Double(logged) < low { return "under the band" }
        return "in the band"
    }

    // MARK: - Labels

    private static func dayKind(_ date: String, today: String) -> DayKind {
        if date == today { return .today }
        return date < today ? .past : .future
    }

    private static func shortTitle(_ title: String, sport: WarmSportId) -> String {
        let trimmed = title.trimmingCharacters(in: .whitespaces)
        if let hash = trimmed.range(of: "#") {
            let num = String(trimmed[hash.lowerBound...]).prefix(8)
            return "\(TrainFormat.sportCode(sport)) \(num)"
        }
        if trimmed.count <= 12 { return trimmed }
        return trimmed.split(separator: " ").prefix(2).joined(separator: " ")
    }

    private static func sportSubline(_ sport: WarmSportId) -> String {
        switch sport {
        case .weightTraining, .strength: return "Strength"
        case .foundation: return "Foundation"
        case .cycling: return "Ride"
        case .badminton: return "Badminton"
        case .calisthenics: return "Calisthenics"
        case .run: return "Run"
        default: return sport.rawValue.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    private static func subline(session: CurrentWeekSession, workout: Workout?, activity: SyncCacheEntry?) -> String {
        if let subtitle = workout?.subtitle, !subtitle.isEmpty { return subtitle }
        if activity != nil { return sportSubline(session.discipline.asWarmSport) }
        if let kind = session.kind.nilIfEmpty { return kind.replacingOccurrences(of: "_", with: " ") }
        if let minutes = session.plannedDurationMin { return "\(minutes) min" }
        return session.title
    }

    private static func weekNumber(from id: String) -> Int {
        if let range = id.range(of: #"W(\d+)"#, options: .regularExpression) {
            return Int(id[range].dropFirst()) ?? 0
        }
        return 0
    }

    private static func isoWeekId(fromMonday monday: String) -> String {
        "\(String(monday.prefix(4)))-W\(String(format: "%02d", isoWeekNumber(monday)))"
    }

    private static func isoWeekNumber(_ dateString: String) -> Int {
        var utcCalendar = Calendar(identifier: .gregorian)
        utcCalendar.timeZone = TimeZone(identifier: "UTC")!
        utcCalendar.firstWeekday = 2
        utcCalendar.minimumDaysInFirstWeek = 4
        let formatter = DateFormatter()
        formatter.calendar = utcCalendar
        formatter.timeZone = utcCalendar.timeZone
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: dateString) else { return 0 }
        return utcCalendar.component(.weekOfYear, from: date)
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

    static func defaultFocusIndex(in day: TrainDay) -> Int {
        if let draft = day.sessions.firstIndex(where: { $0.status == .draft }) {
            return draft
        }
        return 0
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
