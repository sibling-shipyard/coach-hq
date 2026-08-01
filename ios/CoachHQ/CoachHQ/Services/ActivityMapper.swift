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
            source: "healthkit"
        )
    }

    /// Computes HR zone distribution using actual sample timestamps for precise zone time.
    /// Uses midpoint integration: each sample owns the interval from the midpoint before it
    /// to the midpoint after it, with the last sample extending to `workoutEnd`.
    static func computeHRZones(samples: [(Date, Double)], workoutEnd: Date, config: HRZoneConfig) -> [String: HRZoneEntry] {
        guard !samples.isEmpty else { return [:] }
        var z1: Double = 0, z2: Double = 0, z3: Double = 0, z4: Double = 0, z5: Double = 0

        for i in 0..<samples.count {
            let t = samples[i].0
            let bpm = samples[i].1
            let segStart: Date = i == 0 ? t : Date(timeIntervalSince1970: (samples[i-1].0.timeIntervalSince1970 + t.timeIntervalSince1970) / 2)
            let segEnd: Date = i == samples.count - 1 ? workoutEnd : Date(timeIntervalSince1970: (t.timeIntervalSince1970 + samples[i+1].0.timeIntervalSince1970) / 2)
            let duration = max(0, segEnd.timeIntervalSince(segStart))

            let hrInt = Int(bpm)
            if hrInt <= config.zone1Upper { z1 += duration }
            else if hrInt <= config.zone2Upper { z2 += duration }
            else if hrInt <= config.zone3Upper { z3 += duration }
            else if hrInt <= config.zone4Upper { z4 += duration }
            else { z5 += duration }
        }

        return [
            "Zone 1": HRZoneEntry(low: 0,                    high: config.zone1Upper,     seconds: z1),
            "Zone 2": HRZoneEntry(low: config.zone1Upper + 1, high: config.zone2Upper,     seconds: z2),
            "Zone 3": HRZoneEntry(low: config.zone2Upper + 1, high: config.zone3Upper,     seconds: z3),
            "Zone 4": HRZoneEntry(low: config.zone3Upper + 1, high: config.zone4Upper,     seconds: z4),
            "Zone 5": HRZoneEntry(low: config.zone4Upper + 1, high: nil,                   seconds: z5),
        ]
    }

    /// Computes average and max HR from timestamped samples.
    static func computeHRStats(samples: [(Date, Double)]) -> (average: Double?, max: Double?) {
        guard !samples.isEmpty else { return (nil, nil) }
        let values = samples.map(\.1)
        let avg = values.reduce(0, +) / Double(values.count)
        return (avg.rounded(), values.max()?.rounded())
    }

    /// Downsamples a time series to at most `maxCount` points, preserving first and last.
    static func downsample(samples: [(Date, Double)], maxCount: Int = 200) -> [(Date, Double)] {
        guard samples.count > maxCount else { return samples }
        let stride = Double(samples.count - 1) / Double(maxCount - 1)
        return (0..<maxCount).map { i in samples[Int((Double(i) * stride).rounded())] }
    }
}
