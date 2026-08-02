import Foundation

struct SportConfig: Codable {
    let sport: String
    let categories: [CategoryEntry]
}

struct CategoryEntry: Codable {
    let code: String
    let label: String
    let rule: CategoryRule?
}

struct CategoryItemDetails: Codable {
    let label: String
    let rule: CategoryRule?
}

struct CategoryRule: Codable {
    let duration_lt: Int?
    let duration_gte: Int?
    let weekday: String?
}

enum CategoriesConfigContainer {
    case array([SportConfig])
    case dict([String: [String: CategoryItemDetails]])
}

struct CategoryConfig {
    static func decodeContainer(from data: Data) -> CategoriesConfigContainer? {
        let decoder = JSONDecoder()
        if let dict = try? decoder.decode([String: [String: CategoryItemDetails]].self, from: data) {
            return .dict(dict)
        }
        if let array = try? decoder.decode([SportConfig].self, from: data) {
            return .array(array)
        }
        return nil
    }

    static func resolve(sportType: String, elapsedTime: Int, startDateLocal: String, container: CategoriesConfigContainer) -> String {
        let cleanDate = startDateLocal.replacingOccurrences(of: "Z", with: "")
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        formatter.timeZone = .current
        
        var dayName = ""
        if let date = formatter.date(from: cleanDate) {
            let dayFormatter = DateFormatter()
            dayFormatter.dateFormat = "EEE" // "Mon", "Tue", etc.
            dayFormatter.locale = Locale(identifier: "en_US_POSIX")
            dayFormatter.timeZone = .current
            dayName = dayFormatter.string(from: date)
        }

        switch container {
        case .dict(let map):
            guard let sportMap = map[sportType], !sportMap.isEmpty else {
                return String(sportType.prefix(3)).uppercased()
            }
            let firstCode = sportMap.keys.first ?? String(sportType.prefix(3)).uppercased()
            for (code, details) in sportMap {
                guard let rule = details.rule else {
                    return code
                }
                var matches = true
                if let lt = rule.duration_lt, elapsedTime >= lt { matches = false }
                if let gte = rule.duration_gte, elapsedTime < gte { matches = false }
                if let wd = rule.weekday, wd != dayName { matches = false }
                if matches { return code }
            }
            return firstCode

        case .array(let list):
            guard let sportConfig = list.first(where: { $0.sport == sportType }) else {
                return String(sportType.prefix(3)).uppercased()
            }
            for entry in sportConfig.categories {
                guard let rule = entry.rule else { return entry.code }
                var matches = true
                if let lt = rule.duration_lt, elapsedTime >= lt { matches = false }
                if let gte = rule.duration_gte, elapsedTime < gte { matches = false }
                if let wd = rule.weekday, wd != dayName { matches = false }
                if matches { return entry.code }
            }
            return sportConfig.categories.first?.code ?? String(sportType.prefix(3)).uppercased()
        }
    }

    // Overload for backward compatibility if passed [SportConfig] array directly
    static func resolve(sportType: String, elapsedTime: Int, startDateLocal: String, config: [SportConfig]) -> String {
        return resolve(sportType: sportType, elapsedTime: elapsedTime, startDateLocal: startDateLocal, container: .array(config))
    }
}
