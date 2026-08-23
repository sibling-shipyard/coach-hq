import Foundation
import HealthKit

/// Maps HealthKit HKWorkout objects to the Activity schema.
struct ActivityMapper {

    /// Priority score for a HealthKit source app bundle ID.
    /// Higher score = preferred when deduplicating same-activity duplicates.
    /// apple native > garmin > strava > unknown
    static func sourcePriority(bundleId: String?) -> Int {
        guard let id = bundleId?.lowercased() else { return 0 }
        if id.hasPrefix("com.apple.") { return 3 }
        if id.hasPrefix("com.garmin.") { return 2 }
        if id.hasPrefix("com.strava.") { return 1 }
        return 0
    }

    /// Maps a HealthKit workout type to our sport_type classification.
    static func sportType(for activityType: HKWorkoutActivityType) -> String {
        switch activityType {
        case .badminton: return "Badminton"
        case .traditionalStrengthTraining, .functionalStrengthTraining, .coreTraining, .highIntensityIntervalTraining: return "WeightTraining"
        case .cycling: return "Ride"
        case .running: return "Run"
        case .walking: return "Walk"
        case .yoga, .flexibility: return "Yoga"
        case .swimming: return "Swimming"
        case .hiking: return "Hiking"
        case .tennis: return "Tennis"
        case .soccer: return "Football"
        case .basketball: return "Basketball"
        default: return "Other"
        }
    }

    /// Converts an HKWorkout into our Activity model (without name — that's assigned by ActivityNamer).
    static func map(workout: HKWorkout) -> Activity {
        let sport = sportType(for: workout.workoutActivityType)

        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        formatter.timeZone = .current
        let startDateLocal = formatter.string(from: workout.startDate)

        let calories: Int? = {
            guard let stats = workout.statistics(for: HKQuantityType(.activeEnergyBurned)),
                  let sum = stats.sumQuantity() else { return nil }
            return Int(sum.doubleValue(for: .kilocalorie()))
        }()

        // Distance (available for runs, rides, walks)
        let distance: Double = {
            guard let stats = workout.statistics(for: HKQuantityType(.distanceWalkingRunning)),
                  let sum = stats.sumQuantity() else {
                // Try cycling distance
                guard let cyclingStats = workout.statistics(for: HKQuantityType(.distanceCycling)),
                      let cyclingSum = cyclingStats.sumQuantity() else { return 0 }
                return cyclingSum.doubleValue(for: .meter())
            }
            return sum.doubleValue(for: .meter())
        }()

        let elapsedTime = Int(workout.duration)
        let averageSpeed = elapsedTime > 0 ? distance / Double(elapsedTime) : 0

        let totalElevationGain: Double = {
            guard let qty = workout.metadata?[HKMetadataKeyElevationAscended] as? HKQuantity else { return 0 }
            return qty.doubleValue(for: .meter())
        }()

        let sourceApp = workout.sourceRevision.source.bundleIdentifier

        return Activity(
            name: "", // Assigned by ActivityNamer
            sportType: sport,
            startDateLocal: startDateLocal,
            elapsedTime: elapsedTime,
            movingTime: elapsedTime, // HealthKit doesn't distinguish moving vs elapsed
            calories: calories,
            distance: distance,
            totalElevationGain: totalElevationGain,
            averageHeartrate: nil, // Populated after HR sample fetch
            maxHeartrate: nil,
            hasHeartrate: false, // Updated after HR fetch
            hrZones: nil,
            description: nil,
            totalPhotoCount: 0,
            averageSpeed: averageSpeed,
            maxSpeed: 0,
            deviceName: workout.device?.name,
            source: "healthkit",
            sourceApp: sourceApp,
            activityId: workout.uuid.uuidString,
            idStr: workout.uuid.uuidString
        )
    }

    /// Computes average and max HR from samples.
    static func computeHRStats(samples: [Double]) -> (average: Double?, max: Double?) {
        guard !samples.isEmpty else { return (nil, nil) }
        let avg = samples.reduce(0, +) / Double(samples.count)
        let max = samples.max()
        return (avg.rounded(), max?.rounded())
    }
}
