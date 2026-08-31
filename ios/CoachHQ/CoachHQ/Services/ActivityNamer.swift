import Foundation

/// Assigns sequential generic names to activities based on sport type.
/// Counters reset each calendar year (derived from `startDateLocal`), matching
/// `migrate_activity_naming.py` and `engine/core/rename_core.py`.
struct ActivityNamer {

    private static let yearCounterSeparator = ":"

    // MARK: - Public API

    /// Calendar year from `start_date_local` (`YYYY-MM-DD…`).
    static func year(from startDateLocal: String) -> Int {
        guard startDateLocal.count >= 4, let year = Int(startDateLocal.prefix(4)) else {
            return Calendar.current.component(.year, from: Date())
        }
        return year
    }

    /// Seeds year-scoped counters from flat sync_state values (latest-year max per sport).
    static func expandCounters(_ flat: [String: Int], referenceYear: Int) -> [String: Int] {
        var expanded: [String: Int] = [:]
        for (sport, count) in flat {
            expanded[yearScopedKey(sport: sport, year: referenceYear)] = count
        }
        return expanded
    }

    /// Collapses year-scoped counters to flat latest-year max per sport for sync_state.
    static func flattenCounters(_ counters: [String: Int]) -> (flat: [String: Int], latestYear: Int) {
        var latestYear = Calendar.current.component(.year, from: Date())
        for key in counters.keys {
            if let year = Int(key.split(separator: Character(yearCounterSeparator)).last ?? "") {
                latestYear = max(latestYear, year)
            }
        }

        var flat: [String: Int] = [:]
        for (key, count) in counters {
            let parts = key.split(separator: Character(yearCounterSeparator), maxSplits: 1)
            guard parts.count == 2, let year = Int(parts[1]), year == latestYear else { continue }
            let sport = String(parts[0])
            flat[sport] = max(flat[sport] ?? 0, count)
        }
        return (flat, latestYear)
    }

    /// Assigns a generic sequential name `{SportType} #{N}`. Category is left nil —
    /// manual tagging only in Phase 1; auto-assignment deferred to Phase 3.
    static func assignName(activity: Activity, counters: inout [String: Int]) -> Activity {
        let year = year(from: activity.startDateLocal)
        let counterKey = yearScopedKey(sport: activity.sportType, year: year)
        counters[counterKey] = (counters[counterKey] ?? 0) + 1
        let count = counters[counterKey]!
        let name = "\(activity.sportType) #\(count)"

        return Activity(
            name: name,
            category: nil,
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
            sourceApp: activity.sourceApp,
            preMentalState: activity.preMentalState,
            vsUsual: activity.vsUsual,
            aliases: activity.aliases,
            activityId: activity.activityId,
            idStr: activity.idStr
        )
    }

    /// Generates the file name for an activity.
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
    }

    // MARK: - Private

    private static func yearScopedKey(sport: String, year: Int) -> String {
        "\(sport.lowercased())\(yearCounterSeparator)\(year)"
    }
}
