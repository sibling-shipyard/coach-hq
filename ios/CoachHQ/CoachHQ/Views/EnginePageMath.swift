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

    static func receiptSubject(body: String, doseRows: [DoseRowSnapshot]) -> String? {
        let sessions = doseRows.filter { $0.isRest != true }
        return sessions.first { body.localizedCaseInsensitiveContains($0.title) }?.title
    }

    static func namesMatch(_ a: String, _ b: String) -> Bool {
        a.trimmingCharacters(in: .whitespacesAndNewlines)
            .localizedCaseInsensitiveCompare(b.trimmingCharacters(in: .whitespacesAndNewlines)) == .orderedSame
    }

    static var isoCalendar: Calendar {
        var calendar = Calendar(identifier: .iso8601)
        calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? .gmt
        return calendar
    }
}
