import Foundation

/// Derived Engine-page figures. Snapshots already carry load, band, trend, and dose rows
/// (ADR 0005); this only turns those fields into verdict copy, `+N%`, and Mon→Sun groups.
enum EnginePageMath {
    static let plotLow: Double = 300
    static let plotHigh: Double = 950
    static let dayOrder = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]

    enum BandRelation: Equatable {
        case under(Int)
        case inside
        case over(Int)
    }

    struct DoseGroup {
        let day: String
        let dayNumber: Int?
        let rows: [DoseRowSnapshot]

        var sessionCount: Int { rows.count }

        var loadSum: Int {
            rows.reduce(0) { $0 + Int(($1.load ?? 0).rounded()) }
        }
    }

    struct SessionMeta: Equatable {
        var minutes: Int?
        var averageHR: Int?
    }

    struct HistSession: Equatable {
        var name: String
        var startDateLocal: String
        var elapsedSeconds: Int
        var averageHeartrate: Double?
        var sportType: String = ""
        var load: Int?
    }

    static func bandRelation(load: Double, bandLow: Double?, bandHigh: Double?) -> BandRelation? {
        guard let lo = bandLow, let hi = bandHigh else { return nil }
        let roundedLoad = Int(load.rounded())
        let roundedLo = Int(lo.rounded())
        let roundedHi = Int(hi.rounded())
        if roundedLoad < roundedLo { return .under(roundedLo - roundedLoad) }
        if roundedLoad > roundedHi { return .over(roundedLoad - roundedHi) }
        return .inside
    }

    static func verdict(for relation: BandRelation) -> String {
        switch relation {
        case .under: return "Absorb."
        case .inside: return "In rhythm."
        case .over: return "Ease off."
        }
    }

    static func sub(for relation: BandRelation) -> String {
        switch relation {
        case .under(let n): return "\(n) UNDER THE BAND"
        case .inside: return "INSIDE THE BAND"
        case .over(let n): return "\(n) OVER THE BAND"
        }
    }

    /// Midpoint of this week's band vs the band midpoint eight weeks ago, nearest percent.
    static func percentVs8wAgo(bandLow: Double, bandHigh: Double, agoLow: Double, agoHigh: Double) -> Int? {
        let mid = (bandLow + bandHigh) / 2
        let mid8 = (agoLow + agoHigh) / 2
        guard mid8 != 0 else { return nil }
        return Int((((mid - mid8) / mid8) * 100).rounded())
    }

    /// Snapshot `doseRows` are the last 5 sessions of the week (web `slice(-5)`). Prefer hist.
    static func ledgerRows(
        doseRows: [DoseRowSnapshot],
        hist: [HistSession],
        weekDates: Set<String>
    ) -> [DoseRowSnapshot] {
        let fromHist = rowsFromHist(hist, weekDates: weekDates)
        if !fromHist.isEmpty { return fromHist }
        return doseRows.filter { $0.isRest != true }
    }

    static func rowsFromHist(_ hist: [HistSession], weekDates: Set<String>) -> [DoseRowSnapshot] {
        hist
            .filter { weekDates.contains(dateKey($0.startDateLocal)) }
            .sorted { $0.startDateLocal < $1.startDateLocal }
            .map { session in
                DoseRowSnapshot(
                    day: weekday(from: session.startDateLocal),
                    title: session.name,
                    detail: nil,
                    load: session.load.map(Double.init),
                    sport: sport(from: session.sportType),
                    isRest: nil
                )
            }
    }

    static func weekday(from startDateLocal: String, calendar: Calendar = EnginePageMath.isoCalendar) -> String {
        guard let date = parseLocal(startDateLocal) else { return "MON" }
        let index = calendar.component(.weekday, from: date)
        // ISO calendar: Monday = 2 … Sunday = 1
        switch index {
        case 2: return "MON"
        case 3: return "TUE"
        case 4: return "WED"
        case 5: return "THU"
        case 6: return "FRI"
        case 7: return "SAT"
        default: return "SUN"
        }
    }

    static func parseLocal(_ startDateLocal: String) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        formatter.timeZone = calendarTimeZone
        return formatter.date(from: String(startDateLocal.prefix(19)))
            ?? {
                formatter.dateFormat = "yyyy-MM-dd"
                return formatter.date(from: dateKey(startDateLocal))
            }()
    }

    static func sport(from sportType: String) -> WarmSportId {
        switch sportType {
        case "Badminton": return .badminton
        case "WeightTraining", "Foundation", "TraditionalStrengthTraining", "FunctionalStrengthTraining":
            return .weightTraining
        case "Ride", "EBikeRide", "Cycling": return .cycling
        case "Run", "Running": return .run
        default:
            return WarmSportId(rawValue: sportType.lowercased()) ?? .other
        }
    }

    static func groupedSessions(
        rows: [DoseRowSnapshot],
        dayNumbers: [String: Int] = [:]
    ) -> [DoseGroup] {
        let sessions = rows.filter { $0.isRest != true }
        var buckets: [String: [DoseRowSnapshot]] = [:]
        for row in sessions {
            buckets[row.day.uppercased(), default: []].append(row)
        }
        return dayOrder.compactMap { day in
            guard let items = buckets[day], !items.isEmpty else { return nil }
            return DoseGroup(day: day, dayNumber: dayNumbers[day], rows: items)
        }
    }

    static func weekNumber(from weekLabel: String) -> Int? {
        let digits = weekLabel.filter(\.isNumber)
        guard let value = Int(digits), (1...53).contains(value) else { return nil }
        return value
    }

    static func compactWeekLabel(_ label: String) -> String {
        if let n = weekNumber(from: label) { return "W\(n)" }
        let trimmed = label.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? label : trimmed.uppercased()
    }

    static func mondayOfISOWeek(_ week: Int, year: Int, calendar: Calendar = EnginePageMath.isoCalendar) -> Date? {
        var components = DateComponents()
        components.weekOfYear = week
        components.yearForWeekOfYear = year
        components.weekday = 2
        return calendar.date(from: components)
    }

    static func mondayForWeekLabel(
        _ weekLabel: String,
        now: Date = Date(),
        calendar: Calendar = EnginePageMath.isoCalendar
    ) -> Date? {
        guard let week = weekNumber(from: weekLabel) else { return nil }
        let currentWeek = calendar.component(.weekOfYear, from: now)
        var year = calendar.component(.yearForWeekOfYear, from: now)
        if week > currentWeek + 8 { year -= 1 }
        return mondayOfISOWeek(week, year: year, calendar: calendar)
    }

    static func dayNumbers(
        weekLabel: String,
        now: Date = Date(),
        calendar: Calendar = EnginePageMath.isoCalendar
    ) -> [String: Int] {
        guard let monday = mondayForWeekLabel(weekLabel, now: now, calendar: calendar) else { return [:] }
        var result: [String: Int] = [:]
        for (index, day) in dayOrder.enumerated() {
            guard let date = calendar.date(byAdding: .day, value: index, to: monday) else { continue }
            result[day] = calendar.component(.day, from: date)
        }
        return result
    }

    static func weekDateKeys(
        weekLabel: String,
        now: Date = Date(),
        calendar: Calendar = EnginePageMath.isoCalendar
    ) -> Set<String> {
        guard let monday = mondayForWeekLabel(weekLabel, now: now, calendar: calendar) else { return [] }
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return Set((0..<7).compactMap { offset in
            calendar.date(byAdding: .day, value: offset, to: monday).map(formatter.string(from:))
        })
    }

    static func sessionMeta(row: DoseRowSnapshot, hist: [HistSession], weekDates: Set<String>) -> SessionMeta {
        let match = hist.first { candidate in
            namesMatch(candidate.name, row.title) && weekDates.contains(dateKey(candidate.startDateLocal))
        }
        guard let match else { return SessionMeta() }
        let minutes = max(0, match.elapsedSeconds / 60)
        let hr = match.averageHeartrate.map { Int($0.rounded()) }
        return SessionMeta(minutes: minutes, averageHR: hr)
    }

    static func dateKey(_ startDateLocal: String) -> String {
        String(startDateLocal.prefix(10))
    }

    static func namesMatch(_ a: String, _ b: String) -> Bool {
        a.trimmingCharacters(in: .whitespacesAndNewlines)
            .localizedCaseInsensitiveCompare(b.trimmingCharacters(in: .whitespacesAndNewlines)) == .orderedSame
    }

    static var calendarTimeZone: TimeZone { .current }

    static var isoCalendar: Calendar {
        var calendar = Calendar(identifier: .iso8601)
        calendar.timeZone = calendarTimeZone
        return calendar
    }
}
