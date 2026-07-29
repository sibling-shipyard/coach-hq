import Foundation

/// Represents a single activity in the coach-phelps system.
/// Schema matches the JSON expected by the dashboard's Activity TypeScript interface.
struct Activity: Codable, Identifiable, Hashable {
    var id: String { "\(startDateLocal)_\(sportType)" }

    let name: String
    let sportType: String
    let startDateLocal: String
    let elapsedTime: Int          // seconds
    let movingTime: Int           // seconds (same as elapsed for HealthKit)
    let calories: Int?
    let distance: Double          // meters (0 for non-GPS workouts)
    let totalElevationGain: Double // meters
    let averageHeartrate: Double?
    let maxHeartrate: Double?
    let hasHeartrate: Bool
    let hrZones: [String: HRZoneEntry]?
    let description: String?
    let totalPhotoCount: Int
    let averageSpeed: Double      // m/s
    let maxSpeed: Double          // m/s
    let deviceName: String?
    let source: String            // "healthkit" or "strava"
    var preMentalState: PreMentalState? = nil // absent from older history files; optional keeps decoding safe

    enum CodingKeys: String, CodingKey {
        case name
        case sportType = "sport_type"
        case startDateLocal = "start_date_local"
        case elapsedTime = "elapsed_time"
        case movingTime = "moving_time"
        case calories
        case distance
        case totalElevationGain = "total_elevation_gain"
        case averageHeartrate = "average_heartrate"
        case maxHeartrate = "max_heartrate"
        case hasHeartrate = "has_heartrate"
        case hrZones = "hr_zones"
        case description
        case totalPhotoCount = "total_photo_count"
        case averageSpeed = "average_speed"
        case maxSpeed = "max_speed"
        case deviceName = "device_name"
        case source
        case preMentalState = "pre_mental_state"
    }
}

/// A pre-session mental-state check-in, e.g. from a `PRE: 7, focused` line in a
/// pasted description. Stored locally only — never written into the formatted
/// description text.
struct PreMentalState: Codable, Hashable {
    let score: Int
    let word: String
}

/// Matches the dashboard's HrZone interface: { low, high, seconds }
/// Keys are "Zone 1" … "Zone 5" to match Strava pipeline output.
struct HRZoneEntry: Codable, Hashable {
    let low: Int?
    let high: Int?
    let seconds: Double
}

/// User-configurable HR zone boundaries
struct HRZoneConfig: Codable {
    let zone1Upper: Int
    let zone2Upper: Int
    let zone3Upper: Int
    let zone4Upper: Int
    // zone5 = anything above zone4Upper

    static let zone1UpperKey = "hrZone1Upper"
    static let zone2UpperKey = "hrZone2Upper"
    static let zone3UpperKey = "hrZone3Upper"
    static let zone4UpperKey = "hrZone4Upper"

    static let defaultZone1Upper = 131
    static let defaultZone2Upper = 145
    static let defaultZone3Upper = 158
    static let defaultZone4Upper = 172

    static let `default` = HRZoneConfig(
        zone1Upper: defaultZone1Upper,
        zone2Upper: defaultZone2Upper,
        zone3Upper: defaultZone3Upper,
        zone4Upper: defaultZone4Upper
    )

    /// Reads zone boundaries from UserDefaults, falling back to defaults.
    static var current: HRZoneConfig {
        func read(_ key: String, fallback: Int) -> Int {
            let v = UserDefaults.standard.integer(forKey: key)
            return v > 0 ? v : fallback
        }
        return HRZoneConfig(
            zone1Upper: read(zone1UpperKey, fallback: defaultZone1Upper),
            zone2Upper: read(zone2UpperKey, fallback: defaultZone2Upper),
            zone3Upper: read(zone3UpperKey, fallback: defaultZone3Upper),
            zone4Upper: read(zone4UpperKey, fallback: defaultZone4Upper)
        )
    }
}
