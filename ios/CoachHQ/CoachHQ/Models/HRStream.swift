import Foundation

/// Sidecar file written alongside an activity: the display heart-rate curve for one workout.
///
/// Lives at `user_data/activities/streams/<uuid>.json`, keyed by the HealthKit workout uuid
/// (ADR 0014). Kept out of `hist/*.json` deliberately — ADR 0027: the curve averages ~9.4KB per
/// activity, and Coach reading one activity should not pull 200 heart-rate points into context.
///
/// `t` and the gap bounds are integer seconds from `start`. An int per point instead of a
/// 25-byte ISO string is most of why this file stays small.
struct HRStreamFile: Codable, Equatable {
    let schemaVersion: Int
    let generator: String
    let activityId: String
    let start: String
    let elapsedSeconds: Int
    /// How many raw samples the curve was decimated from. Lets a reader judge fidelity
    /// without going back to HealthKit.
    let sourceSampleCount: Int
    let coveredSeconds: Int
    let uncoveredSeconds: Int
    let gaps: [HRGap]
    /// Compact full-sample summary for Coach. Optional so sidecars containing only display
    /// data remain decodable.
    let effortShape: [HREffortBlock]?
    /// At most `max(200, 2 * covered runs)` — every run keeps its two endpoints, so a workout
    /// broken into many runs by sensor dropouts costs more than the flat budget.
    let points: [HRPoint]

    init(
        schemaVersion: Int,
        generator: String,
        activityId: String,
        start: String,
        elapsedSeconds: Int,
        sourceSampleCount: Int,
        coveredSeconds: Int,
        uncoveredSeconds: Int,
        gaps: [HRGap],
        effortShape: [HREffortBlock]? = nil,
        points: [HRPoint]
    ) {
        self.schemaVersion = schemaVersion
        self.generator = generator
        self.activityId = activityId
        self.start = start
        self.elapsedSeconds = elapsedSeconds
        self.sourceSampleCount = sourceSampleCount
        self.coveredSeconds = coveredSeconds
        self.uncoveredSeconds = uncoveredSeconds
        self.gaps = gaps
        self.effortShape = effortShape
        self.points = points
    }

    /// Bumping this forces backfill to rewrite the file (LLD §5 — idempotency is by
    /// schema version + generator, never by file existence).
    static let currentSchemaVersion = 1
    static let currentGenerator = "hk-stream/1"

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case generator
        case activityId = "activity_id"
        case start
        case elapsedSeconds = "elapsed_seconds"
        case sourceSampleCount = "source_sample_count"
        case coveredSeconds = "covered_seconds"
        case uncoveredSeconds = "uncovered_seconds"
        case gaps
        case effortShape = "effort_shape"
        case points
    }
}

/// A stretch of the workout with no heart-rate coverage. Seconds from the workout start.
struct HRGap: Codable, Equatable {
    let from: Int
    let to: Int
}

/// One point on the display curve. `t` is seconds from the workout start.
struct HRPoint: Codable, Equatable {
    let t: Int
    let bpm: Int
}

/// One covered elapsed-time block in the full-sample heart-rate summary.
struct HREffortBlock: Codable, Equatable {
    let startSeconds: Int
    let endSeconds: Int
    let medianBpm: Int
    let p90Bpm: Int
    let dominantZone: String
    let coveredSeconds: Int

    enum CodingKeys: String, CodingKey {
        case startSeconds = "start_seconds"
        case endSeconds = "end_seconds"
        case medianBpm = "median_bpm"
        case p90Bpm = "p90_bpm"
        case dominantZone = "dominant_zone"
        case coveredSeconds = "covered_seconds"
    }
}

/// Result of integrating zones over the full sample set.
///
/// The invariant that makes this trustworthy: `sum(zones.seconds) + uncoveredSeconds` equals
/// the workout's elapsed time. Partial sensor coverage reads as partial rather than as false
/// precision — a ten-minute dropout reports 600s uncovered, not 600s of Zone 2.
struct HRZoneResult: Equatable {
    let zones: [String: HRZoneEntry]
    let uncoveredSeconds: Double
    let coveredSeconds: Double
}
