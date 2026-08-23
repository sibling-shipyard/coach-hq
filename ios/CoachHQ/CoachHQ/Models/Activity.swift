import Foundation

/// Represents a single activity in the coach-phelps system.
/// Schema matches the JSON expected by the dashboard's Activity TypeScript interface.
struct Activity: Codable, Identifiable, Hashable {
    /// Identifiable conformance only — NOT encoded. Prefers the stored canonical
    /// id (HKWorkout uuid) when present, else falls back to a synthetic key so
    /// legacy files (no stored id) still get a stable-enough identity in lists.
    var id: String { activityId ?? "\(startDateLocal)_\(sportType)" }

    let name: String
    /// Optional machine category (e.g. "foundation", "RNK"). Nil on new HealthKit sync — manual tagging only until Phase 3 auto-rules.
    var category: String? = nil
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
    var sourceApp: String? = nil  // bundle ID of the app that wrote the HKWorkout (e.g. "com.garmin.connect2")
    var preMentalState: PreMentalState? = nil // absent from older history files; optional keeps decoding safe
    /// Same-sport medians computed from repository history after sync. Optional so
    /// activity JSON written before issue #292 keeps decoding unchanged.
    var vsUsual: VsUsual? = nil

    /// Canonical stable id persisted to JSON `"id"`. For HealthKit activities this
    /// is the `HKWorkout.uuid`. Optional (default nil) so legacy files (no id, or a
    /// numeric Strava id) still decode — see the custom `init(from:)` below — and so
    /// existing memberwise-init call sites that don't set it still compile.
    /// Declared last so these two params come last in the synthesized memberwise init.
    var activityId: String? = nil
    /// Persisted to JSON `"id_str"` (string form of the id). Same source as `activityId`.
    var idStr: String? = nil

    enum CodingKeys: String, CodingKey {
        case activityId = "id"
        case idStr = "id_str"
        case name
        case category
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
        case sourceApp = "source_app"
        case preMentalState = "pre_mental_state"
        case vsUsual = "vs_usual"
    }
}

extension Activity {
    /// Custom decode kept in an extension so the synthesized memberwise
    /// initializer is preserved. Everything mirrors synthesized behavior except
    /// `id`/`id_str`, which accept either a String or an Int: legacy Strava
    /// history files store `"id"` as a JSON number (e.g. 19143374603), which a
    /// plain `String?` decode would throw on. Encoding stays synthesized —
    /// optionals use `encodeIfPresent`, so nil `id`/`id_str` are omitted and
    /// present ones are written as strings.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)

        // Flexible String-or-Int id decode; missing → nil.
        func flexibleString(_ key: CodingKeys) -> String? {
            if let s = try? c.decode(String.self, forKey: key) { return s }
            if let i = try? c.decode(Int.self, forKey: key) { return String(i) }
            return nil
        }
        self.activityId = flexibleString(.activityId)
        self.idStr = flexibleString(.idStr)

        self.name = try c.decode(String.self, forKey: .name)
        self.category = try c.decodeIfPresent(String.self, forKey: .category)
        self.sportType = try c.decode(String.self, forKey: .sportType)
        self.startDateLocal = try c.decode(String.self, forKey: .startDateLocal)
        self.elapsedTime = try c.decode(Int.self, forKey: .elapsedTime)
        self.movingTime = try c.decode(Int.self, forKey: .movingTime)
        self.calories = try c.decodeIfPresent(Int.self, forKey: .calories)
        self.distance = try c.decode(Double.self, forKey: .distance)
        self.totalElevationGain = try c.decode(Double.self, forKey: .totalElevationGain)
        self.averageHeartrate = try c.decodeIfPresent(Double.self, forKey: .averageHeartrate)
        self.maxHeartrate = try c.decodeIfPresent(Double.self, forKey: .maxHeartrate)
        self.hasHeartrate = try c.decode(Bool.self, forKey: .hasHeartrate)
        self.hrZones = try c.decodeIfPresent([String: HRZoneEntry].self, forKey: .hrZones)
        self.description = try c.decodeIfPresent(String.self, forKey: .description)
        self.totalPhotoCount = try c.decode(Int.self, forKey: .totalPhotoCount)
        self.averageSpeed = try c.decode(Double.self, forKey: .averageSpeed)
        self.maxSpeed = try c.decode(Double.self, forKey: .maxSpeed)
        self.deviceName = try c.decodeIfPresent(String.self, forKey: .deviceName)
        self.source = try c.decode(String.self, forKey: .source)
        self.sourceApp = try c.decodeIfPresent(String.self, forKey: .sourceApp)
        self.preMentalState = try c.decodeIfPresent(PreMentalState.self, forKey: .preMentalState)
        self.vsUsual = try c.decodeIfPresent(VsUsual.self, forKey: .vsUsual)
    }
}

/// Durable same-sport baseline attached by the user-repo sync workflow.
/// Individual medians are optional because each metric needs two valid historical
/// observations even when the block itself has enough prior activities to exist.
struct VsUsual: Codable, Hashable {
    let durationMedianS: Double?
    let avgHRMedian: Double?
    let aboveThresholdMedianS: Double?

    enum CodingKeys: String, CodingKey {
        case durationMedianS = "duration_median_s"
        case avgHRMedian = "avg_hr_median"
        case aboveThresholdMedianS = "above_threshold_median_s"
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
