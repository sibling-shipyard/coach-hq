import XCTest
@testable import CoachHQ

final class ActivityVsUsualTests: XCTestCase {

    private let legacyJSON = """
    {
      "name": "Run #3",
      "sport_type": "Run",
      "start_date_local": "2026-08-23T08:00:00",
      "elapsed_time": 3600,
      "moving_time": 3600,
      "distance": 10000,
      "total_elevation_gain": 50,
      "has_heartrate": true,
      "total_photo_count": 0,
      "average_speed": 2.78,
      "max_speed": 4.2,
      "source": "healthkit"
    }
    """

    func testDecodesStoredVsUsualBlock() throws {
        let json = legacyJSON.replacingOccurrences(
            of: "\n}",
            with: """
            ,
              "vs_usual": {
                "duration_median_s": 3420.5,
                "avg_hr_median": 148,
                "above_threshold_median_s": 640
              }
            }
            """
        )

        let activity = try JSONDecoder().decode(Activity.self, from: Data(json.utf8))

        XCTAssertEqual(activity.vsUsual?.durationMedianS, 3420.5)
        XCTAssertEqual(activity.vsUsual?.avgHRMedian, 148)
        XCTAssertEqual(activity.vsUsual?.aboveThresholdMedianS, 640)
    }

    func testIgnoresLegacySampleCountInStoredBlock() throws {
        let json = legacyJSON.replacingOccurrences(
            of: "\n}",
            with: """
            ,
              "vs_usual": {
                "duration_median_s": 3420,
                "sample_count": 20
              }
            }
            """
        )

        let activity = try JSONDecoder().decode(Activity.self, from: Data(json.utf8))
        let encoded = try JSONEncoder().encode(activity)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        let baseline = try XCTUnwrap(object["vs_usual"] as? [String: Any])

        XCTAssertEqual(activity.vsUsual?.durationMedianS, 3420)
        XCTAssertNil(baseline["sample_count"])
    }

    func testDecodesLegacyActivityWithoutVsUsual() throws {
        let activity = try JSONDecoder().decode(Activity.self, from: Data(legacyJSON.utf8))

        XCTAssertNil(activity.vsUsual)
    }

    func testEncodeRoundTripPreservesVsUsual() throws {
        let original = Activity(
            name: "Badminton #12",
            sportType: "Badminton",
            startDateLocal: "2026-08-23T18:00:00",
            elapsedTime: 4200,
            movingTime: 4200,
            calories: 510,
            distance: 0,
            totalElevationGain: 0,
            averageHeartrate: 151,
            maxHeartrate: 181,
            hasHeartrate: true,
            hrZones: nil,
            description: nil,
            totalPhotoCount: 0,
            averageSpeed: 0,
            maxSpeed: 0,
            deviceName: "Apple Watch",
            source: "healthkit",
            vsUsual: VsUsual(
                durationMedianS: 3900,
                avgHRMedian: nil,
                aboveThresholdMedianS: 720.5
            )
        )

        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(Activity.self, from: data)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let baseline = try XCTUnwrap(object["vs_usual"] as? [String: Any])

        XCTAssertEqual(decoded, original)
        XCTAssertEqual(baseline["duration_median_s"] as? Double, 3900)
        XCTAssertNil(baseline["avg_hr_median"])
        XCTAssertEqual(baseline["above_threshold_median_s"] as? Double, 720.5)
        XCTAssertNil(baseline["sample_count"])
    }
}
