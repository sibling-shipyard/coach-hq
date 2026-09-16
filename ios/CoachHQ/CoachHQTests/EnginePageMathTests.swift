import XCTest
@testable import CoachHQ

final class EnginePageMathTests: XCTestCase {
    func testAbsorbWhenLoadUnderBand() {
        let relation = EnginePageMath.bandRelation(load: 463, bandLow: 518, bandHigh: 778)
        XCTAssertEqual(relation, .under(55))
        XCTAssertEqual(EnginePageMath.verdict(for: relation!), "Absorb.")
        XCTAssertEqual(EnginePageMath.sub(for: relation!), "55 UNDER THE BAND")
    }

    func testInRhythmWhenLoadInsideBand() {
        let relation = EnginePageMath.bandRelation(load: 600, bandLow: 518, bandHigh: 778)
        XCTAssertEqual(relation, .inside)
        XCTAssertEqual(EnginePageMath.verdict(for: relation!), "In rhythm.")
        XCTAssertEqual(EnginePageMath.sub(for: relation!), "INSIDE THE BAND")
    }

    func testEaseOffWhenLoadOverBand() {
        let relation = EnginePageMath.bandRelation(load: 800, bandLow: 518, bandHigh: 778)
        XCTAssertEqual(relation, .over(22))
        XCTAssertEqual(EnginePageMath.verdict(for: relation!), "Ease off.")
        XCTAssertEqual(EnginePageMath.sub(for: relation!), "22 OVER THE BAND")
    }

    func testBandEdgesCountAsInside() {
        XCTAssertEqual(EnginePageMath.bandRelation(load: 518, bandLow: 518, bandHigh: 778), .inside)
        XCTAssertEqual(EnginePageMath.bandRelation(load: 778, bandLow: 518, bandHigh: 778), .inside)
    }

    func testMissingBandOmitsVerdict() {
        XCTAssertNil(EnginePageMath.bandRelation(load: 463, bandLow: nil, bandHigh: 778))
        XCTAssertNil(EnginePageMath.bandRelation(load: 463, bandLow: 518, bandHigh: nil))
    }

    func testPercentVs8wAgoRoundsToNearest() {
        let percent = EnginePageMath.percentVs8wAgo(bandLow: 518, bandHigh: 778, agoLow: 465, agoHigh: 697)
        XCTAssertEqual(percent, 12)
    }

    func testGroupedSessionsSkipsEmptyDaysAndRest() {
        let rows = [
            DoseRowSnapshot(day: "TUE", title: "Ride #113", detail: nil, load: 19, sport: .cycling, isRest: nil),
            DoseRowSnapshot(day: "TUE", title: "Ride #114", detail: nil, load: 45, sport: .cycling, isRest: nil),
            DoseRowSnapshot(day: "WED", title: "Rest", detail: nil, load: nil, sport: .other, isRest: true),
            DoseRowSnapshot(day: "WED", title: "WeightTraining #163", detail: nil, load: 20, sport: .weightTraining, isRest: nil),
            DoseRowSnapshot(day: "SUN", title: "Ride #116", detail: nil, load: 10, sport: .cycling, isRest: nil),
        ]
        let groups = EnginePageMath.groupedSessions(rows: rows, dayNumbers: ["TUE": 15, "WED": 16, "SUN": 20])
        XCTAssertEqual(groups.map(\.day), ["TUE", "WED", "SUN"])
        XCTAssertEqual(groups[0].sessionCount, 2)
        XCTAssertEqual(groups[0].loadSum, 64)
        XCTAssertEqual(groups[0].dayNumber, 15)
        XCTAssertEqual(groups[1].sessionCount, 1)
        XCTAssertEqual(groups[1].loadSum, 20)
        XCTAssertEqual(groups[2].loadSum, 10)
    }

    func testEmptyDoseGroupsWhenNoSessions() {
        let rest = DoseRowSnapshot(day: "MON", title: "Rest", detail: nil, load: nil, sport: .other, isRest: true)
        XCTAssertTrue(EnginePageMath.groupedSessions(rows: []).isEmpty)
        XCTAssertTrue(EnginePageMath.groupedSessions(rows: [rest]).isEmpty)
    }

    func testSessionMetaOmitsMissingHR() {
        let row = DoseRowSnapshot(day: "TUE", title: "Ride #113", detail: nil, load: 19, sport: .cycling, isRest: nil)
        let withHR = EnginePageMath.HistSession(
            name: "Ride #113",
            startDateLocal: "2026-09-15T07:00:00",
            elapsedSeconds: 900,
            averageHeartrate: 125
        )
        let withoutHR = EnginePageMath.HistSession(
            name: "Ride #113",
            startDateLocal: "2026-09-15T07:00:00",
            elapsedSeconds: 900,
            averageHeartrate: nil
        )
        let week: Set<String> = ["2026-09-15"]
        let full = EnginePageMath.sessionMeta(row: row, hist: [withHR], weekDates: week)
        XCTAssertEqual(full.minutes, 15)
        XCTAssertEqual(full.averageHR, 125)
        let partial = EnginePageMath.sessionMeta(row: row, hist: [withoutHR], weekDates: week)
        XCTAssertEqual(partial.minutes, 15)
        XCTAssertNil(partial.averageHR)
        XCTAssertEqual(EnginePageMath.sessionMeta(row: row, hist: [], weekDates: week), EnginePageMath.SessionMeta())
    }

    func testReceiptSubjectOnlyWhenBodyNamesASession() {
        let rows = [
            DoseRowSnapshot(day: "TUE", title: "Ride #115", detail: nil, load: 38, sport: .cycling, isRest: nil),
        ]
        XCTAssertEqual(
            EnginePageMath.receiptSubject(body: "Ride #115 did most of this.", doseRows: rows),
            "Ride #115"
        )
        XCTAssertNil(EnginePageMath.receiptSubject(body: "Quiet start.", doseRows: rows))
    }
}
