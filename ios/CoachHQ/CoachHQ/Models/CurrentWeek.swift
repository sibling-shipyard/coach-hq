import Foundation

/// Codable mirror of `engine/lib/current-week.mts`'s `CurrentWeek` schema (v1). Source of
/// truth stays the TypeScript file — this just decodes the same JSON on the iOS side, the
/// way `Workout.swift` mirrors the workout files. No deep field validation here (the engine
/// side already owns that at write time); a malformed file just fails to decode and the
/// Workouts tab falls back to "no live plan", the same as a missing file.
///
/// A5-ios: first Swift consumer of `user_data/ledger/current_week.json`.

/// Not a closed set on purpose, same reasoning as `WorkoutType` — a new discipline value
/// added on the engine side must not fail decode of the whole week file.
enum CurrentWeekSessionDiscipline: Hashable {
    case badminton, calisthenics, cycling, foundation, recovery, run, strength
    case weightTraining, hike, walk, cricket, football, workout, swim
    case other(String)

    var rawValue: String {
        switch self {
        case .badminton: return "badminton"
        case .calisthenics: return "calisthenics"
        case .cycling: return "cycling"
        case .foundation: return "foundation"
        case .recovery: return "recovery"
        case .run: return "run"
        case .strength: return "strength"
        case .weightTraining: return "weight_training"
        case .hike: return "hike"
        case .walk: return "walk"
        case .cricket: return "cricket"
        case .football: return "football"
        case .workout: return "workout"
        case .swim: return "swim"
        case .other(let raw): return raw
        }
    }

    /// `SessionDiscipline` is a superset of `WarmSportId` — only "recovery" has no dedicated
    /// glyph, so it renders as foundation's icon/color instead (matches web's `asWarmSport`).
    var asWarmSport: WarmSportId {
        switch self {
        case .recovery: return .foundation
        default: return WarmSportId(rawValue: rawValue) ?? .other
        }
    }
}

extension CurrentWeekSessionDiscipline: Codable {
    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        switch raw {
        case "badminton": self = .badminton
        case "calisthenics": self = .calisthenics
        case "cycling": self = .cycling
        case "foundation": self = .foundation
        case "recovery": self = .recovery
        case "run": self = .run
        case "strength": self = .strength
        case "weight_training": self = .weightTraining
        case "hike": self = .hike
        case "walk": self = .walk
        case "cricket": self = .cricket
        case "football": self = .football
        case "workout": self = .workout
        case "swim": self = .swim
        default: self = .other(raw)
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

enum CurrentWeekSessionOrigin: String, Codable, Hashable {
    case planned, unplanned
}

enum CurrentWeekSessionPriority: String, Codable, Hashable {
    case anchor, support, optional
}

enum CurrentWeekSessionStatus: String, Codable, Hashable {
    case planned, done, skipped
}

struct CurrentWeekSession: Codable, Hashable {
    let id: String
    let origin: CurrentWeekSessionOrigin
    let discipline: CurrentWeekSessionDiscipline
    let kind: String
    let title: String
    let priority: CurrentWeekSessionPriority?
    let status: CurrentWeekSessionStatus
    let plannedDurationMin: Int?
    let templateId: String?
    let sessionFile: String?
    let coachNote: String?
    let originalDate: String?
    let completionActivityIds: [String]

    enum CodingKeys: String, CodingKey {
        case id, origin, discipline, kind, title, priority, status
        case plannedDurationMin = "planned_duration_min"
        case templateId = "template_id"
        case sessionFile = "session_file"
        case coachNote = "coach_note"
        case originalDate = "original_date"
        case completionActivityIds = "completion_activity_ids"
    }
}

struct CurrentWeekDay: Codable, Hashable {
    let date: String
    let intent: String?
    let coachNote: String?
    let sessions: [CurrentWeekSession]

    enum CodingKeys: String, CodingKey {
        case date, intent, sessions
        case coachNote = "coach_note"
    }
}

struct CurrentWeekRange: Codable, Hashable {
    let id: String
    let startDate: String
    let endDate: String
    let focus: String?
    let guardrails: [String]

    enum CodingKeys: String, CodingKey {
        case id, focus, guardrails
        case startDate = "start_date"
        case endDate = "end_date"
    }
}

struct CoachRead: Codable, Hashable {
    let headline: String
    let body: String
    let validFrom: String
    let validUntil: String

    enum CodingKeys: String, CodingKey {
        case headline, body
        case validFrom = "valid_from"
        case validUntil = "valid_until"
    }
}

struct CurrentWeek: Codable, Hashable {
    let schemaVersion: Int
    let dataStatus: String // "placeholder" | "live"
    let timezone: String
    let week: CurrentWeekRange
    let coachRead: CoachRead?
    let days: [CurrentWeekDay]
    let updatedAt: String
    let updatedBy: String
    let traceId: String

    enum CodingKeys: String, CodingKey {
        case timezone, week, days
        case schemaVersion = "schema_version"
        case dataStatus = "data_status"
        case coachRead = "coach_read"
        case updatedAt = "updated_at"
        case updatedBy = "updated_by"
        case traceId = "trace_id"
    }
}

// MARK: - Availability

enum CurrentWeekAvailabilityStatus {
    case current, grace, placeholder, upcoming, stale
}

struct CurrentWeekAvailability {
    let status: CurrentWeekAvailabilityStatus
    let available: Bool
}

/// Same rule table as `engine/lib/current-week.mts`'s `getAvailability`: a placeholder plan
/// is never live; a live plan is available from its start date through one day past its end
/// date (rollover grace), and stale after that.
func computeCurrentWeekAvailability(for data: CurrentWeek, today: String) -> CurrentWeekAvailability {
    guard data.dataStatus == "live" else {
        return CurrentWeekAvailability(status: .placeholder, available: false)
    }
    if today < data.week.startDate {
        return CurrentWeekAvailability(status: .upcoming, available: false)
    }
    if today <= data.week.endDate {
        return CurrentWeekAvailability(status: .current, available: true)
    }
    if today == addDaysToDateString(data.week.endDate, 1) {
        return CurrentWeekAvailability(status: .grace, available: true)
    }
    return CurrentWeekAvailability(status: .stale, available: false)
}

/// `YYYY-MM-DD` arithmetic done in UTC so it never drifts with the device's own timezone —
/// the date strings themselves are already timezone-agnostic calendar days.
func addDaysToDateString(_ dateString: String, _ days: Int) -> String {
    var utcCalendar = Calendar(identifier: .gregorian)
    utcCalendar.timeZone = TimeZone(identifier: "UTC")!
    let formatter = DateFormatter()
    formatter.calendar = utcCalendar
    formatter.timeZone = utcCalendar.timeZone
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd"
    guard let date = formatter.date(from: dateString),
          let shifted = utcCalendar.date(byAdding: .day, value: days, to: date) else {
        return dateString
    }
    return formatter.string(from: shifted)
}

/// Today's date string in a given IANA timezone identifier, falling back to UTC for an
/// invalid identifier — used so "today" never silently resolves against the device's zone.
func dateString(for date: Date, inTimeZoneIdentifier identifier: String) -> String {
    let timeZone = TimeZone(identifier: identifier) ?? TimeZone(identifier: "UTC")!
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = timeZone
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
}
