import Foundation

/// Assigns sequential names to activities based on sport type, weekday, and existing counters.
/// Mirrors the logic in `strava/rename_core.py` — classify_activity + generate_name.
struct ActivityNamer {

    /// Classification result: category + counter key + optional detail
    struct Classification {
        let category: String       // e.g., "hitrun_ranked", "foundation", "badminton_casual"
        let counterKey: String?    // e.g., "hitrun", "foundation" — nil means no counter
        let detail: String?        // e.g., "Ranked", opponent name
    }

    // MARK: - Classification (mirrors rename_core.py classify_activity)

    static let foundationMaxMinutes: Double = 25

    /// Classifies an activity based on sport type, weekday, and duration.
    static func classify(sportType: String, startDateLocal: String, elapsedTime: Int) -> Classification {
        let dow = weekday(from: startDateLocal) // 0=Mon, 6=Sun

        // Badminton
        if sportType == "Badminton" {
            if dow == 0 { // Monday = Ranked
                return Classification(category: "hitrun_ranked", counterKey: "hitrun", detail: nil)
            }
            if dow == 3 { // Thursday = Friendly
                return Classification(category: "hitrun_friendly", counterKey: "hitrun", detail: nil)
            }
            // All other days = casual (no counter)
            return Classification(category: "badminton_casual", counterKey: nil, detail: nil)
        }

        // Yoga
        if sportType == "Yoga" {
            if dow == 6 { // Sunday = Realign
                return Classification(category: "realign", counterKey: "realign", detail: nil)
            }
            return Classification(category: "recovery", counterKey: "recovery", detail: nil)
        }

        // WeightTraining / Foundation
        // ActivityMapper pre-classifies WeightTraining < foundationMaxMinutes as "Foundation"
        if sportType == "Foundation" {
            return Classification(category: "foundation", counterKey: "foundation", detail: nil)
        }
        if sportType == "WeightTraining" {
            return Classification(category: "calisthenics", counterKey: "calisthenics", detail: nil)
        }

        // Ride, Run, Walk — kept as-is with simple counter
        if sportType == "Ride" {
            return Classification(category: "ride", counterKey: "ride", detail: nil)
        }
        if sportType == "Run" {
            return Classification(category: "run", counterKey: "run", detail: nil)
        }

        return Classification(category: "other", counterKey: "other", detail: nil)
    }

    // MARK: - Name Generation (mirrors rename_core.py generate_name)

    /// Generates the display name for an activity given its classification and counter.
    static func generateName(classification: Classification, counter: Int) -> String {
        switch classification.category {
        case "foundation":
            let suffix = counter <= 9 ? "Core" : "Kickstart"
            return "Foundation #\(counter): \(suffix)"
        case "calisthenics":
            return "Calisthenics #\(counter): General"
        case "recovery":
            return "Recovery #\(counter)"
        case "realign":
            return "Realign #\(counter)"
        case "hitrun_ranked":
            return "Hit & Run #\(counter): Ranked"
        case "hitrun_friendly":
            return "Hit & Run #\(counter): Friendly"
        case "drills":
            return "Badminton Drills #\(counter)"
        case "league":
            if let detail = classification.detail, !detail.isEmpty {
                return "League #\(counter): vs \(detail)"
            }
            return "League #\(counter)"
        case "ride":
            return "Ride #\(counter)"
        case "run":
            return "Run #\(counter)"
        default:
            return "Other #\(counter)"
        }
    }

    /// Generates a casual badminton name (no counter, weekday-based).
    static func generateCasualBadmintonName(startDateLocal: String) -> String {
        let dow = weekday(from: startDateLocal)
        let dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        let day = dow >= 0 && dow < 7 ? dayNames[dow] : "Unknown"
        return "Badminton: \(day) session"
    }

    // MARK: - Public API

    /// Assigns a name to an activity using the shared counters from sync_state.json.
    /// Mutates `counters` so sequential calls in the same sync run number correctly.
    static func assignName(activity: Activity, counters: inout [String: Int]) -> Activity {
        let classification = classify(
            sportType: activity.sportType,
            startDateLocal: activity.startDateLocal,
            elapsedTime: activity.elapsedTime
        )

        let name: String
        if classification.category == "badminton_casual" {
            // Casual badminton: no counter, weekday-based name
            name = generateCasualBadmintonName(startDateLocal: activity.startDateLocal)
        } else if let key = classification.counterKey {
            counters[key] = (counters[key] ?? 0) + 1
            name = generateName(classification: classification, counter: counters[key]!)
        } else {
            name = activity.sportType
        }

        return Activity(
            name: name,
            sportType: activity.sportType,
            startDateLocal: activity.startDateLocal,
            elapsedTime: activity.elapsedTime,
            movingTime: activity.movingTime,
            calories: activity.calories,
            distance: activity.distance,
            totalElevationGain: activity.totalElevationGain,
            averageHeartrate: activity.averageHeartrate,
            maxHeartrate: activity.maxHeartrate,
            hasHeartrate: activity.hasHeartrate,
            hrZones: activity.hrZones,
            description: activity.description,
            totalPhotoCount: activity.totalPhotoCount,
            averageSpeed: activity.averageSpeed,
            maxSpeed: activity.maxSpeed,
            deviceName: activity.deviceName,
            source: activity.source
        )
    }

    /// Generates the file name for an activity.
    /// Format: `hk_YYYY-MM-DD_<category>_<number>.json`
    static func fileName(for activity: Activity) -> String {
        let date = String(activity.startDateLocal.prefix(10)) // YYYY-MM-DD

        // Extract category from name for file naming
        let fileCategory: String
        let number: String

        if activity.name.starts(with: "Badminton:") {
            // Casual badminton — use date + time as unique suffix
            let time = String(activity.startDateLocal.dropFirst(11).prefix(5))
                .replacingOccurrences(of: ":", with: "")
            return "hk_\(date)_badminton_\(time).json"
        } else if let hashIndex = activity.name.lastIndex(of: "#") {
            let prefix = String(activity.name[..<hashIndex]).trimmingCharacters(in: .whitespaces)
            let afterHash = String(activity.name[activity.name.index(after: hashIndex)...])
            // Number is everything before ":" or end
            number = afterHash.components(separatedBy: ":").first?.trimmingCharacters(in: .whitespaces) ?? "0"
            fileCategory = prefix.lowercased()
                .replacingOccurrences(of: " & ", with: "_")
                .replacingOccurrences(of: " ", with: "_")
                .trimmingCharacters(in: CharacterSet(charactersIn: "_"))
        } else {
            fileCategory = activity.sportType.lowercased()
            number = "0"
        }

        return "hk_\(date)_\(fileCategory)_\(number).json"
    }

    // MARK: - Helpers

    /// Returns weekday from ISO date string (0=Monday, 6=Sunday) to match Python's weekday().
    private static func weekday(from dateString: String) -> Int {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        formatter.timeZone = .current

        guard let date = formatter.date(from: dateString) else { return -1 }

        // Calendar weekday: 1=Sunday, 2=Monday, ..., 7=Saturday
        // Python weekday: 0=Monday, ..., 6=Sunday
        let calendarWeekday = Calendar.current.component(.weekday, from: date)
        return (calendarWeekday + 5) % 7 // Convert: Sun(1)→6, Mon(2)→0, ..., Sat(7)→5
    }
}
