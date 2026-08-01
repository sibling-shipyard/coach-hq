import Foundation

/// Assigns sequential names to activities based on sport type.
struct ActivityNamer {

    /// Assigns a generic sequential name and derives category.
    static func assignName(activity: Activity, counters: inout [String: Int], container: CategoriesConfigContainer) -> Activity {
        let category = CategoryConfig.resolve(sportType: activity.sportType, elapsedTime: activity.elapsedTime, startDateLocal: activity.startDateLocal, container: container)
        let counterKey = activity.sportType.lowercased()
        
        counters[counterKey] = (counters[counterKey] ?? 0) + 1
        let count = counters[counterKey]!
        let name = "\(activity.sportType) #\(count)"
        
        return Activity(
            name: name,
            category: category,
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
            source: activity.source,
            activityId: activity.activityId,
            idStr: activity.idStr,
            preMentalState: activity.preMentalState
        )
    }

    /// Generates the file name for an activity.
<<<<<<< HEAD
    /// Format: `hk_YYYY-MM-DD_<uuid>.json`, where `<uuid>` is the HKWorkout uuid
    /// (`activity.activityId`). The `YYYY-MM-DD` prefix is kept for browsability
    /// and the pipeline's date-prefilter. The uuid makes the filename
    /// deterministic, so re-syncing the same workout dedups by exact name.
    ///
    /// Legacy fallback (only when `activityId` is nil, which shouldn't happen for
    /// HealthKit): the old `hk_YYYY-MM-DD_<category>_<number>.json` scheme.
    static func fileName(for activity: Activity) -> String {
        let date = String(activity.startDateLocal.prefix(10)) // YYYY-MM-DD

        if let uuid = activity.activityId {
            return "hk_\(date)_\(uuid).json"
        }

        // Fallback: derive category + counter from the display name.
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
=======
    /// Format: `hk_YYYY-MM-DD_HHMMSS_<UUID>.json` or similar unique string.
    static func fileName(for activity: Activity) -> String {
        let date = String(activity.startDateLocal.prefix(10)) // YYYY-MM-DD
        let time = String(activity.startDateLocal.dropFirst(11).prefix(8))
            .replacingOccurrences(of: ":", with: "")
        let idPart = UUID().uuidString.prefix(8).lowercased()
        
        return "hk_\(date)_\(time)_\(idPart).json"
>>>>>>> df6a543 (core: generic naming + category field (fixes #143))
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

