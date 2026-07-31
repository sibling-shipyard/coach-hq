import Foundation
import HealthKit

/// Maps HealthKit HKWorkout objects to the Activity schema.
struct ActivityMapper {

    /// Maps a HealthKit workout type to our sport_type classification.
    static func sportType(for activityType: HKWorkoutActivityType) -> String {
        switch activityType {
        case .badminton: return "Badminton"
        case .traditionalStrengthTraining, .functionalStrengthTraining, .coreTraining, .highIntensityIntervalTraining: return "WeightTraining"
        case .cycling: return "Ride"
        case .running: return "Run"
        case .walking: return "Walk"
        case .yoga, .flexibility: return "Yoga"
        default: return "Other"
        }
    }

    /// Converts an HKWorkout into our Activity model (without name — that's assigned by ActivityNamer).
    static func map(workout: HKWorkout) -> Activity {
        var sport = sportType(for: workout.workoutActivityType)
        if sport == "WeightTraining" && workout.duration < ActivityNamer.foundationMaxMinutes * 60 {
            sport = "Foundation"
        }

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

        return Activity(
            name: "", // Assigned by ActivityNamer
            sportType: sport,
            startDateLocal: startDateLocal,
            elapsedTime: elapsedTime,
            movingTime: elapsedTime, // HealthKit doesn't distinguish moving vs elapsed
            calories: calories,
            distance: distance,
            totalElevationGain: 0, // Not available from HealthKit workout summary
            averageHeartrate: nil, // Populated after HR sample fetch
            maxHeartrate: nil,
            hasHeartrate: false, // Updated after HR fetch
            hrZones: nil,
            description: nil,
            totalPhotoCount: 0,
            averageSpeed: averageSpeed,
            maxSpeed: 0, // Not available from HealthKit
            deviceName: workout.device?.name,
            source: "healthkit",
            activityId: workout.uuid.uuidString,
            idStr: workout.uuid.uuidString
        )
    }

    /// Computes HR zone distribution from raw heart rate samples.
    static func computeHRZones(samples: [Double], config: HRZoneConfig, duration: TimeInterval) -> [String: HRZoneEntry] {
        let timePerSample = duration / Double(samples.count)

        var z1: Double = 0, z2: Double = 0, z3: Double = 0, z4: Double = 0, z5: Double = 0

        for hr in samples {
            let bpm = Int(hr)
            if bpm <= config.zone1Upper {
                z1 += timePerSample
            } else if bpm <= config.zone2Upper {
                z2 += timePerSample
            } else if bpm <= config.zone3Upper {
                z3 += timePerSample
            } else if bpm <= config.zone4Upper {
                z4 += timePerSample
            } else {
                z5 += timePerSample
            }
        }

        return [
            "Zone 1": HRZoneEntry(low: 0,                    high: config.zone1Upper,     seconds: z1),
            "Zone 2": HRZoneEntry(low: config.zone1Upper + 1, high: config.zone2Upper,     seconds: z2),
            "Zone 3": HRZoneEntry(low: config.zone2Upper + 1, high: config.zone3Upper,     seconds: z3),
            "Zone 4": HRZoneEntry(low: config.zone3Upper + 1, high: config.zone4Upper,     seconds: z4),
            "Zone 5": HRZoneEntry(low: config.zone4Upper + 1, high: nil,                   seconds: z5),
        ]
    }

    /// Computes average and max HR from samples.
    static func computeHRStats(samples: [Double]) -> (average: Double?, max: Double?) {
        guard !samples.isEmpty else { return (nil, nil) }
        let avg = samples.reduce(0, +) / Double(samples.count)
        let max = samples.max()
        return (avg.rounded(), max?.rounded())
    }
}
