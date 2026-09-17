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

    func testLedgerRowsPreferHistFullWeekOverSlicedDose() {
        let now = EnginePageMath.parseLocal("2026-09-16T12:00:00")!
        let week = EnginePageMath.weekDateKeys(weekLabel: "WK 38", now: now)
        XCTAssertTrue(week.contains("2026-09-14"))
        XCTAssertTrue(week.contains("2026-09-20"))

        let dose = [
            DoseRowSnapshot(day: "WED", title: "Kickstart", detail: nil, load: 9, sport: .foundation, isRest: nil),
        ]
        let hist = [
            EnginePageMath.HistSession(
                name: "Badminton",
                startDateLocal: "2026-09-14T18:00:00",
                elapsedSeconds: 3600,
                averageHeartrate: 140,
                sportType: "Badminton",
                load: 40
            ),
            EnginePageMath.HistSession(
                name: "Kickstart",
                startDateLocal: "2026-09-16T07:00:00",
                elapsedSeconds: 900,
                averageHeartrate: 90,
                sportType: "Foundation",
                load: 9
            ),
        ]
        let rows = EnginePageMath.ledgerRows(doseRows: dose, hist: hist, weekDates: week)
        XCTAssertEqual(rows.map(\.title), ["Badminton", "Kickstart"])
        XCTAssertEqual(rows.first?.day, "MON")
        XCTAssertEqual(rows.first?.load, 40)
        XCTAssertEqual(rows.first?.sport, .badminton)
    }

    func testLedgerRowsFallBackToDoseWhenHistMissesTheWeek() {
        let dose = [
            DoseRowSnapshot(day: "WED", title: "Kickstart", detail: nil, load: 9, sport: .foundation, isRest: nil),
        ]
        let rows = EnginePageMath.ledgerRows(
            doseRows: dose,
            hist: [
                EnginePageMath.HistSession(
                    name: "Old Ride",
                    startDateLocal: "2026-09-01T07:00:00",
                    elapsedSeconds: 1800,
                    averageHeartrate: 120,
                    sportType: "Ride",
                    load: 22
                ),
            ],
            weekDates: ["2026-09-14", "2026-09-16"]
        )
        XCTAssertEqual(rows.map(\.title), ["Kickstart"])
    }
}
