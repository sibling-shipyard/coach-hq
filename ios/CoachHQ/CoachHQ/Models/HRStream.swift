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
    /// At most `max(200, 2 * covered runs)` — every run keeps its two endpoints, so a workout
    /// broken into many runs by sensor dropouts costs more than the flat budget.
    let points: [HRPoint]

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
